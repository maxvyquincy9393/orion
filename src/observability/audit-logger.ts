/**
 * @file audit-logger.ts
 * @description Structured audit event logger for security-relevant actions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Provides a dedicated audit logging channel separate from the operational logger.
 *   Used by security/camel-guard.ts, security/tool-guard.ts, and gateway auth flows
 *   to record authorization decisions, tool invocations, and access control events.
 *
 * SECURITY:
 *   Audit log entries must never contain raw secrets or tokens.
 *   User IDs and resource names are permitted. Sensitive fields must be redacted.
 */

import fs from "node:fs"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("observability.audit")

/** Structured audit event representing a security-relevant action. */
export interface AuditEvent {
  /** ISO 8601 timestamp of the event. */
  timestamp: string
  /** The user or system identity performing the action. */
  actor: string
  /** The action being performed, e.g. "tool.execute.blocked". */
  action: string
  /** The resource being acted upon, e.g. "terminalTool". */
  resource: string
  /** The outcome of the action. */
  outcome: "allow" | "deny" | "error"
  /** Optional human-readable reason for the outcome. */
  reason?: string
  /** Optional structured metadata for additional context. */
  metadata?: Record<string, unknown>
}

/** Scoped audit logger returned by createAuditLogger. */
export interface ScopedAuditLogger {
  /** Log an audit event (timestamp is added automatically). */
  log(event: Omit<AuditEvent, "timestamp">): void
}

/** Directory for audit log files, relative to cwd. */
const AUDIT_LOG_DIR = path.resolve(process.cwd(), ".edith", "audit")

/** Full path to the audit log file. */
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, "audit.log")

/** Maximum audit log file size before rotation (10 MB). */
const MAX_AUDIT_LOG_SIZE = 10 * 1024 * 1024

/** Whether the audit directory has been initialized. */
let auditDirInitialized = false

/**
 * Ensure the audit log directory exists.
 * Creates it on first call and caches the result.
 */
function ensureAuditDir(): void {
  if (auditDirInitialized) {
    return
  }

  try {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true })
    auditDirInitialized = true
  } catch (err) {
    log.warn("failed to create audit log directory", { dir: AUDIT_LOG_DIR, err })
  }
}

/**
 * Rotate the audit log file if it exceeds the size limit.
 * Renames the current file to audit.log.1 (overwriting any previous rotation).
 */
function rotateIfNeeded(): void {
  try {
    const stats = fs.statSync(AUDIT_LOG_FILE)
    if (stats.size >= MAX_AUDIT_LOG_SIZE) {
      const rotatedPath = `${AUDIT_LOG_FILE}.1`
      fs.renameSync(AUDIT_LOG_FILE, rotatedPath)
      log.info("audit log rotated", { rotatedTo: rotatedPath })
    }
  } catch {
    // File may not exist yet — that is fine
  }
}

/**
 * Append a single audit event line to the audit log file.
 * @param line - JSON-serialized audit event line
 */
function appendToAuditFile(line: string): void {
  ensureAuditDir()
  rotateIfNeeded()

  try {
    fs.appendFileSync(AUDIT_LOG_FILE, line + "\n", "utf-8")
  } catch (err) {
    log.warn("failed to write audit log entry", { err })
  }
}

/**
 * Creates a scoped audit logger that tags events with a scope prefix.
 *
 * Events are written to both the operational logger (at info level for allow,
 * warn for deny/error) and a dedicated audit log file at `.edith/audit/audit.log`.
 *
 * @param scope - Scope identifier, e.g. "security.camel-guard"
 * @returns ScopedAuditLogger with a log method
 */
function createAuditLogger(scope: string): ScopedAuditLogger {
  const scopedLog = createLogger(scope)

  return {
    log(event: Omit<AuditEvent, "timestamp">): void {
      const fullEvent: AuditEvent = {
        ...event,
        timestamp: new Date().toISOString(),
      }

      // Write to operational logger at appropriate level
      const message = `[AUDIT] ${event.action} on ${event.resource} by ${event.actor}: ${event.outcome}`
      const meta = {
        actor: event.actor,
        action: event.action,
        resource: event.resource,
        outcome: event.outcome,
        reason: event.reason,
        metadata: event.metadata,
      }

      if (event.outcome === "allow") {
        scopedLog.info(message, meta)
      } else {
        scopedLog.warn(message, meta)
      }

      // Write to dedicated audit log file
      try {
        const serialized = JSON.stringify(fullEvent)
        appendToAuditFile(serialized)
      } catch (err) {
        scopedLog.warn("failed to serialize audit event", { err })
      }
    },
  }
}

/** Singleton audit logger factory. */
export const auditLogger = { createAuditLogger }
