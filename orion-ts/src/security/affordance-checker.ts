import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("security.affordance")

export interface AffordanceResult {
  riskScore: number
  category: string
  reasoning: string
  shouldBlock: boolean
}

const RISK_THRESHOLD_BLOCK = 0.85
const RISK_THRESHOLD_WARN = 0.55
const DEEP_CHECK_TIMEOUT_MS = 1900

const INSTANT_BLOCK_PATTERNS = [
  /how to make (bomb|weapon|poison|malware|ransomware)/i,
  /create (virus|malware|exploit|backdoor)/i,
  /step.by.step.*(hack|attack|ddos)/i,
  /synthesize.*(drug|explosive|chemical weapon)/i,
]

const SAFE_ACADEMIC_HINTS = [
  /\beducational\b/i,
  /\bfor learning\b/i,
  /\bacademic\b/i,
  /\btheoretical\b/i,
  /\bdefensive\b/i,
  /\bsecurity research\b/i,
]

const AFFORDANCE_PROMPT = `You are a safety evaluator. Analyze if this request could lead to real-world harm.

Consider indirect paths: even if the request seems academic, could the output be used to:
- Harm people physically or psychologically
- Enable illegal activities
- Compromise computer systems
- Manipulate or deceive people at scale

Request to evaluate:
"""
{request}
"""

Return ONLY valid JSON:
{
  "riskScore": 0.0,
  "category": "safe",
  "reasoning": "brief explanation"
}

riskScore: 0.0 = safe, 0.5 = ambiguous, 1.0 = definitely harmful
category: "safe" | "ambiguous" | "potentially_harmful" | "clearly_harmful"
Keep reasoning under 100 words.`

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json|```/gi, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return cleaned.slice(start, end + 1)
  }
  return cleaned
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

export class AffordanceChecker {
  quickCheck(prompt: string): AffordanceResult | null {
    for (const pattern of INSTANT_BLOCK_PATTERNS) {
      if (pattern.test(prompt)) {
        if (SAFE_ACADEMIC_HINTS.some((safePattern) => safePattern.test(prompt))) {
          continue
        }

        log.warn("Instant block pattern matched", { preview: prompt.slice(0, 80) })
        return {
          riskScore: 1,
          category: "blocked",
          reasoning: "Matched instant-block pattern",
          shouldBlock: true,
        }
      }
    }

    return null
  }

  async deepCheck(prompt: string, userId: string): Promise<AffordanceResult> {
    const quick = this.quickCheck(prompt)
    if (quick) {
      return quick
    }

    if (prompt.length < 30) {
      return {
        riskScore: 0,
        category: "safe",
        reasoning: "Too short to be harmful",
        shouldBlock: false,
      }
    }

    try {
      const checkPrompt = AFFORDANCE_PROMPT.replace("{request}", prompt.slice(0, 800))
      const raw = await Promise.race([
        orchestrator.generate("fast", {
          prompt: checkPrompt,
          maxTokens: 200,
          temperature: 0,
        }),
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error(`affordance timeout after ${DEEP_CHECK_TIMEOUT_MS}ms`)), DEEP_CHECK_TIMEOUT_MS)
        }),
      ])

      const parsed = JSON.parse(extractJson(raw)) as {
        riskScore?: number
        category?: string
        reasoning?: string
      }

      const riskScore = clamp01(Number(parsed.riskScore ?? 0))
      const category = String(parsed.category ?? "safe")
      const shouldBlock = riskScore >= RISK_THRESHOLD_BLOCK

      if (riskScore >= RISK_THRESHOLD_WARN) {
        log.warn("High risk affordance detected", {
          userId,
          riskScore,
          category,
          reasoning: String(parsed.reasoning ?? ""),
          preview: prompt.slice(0, 100),
        })
      }

      return {
        riskScore,
        category,
        reasoning: String(parsed.reasoning ?? ""),
        shouldBlock,
      }
    } catch (error) {
      log.error("affordance deep check failed", { userId, error })
      return {
        riskScore: 0,
        category: "safe",
        reasoning: "Check failed, defaulting safe",
        shouldBlock: false,
      }
    }
  }
}

export const affordanceChecker = new AffordanceChecker()
