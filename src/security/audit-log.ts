/**
 * @file audit-log.ts
 * @description Tamper-evident append-only audit log using HMAC-SHA256 chaining.
 * Each log entry includes the HMAC of the previous entry, creating a verifiable
 * chain where any modification invalidates all subsequent hashes.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Consumed by `audit-interceptor.ts` which wraps tool calls
 *   - Log file is a JSONL (one JSON object per line) at `config.VAULT_AUDIT_LOG_PATH`
 *   - HMAC key is derived from the vault master key; if vault is locked a
 *     separate ephemeral key is used (and verification will need the same key)
 *   - An HMAC key file can be stored in the vault under `__audit_hmac_key__`
 *
 * PAPER BASIS:
 *   - Schneier, "Applied Cryptography" §3.4 — HMAC-SHA256 message authentication
 *   - NIST SP 800-92 — Guide to Computer Security Log Management
 */

import { appendFile, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import { createLogger } from "../logger.js"
import config from "../config.js"
import { hmacSha256 } from "./vault-crypto.js"
import { randomBytes } from "node:crypto"

const log = createLogger("security.audit-log")

// ── Types ──────────────────────────────────────────────────────────────────────

/** Possible outcomes for a tool invocation */
export type AuditResult = "allowed" | "denied" | "error"

/** A single immutable audit entry */
export interface AuditEntry {
  /** Unique entry ID */
  id: string
  /** ISO-8601 timestamp */
  timestamp: string
  /** Tool / skill / channel name */
  tool: string
  /** SHA-256 of JSON-serialized args (never logs the args themselves) */
  argsHash: string
  /** User or channel that triggered the action */
  userId: string
  /** Optional device/channel identifier */
  channel?: string
  /** Outcome of the tool call */
  result: AuditResult
  /** Execution duration in milliseconds */
  durationMs: number
  /** Optional short human-readable reason (for denials) */
  reason?: string
  /** Hash of the PREVIOUS audit entry (empty string for first entry) */
  prevHash: string
  /** HMAC-SHA256 of this entry's fields (using audit HMAC key) */
  hash: string
}

// ── AuditLog ──────────────────────────────────────────────────────────────────

/**
 * Append-only, HMAC-chained audit logger.
 * Thread-safe for concurrent appends via a write queue (single-entry mutex).
 */
export class AuditLog {
  private hmacKey: string
  private lastHash = ""
  private writing = Promise.resolve()

  /**
   * Create a new AuditLog instance.
   *
   * @param hmacKey - 32-byte hex HMAC key; generate one and store it in the vault
   */
  constructor(hmacKey?: string) {
    this.hmacKey = hmacKey ?? randomBytes(32).toString("hex")
  }

  /**
   * Update the HMAC key (call after vault is unlocked and key retrieved).
   *
   * @param key - 32-byte hex HMAC key
   */
  setHmacKey(key: string): void {
    this.hmacKey = key
    log.debug("audit HMAC key updated")
  }

  /**
   * Append a new audit entry.
   * Serialises writes via a promise chain to keep chain integrity under concurrency.
   *
   * @param entry - Partial entry (id, timestamp, hash, prevHash computed automatically)
   */
  async append(
    entry: Omit<AuditEntry, "id" | "timestamp" | "prevHash" | "hash">,
  ): Promise<void> {
    this.writing = this.writing.then(async () => {
      const full = await this.buildEntry(entry)
      const line = JSON.stringify(full) + "\n"
      await this.ensureDir()
      await appendFile(config.VAULT_AUDIT_LOG_PATH, line, "utf8")
      this.lastHash = full.hash
    })
    return this.writing
  }

  /**
   * Verify the integrity of the entire audit log by re-computing each hash
   * and checking the chain.
   *
   * @returns `{ valid: true }` on success,
   *          `{ valid: false, firstBadIndex: number, reason: string }` on failure
   */
  async verify(): Promise<
    { valid: true } | { valid: false; firstBadIndex: number; reason: string }
  > {
    if (!existsSync(config.VAULT_AUDIT_LOG_PATH)) {
      return { valid: true }
    }

    const raw = await readFile(config.VAULT_AUDIT_LOG_PATH, "utf8")
    const lines = raw.split("\n").filter(Boolean)

    let prevHash = ""

    for (let i = 0; i < lines.length; i++) {
      let entry: AuditEntry
      try {
        entry = JSON.parse(lines[i]) as AuditEntry
      } catch {
        return { valid: false, firstBadIndex: i, reason: "JSON parse error" }
      }

      if (entry.prevHash !== prevHash) {
        return {
          valid: false,
          firstBadIndex: i,
          reason: `prevHash mismatch at index ${i}`,
        }
      }

      const expected = this.computeHash(entry)
      if (expected !== entry.hash) {
        return {
          valid: false,
          firstBadIndex: i,
          reason: `HMAC mismatch at index ${i}`,
        }
      }

      prevHash = entry.hash
    }

    return { valid: true }
  }

  /**
   * Read all entries from the audit log.
   *
   * @returns Array of `AuditEntry` objects
   */
  async readAll(): Promise<AuditEntry[]> {
    if (!existsSync(config.VAULT_AUDIT_LOG_PATH)) return []

    const raw = await readFile(config.VAULT_AUDIT_LOG_PATH, "utf8")
    return raw
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as AuditEntry)
  }

  /**
   * Read recent entries (last N).
   *
   * @param n - Number of most-recent entries to return
   */
  async readRecent(n: number): Promise<AuditEntry[]> {
    const all = await this.readAll()
    return all.slice(-n)
  }

  /**
   * Rotate the log by archiving the current file and starting fresh.
   * The archive is written as `{logPath}.{timestamp}.arc`
   */
  async rotate(): Promise<void> {
    if (!existsSync(config.VAULT_AUDIT_LOG_PATH)) return

    const archivePath = `${config.VAULT_AUDIT_LOG_PATH}.${Date.now()}.arc`
    const contents = await readFile(config.VAULT_AUDIT_LOG_PATH, "utf8")
    await writeFile(archivePath, contents, "utf8")
    await writeFile(config.VAULT_AUDIT_LOG_PATH, "", "utf8")
    this.lastHash = ""
    log.info("audit log rotated", { archivePath })
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async buildEntry(
    partial: Omit<AuditEntry, "id" | "timestamp" | "prevHash" | "hash">,
  ): Promise<AuditEntry> {
    const entry: AuditEntry = {
      ...partial,
      id: randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      prevHash: this.lastHash,
      hash: "", // placeholder, filled below
    }
    entry.hash = this.computeHash(entry)
    return entry
  }

  /** Compute HMAC over all fields except `hash` itself */
  private computeHash(entry: AuditEntry): string {
    const { hash: _ignored, ...data } = entry
    return hmacSha256(JSON.stringify(data), this.hmacKey)
  }

  private async ensureDir(): Promise<void> {
    const dir = dirname(config.VAULT_AUDIT_LOG_PATH)
    if (dir && !existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }
}

/** Singleton audit log instance (HMAC key updated once vault unlocks) */
export const auditLog = new AuditLog()
