/**
 * String utility functions shared across the Orion codebase.
 * Centralizing these prevents logic drift from copy-pasted implementations.
 */

/**
 * Sanitize a user ID so it is safe to embed in LanceDB WHERE clauses.
 *
 * Only alphanumeric characters, hyphens, and underscores are allowed.
 * Any other character is replaced with an underscore.
 *
 * @param userId - Raw user ID from request or config
 * @returns Sanitized user ID safe for database queries
 */
export function sanitizeUserId(userId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    return userId.replace(/[^a-zA-Z0-9_-]/g, "_")
  }
  return userId
}

/**
 * Clamp a number between a minimum and maximum bound.
 * Returns `min` if the value is NaN.
 *
 * @param value - Number to clamp
 * @param min   - Lower bound (inclusive)
 * @param max   - Upper bound (inclusive)
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Safely parse a JSON string. Returns an empty object on failure.
 *
 * @param raw - Raw JSON string
 */
export function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
    return {}
  } catch {
    return {}
  }
}
