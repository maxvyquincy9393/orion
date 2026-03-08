/**
 * @file audit-interceptor.ts
 * @description Higher-order function that wraps any async tool call with
 * audit logging. Captures timing, outcome, and a hash of the arguments
 * without logging the argument values themselves.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Wraps tool functions before they are registered with the skill manager
 *   - Uses `auditLog.append()` from `audit-log.ts`
 *   - Args are hashed with SHA-256 so they can be cross-referenced without
 *     sensitive data appearing in the audit trail
 */

import { createHash } from "node:crypto"
import { createLogger } from "../logger.js"
import { auditLog, type AuditResult } from "./audit-log.js"

const log = createLogger("security.audit-interceptor")

// ── Types ──────────────────────────────────────────────────────────────────────

/** Context injected alongside the wrapped call */
export interface AuditContext {
  /** User identifier */
  userId: string
  /** Optional channel name */
  channel?: string
}

// ── withAuditLog ──────────────────────────────────────────────────────────────

/**
 * Wrap an async function with audit logging.
 * The wrapper records start time, catches errors, and appends an `AuditEntry`
 * regardless of whether the function succeeds or throws.
 *
 * @param tool    - Human-readable tool / skill name (e.g. "browser.search")
 * @param args    - Arguments passed to `fn` (will be hashed, NOT stored)
 * @param ctx     - Audit context (userId, channel)
 * @param fn      - Async function to execute and audit
 * @returns Result of `fn()`
 * @throws Re-throws any error from `fn()` after logging it
 *
 * @example
 * ```ts
 * const result = await withAuditLog(
 *   "calendar.createEvent",
 *   { title, date },
 *   { userId: ctx.userId, channel: "telegram" },
 *   () => calendarSkill.createEvent(title, date)
 * )
 * ```
 */
export async function withAuditLog<T>(
  tool: string,
  args: Record<string, unknown>,
  ctx: AuditContext,
  fn: () => Promise<T>,
): Promise<T> {
  const argsHash = hashArgs(args)
  const start = Date.now()
  let result: AuditResult = "allowed"
  let errorReason: string | undefined

  try {
    const value = await fn()
    return value
  } catch (err) {
    result = "error"
    errorReason = err instanceof Error ? err.message : String(err)
    log.warn("audited tool threw", { tool, userId: ctx.userId, error: errorReason })
    throw err
  } finally {
    const durationMs = Date.now() - start
    void auditLog
      .append({
        tool,
        argsHash,
        userId: ctx.userId,
        channel: ctx.channel,
        result,
        durationMs,
        reason: errorReason,
      })
      .catch(err => log.warn("failed to write audit entry", { tool, err }))
  }
}

/**
 * Wrap a tool call that was explicitly denied by the permission manager.
 * Records a `denied` audit entry without executing anything.
 *
 * @param tool   - Tool name
 * @param args   - Tool arguments (hashed)
 * @param ctx    - Audit context
 * @param reason - Human-readable denial reason
 */
export async function auditDenied(
  tool: string,
  args: Record<string, unknown>,
  ctx: AuditContext,
  reason: string,
): Promise<void> {
  void auditLog
    .append({
      tool,
      argsHash: hashArgs(args),
      userId: ctx.userId,
      channel: ctx.channel,
      result: "denied",
      durationMs: 0,
      reason,
    })
    .catch(err => log.warn("failed to write denied audit entry", { tool, err }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 of JSON-serialized args.
 * Sorting keys ensures consistent hashes regardless of property order.
 */
function hashArgs(args: Record<string, unknown>): string {
  const stable = JSON.stringify(args, Object.keys(args).sort())
  return createHash("sha256").update(stable, "utf8").digest("hex")
}
