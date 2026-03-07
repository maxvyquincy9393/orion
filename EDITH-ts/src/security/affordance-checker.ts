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
const SHORT_PROMPT_SKIP_LENGTH = 30
const MAX_EVAL_REQUEST_CHARS = 800
const MAX_REASONING_CHARS = 240

const ALLOWED_CATEGORIES = new Set([
  "safe",
  "ambiguous",
  "potentially_harmful",
  "clearly_harmful",
])

const INSTANT_BLOCK_PATTERNS: readonly RegExp[] = [
  /how to make (bomb|weapon|poison|malware|ransomware)/i,
  /create (virus|malware|exploit|backdoor)/i,
  /step\s*[- ]?\s*by\s*[- ]?\s*step.*(hack|attack|ddos)/i,
  /synthesize.*(drug|explosive|chemical weapon)/i,
]

const SAFE_ACADEMIC_HINTS: readonly RegExp[] = [
  /\beducational\b/i,
  /\bfor learning\b/i,
  /\bacademic\b/i,
  /\btheoretical\b/i,
  /\bdefensive\b/i,
  /\bsecurity research\b/i,
]

const SHORT_PROMPT_RISK_HINTS: readonly RegExp[] = [
  /\b(ddos|ransomware|malware|exploit|backdoor|payload)\b/i,
  /\b(bomb|poison|weapon)\b/i,
  /\b(hack|breach|phish|steal)\b/i,
]

const AFFORDANCE_PROMPT_TEMPLATE = `You are a safety evaluator. Analyze if this request could lead to real-world harm.

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

interface ParsedAffordancePayload {
  riskScore?: unknown
  category?: unknown
  reasoning?: unknown
}

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

function matchesAnyPattern(content: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content))
}

function escapeForTripleQuotedPrompt(input: string): string {
  // Prevent accidental prompt-structure breakage when the user includes triple quotes.
  return input.replace(/"""/g, "[TRIPLE_QUOTE]")
}

function buildAffordancePrompt(request: string): string {
  const truncatedRequest = escapeForTripleQuotedPrompt(request.slice(0, MAX_EVAL_REQUEST_CHARS))
  return AFFORDANCE_PROMPT_TEMPLATE.replace("{request}", truncatedRequest)
}

function normalizeCategory(value: unknown, riskScore: number): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (ALLOWED_CATEGORIES.has(raw)) {
    return raw
  }

  if (riskScore >= RISK_THRESHOLD_BLOCK) {
    return "clearly_harmful"
  }
  if (riskScore >= RISK_THRESHOLD_WARN) {
    return "potentially_harmful"
  }
  return "safe"
}

function normalizeReasoning(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }

  const trimmed = value.trim().replace(/\s+/g, " ")
  if (trimmed.length <= MAX_REASONING_CHARS) {
    return trimmed
  }
  return `${trimmed.slice(0, MAX_REASONING_CHARS - 3)}...`
}

function parseAffordanceModelOutput(raw: string): AffordanceResult {
  const parsed = JSON.parse(extractJson(raw)) as ParsedAffordancePayload
  const riskScore = clamp01(Number(parsed.riskScore ?? 0))
  const category = normalizeCategory(parsed.category, riskScore)
  const reasoning = normalizeReasoning(parsed.reasoning)

  return {
    riskScore,
    category,
    reasoning,
    shouldBlock: riskScore >= RISK_THRESHOLD_BLOCK,
  }
}

async function raceWithTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function safeResult(reasoning: string): AffordanceResult {
  return {
    riskScore: 0,
    category: "safe",
    reasoning,
    shouldBlock: false,
  }
}

export class AffordanceChecker {
  quickCheck(prompt: string): AffordanceResult | null {
    for (const pattern of INSTANT_BLOCK_PATTERNS) {
      if (!pattern.test(prompt)) {
        continue
      }

      if (matchesAnyPattern(prompt, SAFE_ACADEMIC_HINTS)) {
        continue
      }

      log.warn("Instant block pattern matched", { preview: prompt.slice(0, 80) })
      return {
        riskScore: 1,
        category: "clearly_harmful",
        reasoning: "Matched instant-block pattern",
        shouldBlock: true,
      }
    }

    return null
  }

  private shouldSkipDeepCheck(prompt: string): boolean {
    if (prompt.length >= SHORT_PROMPT_SKIP_LENGTH) {
      return false
    }

    // Short prompts are usually harmless and expensive to score, but a small
    // keyword gate avoids obvious false negatives like "write malware".
    return !matchesAnyPattern(prompt, SHORT_PROMPT_RISK_HINTS)
  }

  async deepCheck(prompt: string, userId: string): Promise<AffordanceResult> {
    const quick = this.quickCheck(prompt)
    if (quick) {
      return quick
    }

    if (this.shouldSkipDeepCheck(prompt)) {
      return safeResult("Too short to be harmful")
    }

    try {
      const checkPrompt = buildAffordancePrompt(prompt)
      const raw = await raceWithTimeout(
        orchestrator.generate("fast", {
          prompt: checkPrompt,
          maxTokens: 200,
          temperature: 0,
        }),
        DEEP_CHECK_TIMEOUT_MS,
        "affordance",
      )

      const result = parseAffordanceModelOutput(raw)

      if (result.riskScore >= RISK_THRESHOLD_WARN) {
        log.warn("High risk affordance detected", {
          userId,
          riskScore: result.riskScore,
          category: result.category,
          reasoning: result.reasoning,
          preview: prompt.slice(0, 100),
        })
      }

      return result
    } catch (error) {
      // Fail-open is intentional: preserve availability, rely on downstream
      // prompt/output defenses when semantic scoring is unavailable.
      log.error("affordance deep check failed", { userId, error })
      return safeResult("Check failed, defaulting safe")
    }
  }
}

export const affordanceChecker = new AffordanceChecker()
