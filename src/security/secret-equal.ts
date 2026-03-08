/**
 * @file secret-equal.ts
 * @description Timing-safe string comparison to prevent timing attacks on secrets.
 */
import { timingSafeEqual, createHash } from 'node:crypto'

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Hashes both strings first to normalize length.
 * @param a - First string
 * @param b - Second string
 * @returns True if equal
 */
export function secretEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
