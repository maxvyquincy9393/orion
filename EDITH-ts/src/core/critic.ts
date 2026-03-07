import config from "../config.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.critic")

export interface CritiqueResult {
  score: number
  issues: string[]
  suggestions: string[]
  passThreshold: boolean
}

export interface CritiquedResponse {
  original: string
  critique: CritiqueResult
  refined: string | null
  finalResponse: string
  iterations: number
}

interface CriticPayload {
  accuracy?: unknown
  helpfulness?: unknown
  completeness?: unknown
  issues?: unknown
  suggestions?: unknown
}

const DEFAULT_CRITIQUE_SCORE = 1
const MIN_CRITIQUE_RESPONSE_LENGTH = 50
const MAX_RESPONSE_CHARS = 2000
const MAX_QUERY_CHARS = 500
const MAX_ISSUES = 5
const MAX_SUGGESTIONS = 3
const MAX_ITERATIONS = 2
const FAST_CALL_TIMEOUT_MS = 1800
const LATENCY_BUDGET_MS = 3000

const CRITIC_PROMPT = `Evaluate this AI response on 3 dimensions. Return ONLY valid JSON.

Dimensions:
1. accuracy (0-1): Is the information correct and not hallucinated?
2. helpfulness (0-1): Does it directly address what was asked?
3. completeness (0-1): Are important aspects missing?

Response to evaluate:
"""
{response}
"""

Original query:
"""
{query}
"""

Return format:
{
  "accuracy": 0.8,
  "helpfulness": 0.9,
  "completeness": 0.7,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["suggestion 1"]
}
Return only JSON, no explanation.`

const REFINE_PROMPT = `Improve this response based on the critique provided.
Keep the same language (Indonesian/English) as the original.
Do NOT add unnecessary disclaimers. Just improve the content directly.

Original response:
"""
{response}
"""

Critique:
{critique}

Improved response:`

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function parseScore(value: unknown, fallback = 0.5): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return clamp(parsed)
}

function parseList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems)
}

export class ResponseCritic {
  private readonly threshold = clamp(config.CRITIQUE_THRESHOLD, 0, 1)

  private createPassResult(): CritiqueResult {
    return {
      score: DEFAULT_CRITIQUE_SCORE,
      issues: [],
      suggestions: [],
      passThreshold: true,
    }
  }

  private isEnabled(): boolean {
    if (!config.CRITIQUE_ENABLED) {
      return false
    }

    const available = orchestrator.getAvailableEngines()
    if (available.length <= 1) {
      return false
    }

    try {
      void orchestrator.route("fast")
      return true
    } catch {
      return false
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  async critique(query: string, response: string): Promise<CritiqueResult> {
    if (response.trim().length < MIN_CRITIQUE_RESPONSE_LENGTH) {
      return this.createPassResult()
    }

    try {
      const prompt = CRITIC_PROMPT
        .replace("{response}", response.slice(0, MAX_RESPONSE_CHARS))
        .replace("{query}", query.slice(0, MAX_QUERY_CHARS))

      const raw = await this.withTimeout(
        orchestrator.generate("fast", { prompt }),
        FAST_CALL_TIMEOUT_MS,
        "critique",
      )
      const cleaned = raw.replace(/```json|```/g, "").trim()
      const parsed = JSON.parse(cleaned) as CriticPayload

      const accuracy = parseScore(parsed.accuracy)
      const helpfulness = parseScore(parsed.helpfulness)
      const completeness = parseScore(parsed.completeness)
      const score = clamp(accuracy * 0.4 + helpfulness * 0.4 + completeness * 0.2)

      return {
        score,
        issues: parseList(parsed.issues, MAX_ISSUES),
        suggestions: parseList(parsed.suggestions, MAX_SUGGESTIONS),
        passThreshold: score >= this.threshold,
      }
    } catch (error) {
      log.warn("critique parse failed, using default pass", { error: String(error) })
      return this.createPassResult()
    }
  }

  async critiqueAndRefine(
    query: string,
    response: string,
    maxIterations = MAX_ITERATIONS,
  ): Promise<CritiquedResponse> {
    if (!this.isEnabled() || response.trim().length < MIN_CRITIQUE_RESPONSE_LENGTH) {
      return {
        original: response,
        critique: this.createPassResult(),
        refined: null,
        finalResponse: response,
        iterations: 0,
      }
    }

    const startedAt = Date.now()
    const cappedIterations = Math.max(0, Math.min(maxIterations, MAX_ITERATIONS))

    if (cappedIterations === 0) {
      return {
        original: response,
        critique: this.createPassResult(),
        refined: null,
        finalResponse: response,
        iterations: 0,
      }
    }

    let current = response
    let lastCritique: CritiqueResult = this.createPassResult()
    let iterations = 0

    for (let i = 0; i < cappedIterations; i += 1) {
      if (Date.now() - startedAt >= LATENCY_BUDGET_MS) {
        log.debug("critique budget exhausted", { iterations })
        break
      }

      const critique = await this.critique(query, current)
      lastCritique = critique
      iterations += 1

      log.info("critique result", {
        score: critique.score,
        pass: critique.passThreshold,
        issues: critique.issues.length,
        iteration: i + 1,
      })

      if (critique.passThreshold) {
        break
      }

      if (critique.issues.length === 0 && critique.suggestions.length === 0) {
        break
      }

      const refinePrompt = REFINE_PROMPT
        .replace("{response}", current.slice(0, MAX_RESPONSE_CHARS))
        .replace(
          "{critique}",
          JSON.stringify({
            issues: critique.issues,
            suggestions: critique.suggestions,
          }),
        )

      try {
        const refined = await this.withTimeout(
          orchestrator.generate("fast", { prompt: refinePrompt }),
          FAST_CALL_TIMEOUT_MS,
          "refine",
        )
        const cleaned = refined.trim()
        if (cleaned.length === 0 || cleaned === current) {
          break
        }
        current = cleaned
      } catch (error) {
        log.warn("refine step failed", { error: String(error) })
        break
      }
    }

    return {
      original: response,
      critique: lastCritique,
      refined: current !== response ? current : null,
      finalResponse: current,
      iterations,
    }
  }
}

export const responseCritic = new ResponseCritic()
