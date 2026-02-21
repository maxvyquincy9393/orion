import { createLogger } from "../logger.js"
import { affordanceChecker, type AffordanceResult } from "./affordance-checker.js"

const log = createLogger("security.prompt-filter")

const DIRECT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(all\s+)?(previous\s+)?instructions?/i,
  /forget\s+(all\s+)?(your\s+)?instructions?/i,
  /you\s+are\s+now\b/i,
  /new\s+instructions?\s*:/i,
  /system\s+prompt\s*:/i,
  /override\s+(previous\s+)?instructions?/i,
  /bypass\s+(all\s+)?restrictions?/i,
]

const JAILBREAK_PATTERNS = [
  /\bDAN\b/i,
  /do\s+anything\s+now\b/i,
  /pretend\s+(you\s+are|to\s+be)\b/i,
  /act\s+as\s+if\b/i,
  /you\s+are\s+(a|an)\s+\w+\s+(who|that|which)\b/i,
  /simulate\s+(being|a|an)\b/i,
  /role[ -]?play\s+(as|that)\b/i,
]

const ROLE_HIJACK_PATTERNS = [
  /your\s+new\s+persona\b/i,
  /from\s+now\s+on\s+you\s+are\b/i,
  /adopt\s+(the\s+)?(persona|role|identity)\s+(of|as)\b/i,
  /change\s+(your\s+)?(persona|role|identity)\b/i,
]

const DELIMITER_PATTERNS = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[SYSTEM\]/i,
  /\[USER\]/i,
  /\[ASSISTANT\]/i,
  /###\s*(SYSTEM|USER|ASSISTANT|INSTRUCTION)/i,
  /\"\"\"[^\n]*instruction/i,
  /---+\s*(system|instruction)/i,
]

const SANITIZED_PREFIX = "[CONTENT SANITIZED] "
const MAX_LOG_LENGTH = 50

function truncateForLogging(content: string): string {
  if (content.length <= MAX_LOG_LENGTH) {
    return content
  }
  return `${content.slice(0, MAX_LOG_LENGTH)}...`
}

function detectInjection(content: string): { detected: boolean; reason?: string } {
  for (const pattern of DIRECT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      return { detected: true, reason: "Direct injection pattern detected" }
    }
  }

  for (const pattern of JAILBREAK_PATTERNS) {
    if (pattern.test(content)) {
      return { detected: true, reason: "Jailbreak pattern detected" }
    }
  }

  for (const pattern of ROLE_HIJACK_PATTERNS) {
    if (pattern.test(content)) {
      return { detected: true, reason: "Role hijack pattern detected" }
    }
  }

  for (const pattern of DELIMITER_PATTERNS) {
    if (pattern.test(content)) {
      return { detected: true, reason: "Delimiter injection pattern detected" }
    }
  }

  return { detected: false }
}

function sanitizeContent(content: string): string {
  let sanitized = content

  sanitized = sanitized.replace(/<\|[^|]+\|>/g, "")
  sanitized = sanitized.replace(/\[SYSTEM\]/gi, "[BLOCKED]")
  sanitized = sanitized.replace(/\[USER\]/gi, "[BLOCKED]")
  sanitized = sanitized.replace(/\[ASSISTANT\]/gi, "[BLOCKED]")
  sanitized = sanitized.replace(/###\s*(SYSTEM|USER|ASSISTANT|INSTRUCTION)/gi, "### BLOCKED")
  sanitized = sanitized.replace(/\"\"\"[^\n]*instruction/gi, '""" BLOCKED')
  sanitized = sanitized.replace(/---+\s*(system|instruction)/gi, "--- BLOCKED")

  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous\s+)?instructions?/gi,
    /forget\s+(all\s+)?(your\s+)?instructions?/gi,
    /you\s+are\s+now\b/gi,
    /new\s+instructions?\s*:/gi,
    /system\s+prompt\s*:/gi,
  ]

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, "[BLOCKED]")
  }

  return sanitized
}

export interface PromptFilterResult {
  safe: boolean
  reason?: string
  sanitized: string
}

export interface PromptSafetyResult extends PromptFilterResult {
  affordance?: AffordanceResult
}

export function filterPrompt(prompt: string, userId: string): PromptFilterResult {
  try {
    const detection = detectInjection(prompt)

    if (detection.detected && detection.reason) {
      log.warn("Prompt injection detected", {
        userId,
        reason: detection.reason,
        preview: truncateForLogging(prompt),
      })

      const sanitized = SANITIZED_PREFIX + sanitizeContent(prompt)
      return {
        safe: false,
        reason: detection.reason,
        sanitized,
      }
    }

    return {
      safe: true,
      sanitized: prompt,
    }
  } catch (error) {
    log.error("filterPrompt error", error)
    return {
      safe: true,
      sanitized: prompt,
    }
  }
}

export async function filterPromptWithAffordance(
  prompt: string,
  userId: string,
): Promise<PromptSafetyResult> {
  const patternFiltered = filterPrompt(prompt, userId)
  if (!patternFiltered.safe) {
    return patternFiltered
  }

  const affordance = await affordanceChecker.deepCheck(patternFiltered.sanitized, userId)
  if (affordance.shouldBlock) {
    log.warn("Prompt blocked by affordance checker", {
      userId,
      riskScore: affordance.riskScore,
      category: affordance.category,
      reasoning: affordance.reasoning,
      preview: truncateForLogging(prompt),
    })

    return {
      safe: false,
      reason: `Affordance blocked (${affordance.category})`,
      sanitized: patternFiltered.sanitized,
      affordance,
    }
  }

  if (affordance.riskScore >= 0.55) {
    log.warn("Prompt allowed with affordance warning", {
      userId,
      riskScore: affordance.riskScore,
      category: affordance.category,
      reasoning: affordance.reasoning,
      preview: truncateForLogging(prompt),
    })
  }

  return {
    ...patternFiltered,
    affordance,
  }
}

export function filterToolResult(result: string): PromptFilterResult {
  try {
    const detection = detectInjection(result)

    if (detection.detected && detection.reason) {
      log.warn("Tool result injection detected", {
        reason: detection.reason,
        preview: truncateForLogging(result),
      })

      const sanitized = sanitizeContent(result)
      return {
        safe: false,
        reason: detection.reason,
        sanitized,
      }
    }

    return {
      safe: true,
      sanitized: result,
    }
  } catch (error) {
    log.error("filterToolResult error", error)
    return {
      safe: true,
      sanitized: result,
    }
  }
}
