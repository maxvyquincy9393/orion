/**
 * @file session-persistence.ts
 * @description Persists in-memory sessions to disk across EDITH restarts.
 *
 * ARCHITECTURE / INTEGRATION:
 *   save() is called by shutdown.ts before process exit — serializes the top
 *   SESSION_PERSIST_MAX sessions (by lastActivityAt) to .edith/sessions.json.
 *   load() is called by startup.ts after the outbox is initialized — restores
 *   sessions and their message histories into the in-memory SessionStore.
 *   Both operations are best-effort and never throw.
 *
 * @module sessions/session-persistence
 */

import fs from "node:fs/promises"
import path from "node:path"
import { sessionStore, type Session, type Message } from "./session-store.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("sessions.persistence")

/** A single persisted session entry containing session metadata and message history. */
interface PersistedEntry {
  session: Session
  history: Message[]
}

/** The full on-disk snapshot format. */
interface PersistedSnapshot {
  savedAt: number
  sessions: PersistedEntry[]
}

/**
 * Handles saving and loading session state across process restarts.
 *
 * Usage:
 *   const sp = new SessionPersistence(".edith")
 *   await sp.load()   // called on startup
 *   await sp.save()   // called on shutdown
 */
export class SessionPersistence {
  /** Absolute path to the sessions.json file. */
  private readonly filePath: string

  /**
   * @param dataDir - Directory containing sessions.json (e.g. ".edith")
   */
  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "sessions.json")
  }

  /**
   * Save the top SESSION_PERSIST_MAX sessions to disk.
   * No-op if SESSION_PERSIST_ENABLED is false.
   * Never throws.
   */
  async save(): Promise<void> {
    if (!config.SESSION_PERSIST_ENABLED) return
    try {
      const allSessions = sessionStore.getAllSessions()
      const topSessions = allSessions
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
        .slice(0, config.SESSION_PERSIST_MAX)

      const entries: PersistedEntry[] = topSessions.map((s) => ({
        session: s,
        history: sessionStore.getHistory(s.userId, s.channel),
      }))

      const snapshot: PersistedSnapshot = { savedAt: Date.now(), sessions: entries }
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, JSON.stringify(snapshot, null, 2), "utf-8")
      log.info("sessions persisted", { count: entries.length })
    } catch (err) {
      log.warn("session save failed", { err: String(err) })
    }
  }

  /**
   * Restore sessions from disk.
   * No-op if file does not exist or SESSION_PERSIST_ENABLED is false.
   * Never throws.
   */
  async load(): Promise<void> {
    if (!config.SESSION_PERSIST_ENABLED) return
    try {
      const raw = await fs.readFile(this.filePath, "utf-8")
      const snapshot = JSON.parse(raw) as PersistedSnapshot
      for (const { session, history } of snapshot.sessions) {
        sessionStore.restoreSession(session)
        sessionStore.restoreHistory(session.userId, session.channel, history)
      }
      log.info("sessions restored from disk", { count: snapshot.sessions.length })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("session load failed", { err: String(err) })
      }
    }
  }
}
