/**
 * @file lance-filter.ts
 * @description Safe parameterized filter builder for LanceDB queries.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Replaces all raw string-concatenation in store.ts and memrl.ts for LanceDB
 *   .where() and .delete() calls. Validates values against an allowlist regex
 *   to eliminate SQL-injection vectors.
 *
 * SECURITY:
 *   All string values are validated against a strict character allowlist.
 *   Numeric values must pass Number.isFinite(). Any invalid value throws.
 */

import { createLogger } from "../logger.js"

const log = createLogger("memory.lance-filter")

/** Strict allowlist for string values: alphanumeric, hyphens, underscores, colons, dots, @. */
const SAFE_VALUE_REGEX = /^[\w\-:.@]+$/

/** Strict allowlist for column names: alphanumeric and underscores only. */
const SAFE_COLUMN_REGEX = /^[a-zA-Z_]\w*$/

/**
 * Validate a column name against the safe column regex.
 * @param column - Column name to validate
 * @throws Error if column name contains unsafe characters
 */
function validateColumn(column: string): void {
  if (!SAFE_COLUMN_REGEX.test(column)) {
    throw new Error(`LanceFilter: invalid column name "${column}"`)
  }
}

/**
 * Validate a string value against the safe value allowlist regex.
 * @param value - String value to validate
 * @throws Error if value contains characters outside the allowlist
 */
function validateStringValue(value: string): void {
  if (!SAFE_VALUE_REGEX.test(value)) {
    log.warn("lance filter rejected unsafe string value", { value: value.slice(0, 50) })
    throw new Error("LanceFilter: value contains unsafe characters")
  }
}

/**
 * Validate a numeric value is finite.
 * @param value - Numeric value to validate
 * @throws Error if value is not a finite number
 */
function validateNumericValue(value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error("LanceFilter: numeric value must be finite")
  }
}

/**
 * Safe LanceDB filter builder.
 *
 * Provides methods to construct validated filter strings for LanceDB .where()
 * and .delete() calls, preventing SQL injection via strict value validation.
 */
class LanceFilter {
  /**
   * Build an equality filter: `column = 'value'`.
   * @param column - Column name (must match /^[a-zA-Z_]\w*$/)
   * @param value - String value (must match /^[\w\-:.@]+$/)
   * @returns Safe filter string e.g. `userId = 'abc-123'`
   */
  eq(column: string, value: string): string {
    validateColumn(column)
    validateStringValue(value)
    return `${column} = '${value}'`
  }

  /**
   * Build a less-than filter for numeric columns: `column < numValue`.
   * @param column - Column name (must match /^[a-zA-Z_]\w*$/)
   * @param numValue - Numeric value (must be finite)
   * @returns Safe filter string e.g. `createdAt < 1709856000000`
   */
  lt(column: string, numValue: number): string {
    validateColumn(column)
    validateNumericValue(numValue)
    return `${column} < ${numValue}`
  }

  /**
   * Build an IN filter: `column IN ('val1', 'val2', ...)`.
   * @param column - Column name (must match /^[a-zA-Z_]\w*$/)
   * @param values - Array of string values (each must match /^[\w\-:.@]+$/)
   * @returns Safe filter string e.g. `id IN ('abc', 'def')`
   * @throws Error if values array is empty
   */
  inList(column: string, values: string[]): string {
    validateColumn(column)
    if (values.length === 0) {
      throw new Error("LanceFilter: inList requires at least one value")
    }
    for (const value of values) {
      validateStringValue(value)
    }
    const escaped = values.map((v) => `'${v}'`).join(", ")
    return `${column} IN (${escaped})`
  }
}

/** Singleton safe LanceDB filter builder. */
export const lanceFilter = new LanceFilter()
