/**
 * @file secret-store.ts
 * @description Runtime secret rotation — watches the env file for changes,
 * re-validates secrets, and emits a typed event so downstream services can
 * reconnect without a full process restart.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Wraps dotenv to keep process.env in sync after startup.
 *   - Consumed by engines (orchestrator) and channels to pick up rotated API keys.
 *   - Emits `security.secrets_rotated` via EDITHEventBus so any module can react.
 *   - Does NOT replace src/config.ts — that parses the *initial* validated config.
 *     This module handles the *rotation* concern (live reload after startup).
 *
 * SECURITY NOTES:
 *   - Changed values are NEVER logged — only key names are reported.
 *   - Old secret values are overwritten in process.env, not kept in memory.
 *   - File watch uses debounce (300 ms) to avoid double-firing on editors
 *     that write temp files before renaming.
 */
import fs from "node:fs"
import path from "node:path"

import dotenv from "dotenv"

import { createLogger } from "../logger.js"

const log = createLogger("security.secret-store")

/** Keys that are considered secrets and trigger rotation events when changed. */
const SECRET_KEY_PREFIXES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "DISCORD_BOT_TOKEN",
  "SLACK_BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "WHATSAPP_CLOUD_ACCESS_TOKEN",
  "SIGNAL_",
  "LINE_CHANNEL_",
  "MATRIX_ACCESS_TOKEN",
  "TEAMS_APP_PASSWORD",
  "BLUEBUBBLES_PASSWORD",
  "ADMIN_TOKEN",
  "EMAIL_PASS",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "OUTLOOK_CLIENT_SECRET",
  "OUTLOOK_REFRESH_TOKEN",
  "GCAL_CLIENT_SECRET",
  "GCAL_REFRESH_TOKEN",
  "TWILIO_AUTH_TOKEN",
  "FISH_AUDIO_API_KEY",
  "NEWS_API_KEY",
  "SECRET_",
  "API_KEY",
  "TOKEN",
  "PASSWORD",
]

/** How long (ms) to wait after detecting a file change before reloading. */
const DEBOUNCE_MS = 300

export interface SecretRotationInfo {
  /** ISO timestamp of the last successful rotation. */
  rotatedAt: string
  /** Names of the env keys that changed — values are never included. */
  changedKeys: string[]
  /** Whether the last reload parsed without errors. */
  valid: boolean
}

/**
 * Runtime secret store with automatic env-file watching and rotation.
 *
 * Usage:
 * ```ts
 * import { secretStore } from "../security/secret-store.js"
 * const apiKey = secretStore.get("ANTHROPIC_API_KEY")
 * ```
 */
class SecretStore {
  private envFilePath: string
  private watcher: fs.FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastRotation: SecretRotationInfo | null = null

  /** Cached snapshot of last-parsed .env file contents (key → raw string). */
  private snapshot: Record<string, string> = {}

  constructor() {
    this.envFilePath = this.resolveEnvPath()
    // Bootstrap snapshot from the current .env file so the first reload
    // only reports keys that actually changed on disk.
    this.snapshot = this.parseFile()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Get the current value of an env var. Always reads from process.env so
   * callers automatically get the latest rotated value.
   */
  get(key: string): string {
    return process.env[key] ?? ""
  }

  /**
   * Check whether a key is non-empty (useful for optional secrets).
   */
  has(key: string): boolean {
    return (process.env[key] ?? "").length > 0
  }

  /**
   * Return info about the most recent rotation (null if no rotation has
   * occurred since startup).
   */
  getRotationInfo(): SecretRotationInfo | null {
    return this.lastRotation
  }

  /**
   * Manually trigger a reload of the env file. Useful for tests and for
   * programmatic rotation (e.g. after writing a new `.env` via a vault agent).
   *
   * @returns The list of changed key names, or an empty array if nothing changed.
   */
  async reload(): Promise<string[]> {
    return this.performReload()
  }

  /**
   * Start watching the env file for changes. Safe to call multiple times —
   * calling again does nothing if already watching.
   */
  watch(): void {
    if (this.watcher) return

    if (!fs.existsSync(this.envFilePath)) {
      log.warn("env file not found — secret rotation watch disabled", {
        path: this.envFilePath,
      })
      return
    }

    try {
      this.watcher = fs.watch(this.envFilePath, () => {
        this.scheduleReload()
      })
      this.watcher.on("error", (err: unknown) => {
        log.warn("fs.watch error on env file", { err })
        this.stopWatch()
      })
      log.info("secret rotation watch started", { path: this.envFilePath })
    } catch (err) {
      log.warn("could not start secret rotation watch", { err })
    }
  }

  /**
   * Stop watching the env file. Called on graceful shutdown.
   */
  stopWatch(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      log.info("secret rotation watch stopped")
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Resolve the env file path (mirrors src/config.ts logic). */
  private resolveEnvPath(): string {
    const override = process.env["EDITH_ENV_FILE"]
    return typeof override === "string" && override.trim().length > 0
      ? path.resolve(override.trim())
      : path.resolve(".env")
  }

  /** Debounce-schedule a reload to avoid double-firing on editor saves. */
  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      void this.performReload().catch((err: unknown) => {
        log.error("scheduled secret reload failed", { err })
      })
    }, DEBOUNCE_MS)
  }

  /**
   * Re-parse the env file, diff against the snapshot, update process.env,
   * and emit the rotation event if any secret key changed.
   */
  private async performReload(): Promise<string[]> {
    if (!fs.existsSync(this.envFilePath)) {
      log.warn("env file disappeared — skipping rotation", { path: this.envFilePath })
      return []
    }

    let parsed: Record<string, string>
    try {
      parsed = this.parseFile()
    } catch (err) {
      log.error("failed to parse env file during rotation", { err })
      this.lastRotation = {
        rotatedAt: new Date().toISOString(),
        changedKeys: [],
        valid: false,
      }
      return []
    }

    const changedKeys = this.diffSnapshot(this.snapshot, parsed)
    if (changedKeys.length === 0) {
      log.debug("secret reload: no changes detected")
      return []
    }

    // Apply additions/changes to process.env; remove deleted keys
    for (const key of changedKeys) {
      const newValue = parsed[key]
      if (newValue !== undefined) {
        process.env[key] = newValue
      } else {
        delete process.env[key]
      }
    }

    // Advance snapshot to the new file state
    this.snapshot = { ...parsed }

    // Record rotation info (keys only, NEVER values)
    const secretChanges = changedKeys.filter(k => this.isSecretKey(k))
    this.lastRotation = {
      rotatedAt: new Date().toISOString(),
      changedKeys: secretChanges,
      valid: true,
    }

    log.info("secrets rotated", { changedKeys: secretChanges })

    // Emit event — lazy import to avoid circular dependency at module load
    if (secretChanges.length > 0) {
      try {
        const { eventBus } = await import("../core/event-bus.js")
        eventBus.emit("security.secrets_rotated", {
          type: "security.secrets_rotated",
          changedKeys: secretChanges,
          rotatedAt: this.lastRotation.rotatedAt,
        })
      } catch {
        // event-bus may not be initialised in test environments
      }
    }

    return secretChanges
  }

  /**
   * Parse the .env file and return its contents as a flat record.
   * Returns an empty object if the file is absent or unreadable.
   */
  private parseFile(): Record<string, string> {
    if (!fs.existsSync(this.envFilePath)) return {}
    const raw = fs.readFileSync(this.envFilePath, "utf-8")
    return dotenv.parse(raw) as Record<string, string>
  }

  /**
   * Return the set of keys whose values differ between `prev` and `next`.
   * Handles additions and deletions.
   */
  private diffSnapshot(
    prev: Record<string, string>,
    next: Record<string, string>,
  ): string[] {
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)])
    const changed: string[] = []
    for (const key of allKeys) {
      if (prev[key] !== next[key]) changed.push(key)
    }
    return changed
  }

  /**
   * Return true if the key name suggests it holds a secret value.
   * Comparison is case-insensitive.
   */
  private isSecretKey(key: string): boolean {
    const upper = key.toUpperCase()
    return SECRET_KEY_PREFIXES.some(prefix => upper.includes(prefix.toUpperCase()))
  }
}

/** Singleton secret store — import and call `.watch()` in startup.ts. */
export const secretStore = new SecretStore()
