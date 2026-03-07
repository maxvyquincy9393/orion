import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const logger = createLogger("security.dual-agent-reviewer")

export type ReviewRiskLevel = "low" | "medium" | "high"

export interface ReviewResult {
  approved: boolean
  reason: string
  riskLevel: ReviewRiskLevel
}

interface ReviewPayload {
  approved?: unknown
  reason?: unknown
  riskLevel?: unknown
}

const HIGH_RISK_TERMINAL_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\b(del|format)\b/i,
  /\b(shutdown|reboot)\b/i,
  /\bchown\s+-R\b/i,
  /\bdd\s+if=/i,
]

function truncate(input: string, maxLen: number): string {
  return input.length <= maxLen ? input : `${input.slice(0, maxLen)}...`
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) {
    return fenced[1]
  }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }
  return trimmed
}

function normalizeRiskLevel(riskLevel: unknown): ReviewRiskLevel {
  if (typeof riskLevel !== "string") {
    return "medium"
  }
  if (riskLevel === "low" || riskLevel === "medium" || riskLevel === "high") {
    return riskLevel
  }
  return "medium"
}

function normalizeReviewResult(payload: ReviewPayload): ReviewResult {
  const riskLevel = normalizeRiskLevel(payload.riskLevel)
  const reason =
    typeof payload.reason === "string" && payload.reason.trim().length > 0
      ? payload.reason.trim()
      : "No reason provided by evaluator."

  if (riskLevel === "high") {
    return { approved: false, reason, riskLevel }
  }

  if (riskLevel === "medium") {
    return { approved: true, reason, riskLevel }
  }

  return {
    approved: true,
    reason,
    riskLevel,
  }
}

function heuristicHighRiskReview(
  userRequest: string,
  toolName: string,
  toolArgs: unknown,
): ReviewResult | null {
  if (toolName === "terminalTool" && typeof toolArgs === "object" && toolArgs !== null) {
    const command = (toolArgs as { command?: unknown }).command
    if (typeof command === "string" && HIGH_RISK_TERMINAL_PATTERNS.some((pattern) => pattern.test(command))) {
      return {
        approved: false,
        reason: "High-risk terminal operation detected by heuristic pre-check.",
        riskLevel: "high",
      }
    }
  }

  const request = userRequest.toLowerCase()
  const riskyTool = toolName === "terminalTool" || toolName === "fileWriteTool"
  const readOnlyIntent = /\b(read|summarize|explain|what is|show)\b/i.test(request)
  if (riskyTool && readOnlyIntent) {
    return {
      approved: true,
      reason: "Request appears read-only but selected tool mutates state; allowed with caution.",
      riskLevel: "medium",
    }
  }

  return null
}

export class DualAgentReviewer {
  async review(userRequest: string, toolName: string, toolArgs: unknown): Promise<ReviewResult> {
    const heuristic = heuristicHighRiskReview(userRequest, toolName, toolArgs)
    if (heuristic?.riskLevel === "high") {
      logger.warn("Tool rejected by heuristic high-risk rule", { toolName, reason: heuristic.reason })
      return heuristic
    }

    const argsPreview = truncate(JSON.stringify(toolArgs ?? {}), 1200)
    const prompt = [
      "You are a security evaluator for autonomous tool execution.",
      "Given a user request and a candidate tool invocation, classify risk and approval.",
      'Return ONLY JSON: {"approved": boolean, "reason": string, "riskLevel": "low"|"medium"|"high"}',
      "Policy:",
      "- high risk: reject, approved=false",
      "- medium risk: allow with warning, approved=true",
      "- low risk: allow, approved=true",
      "Evaluate consistency with user intent and security risk (SSRF/path traversal/command injection/exfiltration).",
      `User request: ${truncate(userRequest, 1500)}`,
      `Tool name: ${toolName}`,
      `Tool args (JSON): ${argsPreview}`,
    ].join("\n")

    try {
      const raw = await orchestrator.generate("fast", {
        prompt,
        maxTokens: 220,
        temperature: 0,
      })

      const jsonText = extractJson(raw)
      const parsed = JSON.parse(jsonText) as ReviewPayload
      const normalized = normalizeReviewResult(parsed)

      if (normalized.riskLevel !== "low") {
        logger.warn("Tool reviewed with elevated risk", {
          toolName,
          riskLevel: normalized.riskLevel,
          reason: normalized.reason,
        })
      }

      return normalized
    } catch (error) {
      logger.warn("Evaluator model failed; using heuristic fallback", { toolName, error })
      if (heuristic) {
        return heuristic
      }
      return {
        approved: true,
        reason: "Evaluator unavailable; fallback allowed with medium risk.",
        riskLevel: "medium",
      }
    }
  }
}

export function wrapWithDualAgentReview(
  tools: Record<string, unknown>,
  options: { userRequest: string; actorId?: string; reviewer?: DualAgentReviewer },
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {}
  const actorId = options.actorId ?? "unknown"
  const reviewer = options.reviewer ?? dualAgentReviewer

  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool !== "object" || tool === null) {
      wrapped[name] = tool
      continue
    }

    const toolObj = tool as Record<string, unknown>
    if (typeof toolObj.execute !== "function") {
      wrapped[name] = tool
      continue
    }

    const originalExecute = toolObj.execute as (...args: unknown[]) => Promise<unknown>
    const reviewedExecute = async (...args: unknown[]): Promise<unknown> => {
      try {
        const review = await reviewer.review(options.userRequest, name, args[0])
        if (!review.approved) {
          logger.warn("Tool blocked by dual-agent reviewer", {
            actorId,
            toolName: name,
            reason: review.reason,
            riskLevel: review.riskLevel,
          })
          return `Tool blocked by dual-agent reviewer (${review.riskLevel}): ${review.reason}`
        }

        if (review.riskLevel === "medium") {
          logger.warn("Tool allowed with caution by dual-agent reviewer", {
            actorId,
            toolName: name,
            reason: review.reason,
          })
        }

        return await originalExecute(...args)
      } catch (error) {
        logger.error("Dual-agent wrapper execution error", { actorId, toolName: name, error })
        return "Tool blocked: dual-agent reviewer failed unexpectedly."
      }
    }

    wrapped[name] = {
      ...toolObj,
      execute: reviewedExecute,
    }
  }

  return wrapped
}

export const dualAgentReviewer = new DualAgentReviewer()
