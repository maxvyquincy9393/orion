import { createLogger } from "../logger.js"
import { affordanceChecker, type AffordanceResult } from "./affordance-checker.js"

const log = createLogger("security.prompt-filter")

const SANITIZED_PREFIX = "[CONTENT SANITIZED] "
const MAX_LOG_LENGTH = 50
const AFFORDANCE_WARN_THRESHOLD = 0.55

/**
 * Maps Unicode homoglyphs (Cyrillic, Greek, zero-width chars, leetspeak digits)
 * to their ASCII equivalents. Applied during DETECTION ONLY — the original text
 * is preserved for output so legitimate content (e.g. math) is never corrupted.
 *
 * PAPER BASIS: Boucher et al. "Bad Characters: Imperceptible NLP Attacks"
 *   arXiv:2106.09898 — homoglyph and invisible-char injection vectors
 */
const HOMOGLYPH_MAP: ReadonlyArray<[RegExp, string]> = [
  [/[іΙ\u0456]/gu, "i"],   // Cyrillic і, Greek Ι
  [/[оΟ\u043E]/gu, "o"],   // Cyrillic о, Greek Ο
  [/[аΑ\u0430]/gu, "a"],   // Cyrillic а, Greek Α
  [/[еΕ\u0435]/gu, "e"],   // Cyrillic е, Greek Ε
  [/[\u0455]/gu, "s"],      // Cyrillic ѕ
  [/[рΡ\u0440]/gu, "p"],   // Cyrillic р, Greek Ρ
  [/[сС\u0441\u0421]/gu, "c"], // Cyrillic с, С
  [/[уΥ\u0443]/gu, "y"],   // Cyrillic у, Greek Υ
  [/[\u200b\u200c\u200d\ufeff]/gu, ""], // zero-width chars
]

/**
 * Normalizes text for injection detection only.
 * Applies NFKC normalization + homoglyph substitution to catch Unicode bypass
 * attempts. The original text is NEVER modified by this function.
 *
 * @param text - Raw input text
 * @returns Normalized lowercase text suitable for pattern matching
 */
function normalizeForDetection(text: string): string {
  let normalized = text.normalize("NFKC")
  for (const [pattern, replacement] of HOMOGLYPH_MAP) {
    normalized = normalized.replace(pattern, replacement)
  }
  return normalized
}

interface RegexReplaceRule {
  pattern: RegExp
  replacement: string
}

interface DetectionRuleGroup {
  reason: string
  patterns: readonly RegExp[]
}

type DetectionResult =
  | { detected: false }
  | { detected: true; reason: string }

const DIRECT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(all\s+)?(previous\s+)?instructions?/i,
  /forget\s+(all\s+)?(your\s+)?instructions?/i,
  /you\s+are\s+now\b/i,
  /new\s+instructions?\s*:/i,
  /system\s+prompt\s*:/i,
  /override\s+(previous\s+)?instructions?/i,
  /bypass\s+(all\s+)?restrictions?/i,
]

const JAILBREAK_PATTERNS: readonly RegExp[] = [
  /\bDAN\b/i,
  /do\s+anything\s+now\b/i,
  /pretend\s+(you\s+are|to\s+be)\b/i,
  /act\s+as\s+if\b/i,
  /you\s+are\s+(a|an)\s+\w+\s+(who|that|which)\b/i,
  /simulate\s+(being|a|an)\b/i,
  /role[ -]?play\s+(as|that)\b/i,
]

const ROLE_HIJACK_PATTERNS: readonly RegExp[] = [
  /your\s+new\s+persona\b/i,
  /from\s+now\s+on\s+you\s+are\b/i,
  /adopt\s+(the\s+)?(persona|role|identity)\s+(of|as)\b/i,
  /change\s+(your\s+)?(persona|role|identity)\b/i,
]

const DELIMITER_PATTERNS: readonly RegExp[] = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[SYSTEM\]/i,
  /\[USER\]/i,
  /\[ASSISTANT\]/i,
  /###\s*(SYSTEM|USER|ASSISTANT|INSTRUCTION)/i,
  /"""[^\n]*instruction/i,
  /---+\s*(system|instruction)/i,
]

const DETECTION_RULE_GROUPS: readonly DetectionRuleGroup[] = [
  { reason: "Direct injection pattern detected", patterns: DIRECT_INJECTION_PATTERNS },
  { reason: "Jailbreak pattern detected", patterns: JAILBREAK_PATTERNS },
  { reason: "Role hijack pattern detected", patterns: ROLE_HIJACK_PATTERNS },
  { reason: "Delimiter injection pattern detected", patterns: DELIMITER_PATTERNS },
]

const SANITIZE_STRUCTURE_RULES: readonly RegexReplaceRule[] = [
  { pattern: /<\|[^|]+\|>/g, replacement: "" },
  { pattern: /\[SYSTEM\]/gi, replacement: "[BLOCKED]" },
  { pattern: /\[USER\]/gi, replacement: "[BLOCKED]" },
  { pattern: /\[ASSISTANT\]/gi, replacement: "[BLOCKED]" },
  { pattern: /###\s*(SYSTEM|USER|ASSISTANT|INSTRUCTION)/gi, replacement: "### BLOCKED" },
  { pattern: /"""[^\n]*instruction/gi, replacement: '""" BLOCKED' },
  { pattern: /---+\s*(system|instruction)/gi, replacement: "--- BLOCKED" },
]

// Intentionally limited to direct-override phrases. This keeps sanitization
// conservative while still neutralizing the most common instruction-takeover text.
const SANITIZE_DIRECT_INJECTION_RULES: readonly RegexReplaceRule[] = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions?/gi, replacement: "[BLOCKED]" },
  { pattern: /disregard\s+(all\s+)?(previous\s+)?instructions?/gi, replacement: "[BLOCKED]" },
  { pattern: /forget\s+(all\s+)?(your\s+)?instructions?/gi, replacement: "[BLOCKED]" },
  { pattern: /you\s+are\s+now\b/gi, replacement: "[BLOCKED]" },
  { pattern: /new\s+instructions?\s*:/gi, replacement: "[BLOCKED]" },
  { pattern: /system\s+prompt\s*:/gi, replacement: "[BLOCKED]" },
]

function truncateForLogging(content: string): string {
  if (content.length <= MAX_LOG_LENGTH) {
    return content
  }
  return `${content.slice(0, MAX_LOG_LENGTH)}...`
}

function matchesAnyPattern(content: string, patterns: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return true
    }
  }
  return false
}

function detectInjection(content: string): DetectionResult {
  // Normalize Unicode + substitute homoglyphs to defeat Cyrillic/Greek bypass attempts
  const normalizedText = normalizeForDetection(content)

  for (const group of DETECTION_RULE_GROUPS) {
    if (matchesAnyPattern(normalizedText, group.patterns)) {
      return { detected: true, reason: group.reason }
    }
  }

  return { detected: false }
}

function applyReplaceRules(content: string, rules: readonly RegexReplaceRule[]): string {
  let next = content
  for (const rule of rules) {
    next = next.replace(rule.pattern, rule.replacement)
  }
  return next
}

function sanitizeContent(content: string): string {
  // Normalize Unicode (NFKC) before sanitization to match detection normalization
  const normalized = content.normalize("NFKC")
  const structuredSanitized = applyReplaceRules(normalized, SANITIZE_STRUCTURE_RULES)
  return applyReplaceRules(structuredSanitized, SANITIZE_DIRECT_INJECTION_RULES)
}

export interface PromptFilterResult {
  safe: boolean
  reason?: string
  sanitized: string
}

export interface PromptSafetyResult extends PromptFilterResult {
  affordance?: AffordanceResult
}

interface FilterTextOptions {
  userId?: string
  logMessage: string
  logErrorMessage: string
  addSanitizedPrefix: boolean
}

function filterText(content: string, options: FilterTextOptions): PromptFilterResult {
  try {
    const detection = detectInjection(content)
    if (!detection.detected) {
      return {
        safe: true,
        sanitized: content,
      }
    }

    const preview = truncateForLogging(content)
    const metadata = options.userId
      ? { userId: options.userId, reason: detection.reason, preview }
      : { reason: detection.reason, preview }
    log.warn(options.logMessage, metadata)

    const sanitizedBody = sanitizeContent(content)
    return {
      safe: false,
      reason: detection.reason,
      sanitized: options.addSanitizedPrefix ? `${SANITIZED_PREFIX}${sanitizedBody}` : sanitizedBody,
    }
  } catch (error) {
    // Fail closed on internal errors to avoid allowing injected input.
    log.error(options.logErrorMessage, error)
    const blocked = "[BLOCKED]"
    return {
      safe: false,
      reason: "Prompt filter internal error",
      sanitized: options.addSanitizedPrefix ? `${SANITIZED_PREFIX}${blocked}` : blocked,
    }
  }
}

export function filterPrompt(prompt: string, userId: string): PromptFilterResult {
  return filterText(prompt, {
    userId,
    logMessage: "Prompt injection detected",
    logErrorMessage: "filterPrompt error",
    addSanitizedPrefix: true,
  })
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

  if (affordance.riskScore >= AFFORDANCE_WARN_THRESHOLD) {
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
  return filterText(result, {
    logMessage: "Tool result injection detected",
    logErrorMessage: "filterToolResult error",
    addSanitizedPrefix: false,
  })
}
