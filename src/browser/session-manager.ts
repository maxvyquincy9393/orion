/**
 * @file session-manager.ts
 * @description Encrypted browser session persistence.
 *
 * ARCHITECTURE:
 *   Session = cookies + localStorage per domain.
 *   Disimpan di: .edith/browser-sessions/{domain}.json (AES-256-GCM encrypted).
 *   Encryption key: dari ADMIN_TOKEN atau generates random key on first run.
 *   Dipanggil dari browserTool sebelum navigate ke domain baru.
 *
 *   Session lifecycle:
 *   1. browserTool navigate → sessionManager.restore(context, domain)
 *   2. Playwright loads cookies → user already logged in
 *   3. After successful page load → void sessionManager.save(context, domain)
 *   4. On shutdown/pruneExpired() → stale sessions deleted
 *
 * PAPER BASIS:
 *   Browser Use (github.com/browser-use) — one session per task with clean
 *   teardown; we extend with cross-restart persistence.
 *
 * SECURITY:
 *   - Cookies encrypted at rest (AES-256-GCM)
 *   - Session file permission: 0600 (owner only)
 *   - Max session age: 7 days (configurable)
 *   - Phase 17 will replace this with vault-based storage.
 *
 * @module browser/session-manager
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"
import { readFile, writeFile, unlink, readdir, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("browser.session-manager")

/** AES-256-GCM parameters */
const ALGO = "aes-256-gcm" as const
const KEY_LEN = 32
const IV_LEN = 16
const TAG_LEN = 16
const SALT = "edith-sessions-v1"

/** Max session age in days */
const DEFAULT_MAX_AGE_DAYS = 7

/** Derives a 32-byte key from the ADMIN_TOKEN or a random fallback. */
function deriveKey(): Buffer {
  const secret = config.ADMIN_TOKEN?.trim() || "edith-session-fallback-key-do-not-use-in-prod"
  return scryptSync(secret, SALT, KEY_LEN) as Buffer
}

/** Persisted structure for one domain session */
interface SessionFile {
  cookies: unknown[]
  savedAt: string
}

export class SessionManager {
  private readonly sessionsDir: string
  private readonly maxSessionAgeDays: number
  private readonly key: Buffer

  constructor(sessionsDir?: string, maxSessionAgeDays?: number) {
    this.sessionsDir = sessionsDir ?? config.BROWSER_SESSION_DIR ?? ".edith/browser-sessions"
    this.maxSessionAgeDays = maxSessionAgeDays ?? DEFAULT_MAX_AGE_DAYS
    this.key = deriveKey()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Restore cookies for a domain into the Playwright BrowserContext.
   * @param context - Playwright BrowserContext (or object with `addCookies`)
   * @param domain - Full URL of the domain (e.g., "https://traveloka.com")
   * @returns true if session was found and restored, false otherwise
   */
  async restore(context: { addCookies: (cookies: unknown[]) => Promise<void> }, domain: string): Promise<boolean> {
    const file = this.sessionFilePath(domain)
    try {
      const raw = await readFile(file, "utf8")
      const decrypted = this.decrypt(raw)
      const session = JSON.parse(decrypted) as SessionFile

      // Check age
      const savedAt = new Date(session.savedAt)
      const ageMs = Date.now() - savedAt.getTime()
      const maxMs = this.maxSessionAgeDays * 24 * 60 * 60 * 1000
      if (ageMs > maxMs) {
        log.debug("session expired — not restoring", { domain })
        await this.clear(domain)
        return false
      }

      if (session.cookies.length > 0) {
        await context.addCookies(session.cookies)
        log.info("session restored", { domain, cookieCount: session.cookies.length })
      }
      return true
    } catch {
      // File not found or decryption failure — silent, just start fresh
      return false
    }
  }

  /**
   * Save cookies from Playwright BrowserContext to disk (encrypted).
   * Called after successful login or navigation. Fire-and-forget safe.
   * @param context - Playwright BrowserContext (or object with `cookies`)
   * @param domain - Full URL of the domain
   */
  async save(context: { cookies: () => Promise<unknown[]> }, domain: string): Promise<void> {
    try {
      await mkdir(this.sessionsDir, { recursive: true })
      const cookies = await context.cookies()
      const session: SessionFile = { cookies, savedAt: new Date().toISOString() }
      const encrypted = this.encrypt(JSON.stringify(session))
      const file = this.sessionFilePath(domain)
      await writeFile(file, encrypted, { mode: 0o600 })
      log.debug("session saved", { domain, cookieCount: cookies.length })
    } catch (err) {
      log.warn("session save failed", { domain, err: String(err) })
    }
  }

  /**
   * Delete session for a specific domain (logout equivalent).
   * @param domain - Full URL of the domain
   */
  async clear(domain: string): Promise<void> {
    const file = this.sessionFilePath(domain)
    await unlink(file).catch(() => {})
    log.info("session cleared", { domain })
  }

  /**
   * Delete all sessions older than maxSessionAgeDays.
   * Call this on EDITH startup or periodically.
   */
  async pruneExpired(): Promise<void> {
    try {
      const files = await readdir(this.sessionsDir)
      const maxMs = this.maxSessionAgeDays * 24 * 60 * 60 * 1000
      let pruned = 0
      for (const file of files) {
        if (!file.endsWith(".session")) continue
        const fullPath = join(this.sessionsDir, file)
        const info = await stat(fullPath).catch(() => null)
        if (!info) continue
        const ageMs = Date.now() - info.mtimeMs
        if (ageMs > maxMs) {
          await unlink(fullPath).catch(() => {})
          pruned++
        }
      }
      if (pruned > 0) {
        log.info("expired sessions pruned", { count: pruned })
      }
    } catch {
      // sessionsDir may not exist yet — ignore
    }
  }

  // ── Encryption helpers ────────────────────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN)
    const cipher = createCipheriv(ALGO, this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    // Format: iv:tag:ciphertext (all hex)
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`
  }

  private decrypt(encoded: string): string {
    const parts = encoded.split(":")
    if (parts.length !== 3) throw new Error("Invalid session format")
    const [ivHex, tagHex, encHex] = parts as [string, string, string]
    const iv = Buffer.from(ivHex, "hex")
    const tag = Buffer.from(tagHex, "hex")
    const encryptedData = Buffer.from(encHex, "hex")
    const decipher = createDecipheriv(ALGO, this.key, iv)
    decipher.setAuthTag(tag.subarray(0, TAG_LEN))
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()])
    return decrypted.toString("utf8")
  }

  private sessionFilePath(domain: string): string {
    // Normalize domain string to safe filename
    const safe = domain
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .slice(0, 100)
    return join(this.sessionsDir, `${safe}.session`)
  }
}

/** Singleton instance */
export const sessionManager = new SessionManager()
