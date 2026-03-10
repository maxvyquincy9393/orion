/**
 * @file config-audit.ts
 * @description Scans runtime config for leaked secrets in logs/output,
 *   missing recommended API keys, and insecure default values.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called from src/cli/doctor.ts health-check and can be run standalone.
 *   Reads from the resolved config object (src/config.ts).
 */

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("security.config-audit")

/** A single finding from the config audit. */
export interface AuditFinding {
  /** 'error' = must fix, 'warning' = should fix, 'info' = informational. */
  severity: "error" | "warning" | "info"
  /** Short human-readable description. */
  message: string
  /** Which config key is affected. */
  key?: string
}

/** Result of a full config audit run. */
export interface AuditReport {
  findings: AuditFinding[]
  passed: boolean
}

/** Config keys that typically hold secret values and must never be logged. */
const SECRET_KEY_PATTERNS = [
  /API[_-]?KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PRIVATE[_-]?KEY/i,
  /CREDENTIALS/i,
  /AUTH/i,
]

/** Config keys that should have non-empty values for a healthy deployment. */
const RECOMMENDED_KEYS: Array<{ key: string; message: string }> = [
  { key: "OWNER_ID", message: "OWNER_ID is required for authorization" },
]

/**
 * Checks whether a config key name looks like it holds a secret.
 */
export function isSecretKey(keyName: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(keyName))
}

/**
 * Scans a text block (e.g., log output) for leaked config secret values.
 *
 * @param text - The text to scan for leaked secrets.
 * @returns Array of config key names whose values appear in the text.
 */
export function scanForLeakedSecrets(text: string): string[] {
  const leaked: string[] = []
  const configObj = config as unknown as Record<string, unknown>

  for (const [key, value] of Object.entries(configObj)) {
    if (!isSecretKey(key)) continue
    if (typeof value !== "string" || value.length < 8) continue

    if (text.includes(value)) {
      leaked.push(key)
    }
  }

  return leaked
}

/**
 * Runs a full audit of the current config, returning findings.
 *
 * Checks performed:
 *   1. Recommended keys with empty/missing values
 *   2. Secret keys that are set (informational — good)
 *   3. Default/placeholder detection for secrets
 *
 * @returns AuditReport with all findings and a pass/fail verdict.
 */
export function auditConfig(): AuditReport {
  const findings: AuditFinding[] = []
  const configObj = config as unknown as Record<string, unknown>

  // Check recommended keys
  for (const rec of RECOMMENDED_KEYS) {
    const value = configObj[rec.key]
    if (!value || (typeof value === "string" && value.trim().length === 0)) {
      findings.push({
        severity: "warning",
        message: rec.message,
        key: rec.key,
      })
    }
  }

  // Check for placeholder/default secrets
  for (const [key, value] of Object.entries(configObj)) {
    if (!isSecretKey(key)) continue
    if (typeof value !== "string") continue

    const lower = value.toLowerCase()
    if (
      lower === "changeme" ||
      lower === "replace-me" ||
      lower === "your-api-key-here" ||
      lower === "xxx" ||
      lower.startsWith("sk-placeholder")
    ) {
      findings.push({
        severity: "error",
        message: `${key} contains a placeholder value — replace with a real secret`,
        key,
      })
    }
  }

  const hasErrors = findings.some((f) => f.severity === "error")

  log.debug("config audit complete", {
    total: findings.length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  })

  return {
    findings,
    passed: !hasErrors,
  }
}
