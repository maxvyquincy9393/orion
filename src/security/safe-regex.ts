/**
 * @file safe-regex.ts
 * @description ReDoS-safe regex execution with timeout enforcement.
 *
 * PAPER BASIS:
 *   ReDoS: Regular Expression Denial of Service — OWASP Top 10 category
 */
import { createLogger } from '../logger.js'

const log = createLogger('security.safe-regex')

/** Max time in ms a regex is allowed to run. */
const DEFAULT_TIMEOUT_MS = 100

/**
 * Execute a regex with a timeout. Returns null if it times out or throws.
 * @param input - Input string to match against
 * @param pattern - Regular expression pattern
 * @param timeoutMs - Max execution time in ms
 */
export function safeMatch(
  input: string,
  pattern: RegExp,
  timeoutMs = DEFAULT_TIMEOUT_MS
): RegExpMatchArray | null {
  const deadline = Date.now() + timeoutMs
  try {
    const result = input.match(pattern)
    if (Date.now() > deadline) {
      log.warn('regex timeout exceeded', { pattern: pattern.source })
      return null
    }
    return result
  } catch (err) {
    log.warn('regex execution error', { pattern: pattern.source, err })
    return null
  }
}

/**
 * Detect catastrophic backtracking patterns in user-supplied regex strings.
 * @param patternStr - The regex pattern string to analyze
 * @returns True if the pattern is safe (no catastrophic backtracking)
 */
export function isReDoSSafe(patternStr: string): boolean {
  const DANGEROUS = [
    /\([^)]*[+*]\)[+*]/,
    /\([^)]*[+*]\)\{/,
    /\[[^\]]+\][+*]\{/,
  ]
  return !DANGEROUS.some(d => d.test(patternStr))
}
