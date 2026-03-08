import { createLogger } from "../logger.js"
import { getHistory } from "../database/index.js"
import { edithMetrics } from "../observability/metrics.js"

const log = createLogger("sessions.store")

/**
 * Maximum number of concurrent in-memory sessions.
 * When this cap is reached, the least-recently-active session is evicted.
 * Evicted sessions are not lost — history persists in SQLite and is reloaded on demand.
 */
const MAX_SESSIONS = 500

export interface Message {
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

export interface Session {
  key: string
  userId: string
  channel: string
  createdAt: number
  lastActivityAt: number
}

function makeSessionKey(userId: string, channel: string): string {
  return `${userId}:${channel}`
}

class SessionStore {
  private sessions = new Map<string, Session>()
  private histories = new Map<string, Message[]>()

  getOrCreateSession(userId: string, channel: string): Session {
    const key = makeSessionKey(userId, channel)
    const now = Date.now()

    let session = this.sessions.get(key)
    if (!session) {
      session = {
        key,
        userId,
        channel,
        createdAt: now,
        lastActivityAt: now,
      }
      this.sessions.set(key, session)
      log.debug("Session created", { key })
      this.evictIfOverCapacity()
    } else {
      session.lastActivityAt = now
    }

    return session
  }

  getSession(userId: string, channel: string): Session | undefined {
    return this.sessions.get(makeSessionKey(userId, channel))
  }

  async getSessionHistory(
    userId: string,
    channel: string,
    limit = 50
  ): Promise<Message[]> {
    const key = makeSessionKey(userId, channel)

    let history = this.histories.get(key)
    if (!history) {
      const dbMessages = await getHistory(userId, limit)
      history = dbMessages
        .filter((msg) => !channel || msg.channel === channel)
        .reverse()
        .map((msg) => {
          const role: Message["role"] =
            msg.role === "assistant" || msg.role === "system" ? msg.role : "user"
          return {
            role,
            content: msg.content,
            timestamp: msg.createdAt.getTime(),
          }
        })
      this.histories.set(key, history)
    }

    return history.slice(-limit)
  }

  addMessage(userId: string, channel: string, message: Message): void {
    const key = makeSessionKey(userId, channel)
    const session = this.getOrCreateSession(userId, channel)
    session.lastActivityAt = Date.now()

    let history = this.histories.get(key)
    if (!history) {
      history = []
      this.histories.set(key, history)
    }

    history.push(message)
    void this.maybeCompressAsync(userId, channel)
  }

  replaceSessionHistory(userId: string, channel: string, messages: Message[]): void {
    const key = makeSessionKey(userId, channel)
    this.histories.set(key, messages)
  }

  private async maybeCompressAsync(userId: string, channel: string): Promise<void> {
    try {
      const { sessionSummarizer } = await import("../memory/session-summarizer.js")
      await sessionSummarizer.maybeCompress(userId, channel)
    } catch (error) {
      log.debug("Session summarizer unavailable", { userId, channel, error })
    }
  }

  clearSession(userId: string, channel: string): void {
    const key = makeSessionKey(userId, channel)
    this.sessions.delete(key)
    this.histories.delete(key)
    log.debug("Session cleared", { key })
  }

  clearAllSessions(): void {
    this.sessions.clear()
    this.histories.clear()
    edithMetrics.activeSessions.set(0)
    log.info("All sessions cleared")
  }

  /**
   * Evict the least-recently-active session when the cap is exceeded.
   * History is preserved in SQLite and will be reloaded on next access.
   */
  private evictIfOverCapacity(): void {
    if (this.sessions.size <= MAX_SESSIONS) {
      edithMetrics.activeSessions.set(this.sessions.size)
      return
    }

    let lruKey: string | null = null
    let lruTime = Infinity

    for (const [k, s] of this.sessions) {
      if (s.lastActivityAt < lruTime) {
        lruTime = s.lastActivityAt
        lruKey = k
      }
    }

    if (lruKey) {
      this.sessions.delete(lruKey)
      this.histories.delete(lruKey)
      log.debug("LRU session evicted", { key: lruKey, sessionCount: this.sessions.size })
    }

    edithMetrics.activeSessions.set(this.sessions.size)
  }

  /** Return all active sessions (for persistence). */
  getAllSessions(): Session[] {
    return [...this.sessions.values()]
  }

  /** Return the in-memory message history for a session (for persistence). */
  getHistory(userId: string, channel: string): Message[] {
    return this.histories.get(makeSessionKey(userId, channel)) ?? []
  }

  /** Restore a previously-persisted session into the in-memory store. */
  restoreSession(session: Session): void {
    this.sessions.set(session.key, session)
  }

  /** Restore previously-persisted message history for a session. */
  restoreHistory(userId: string, channel: string, history: Message[]): void {
    this.histories.set(makeSessionKey(userId, channel), history)
  }

  getActiveSessions(): Session[] {
    return [...this.sessions.values()]
  }

  getSessionCount(): number {
    return this.sessions.size
  }

  cleanupInactiveSessions(maxInactiveMs: number): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, session] of this.sessions) {
      if (now - session.lastActivityAt > maxInactiveMs) {
        this.sessions.delete(key)
        this.histories.delete(key)
        cleaned += 1
      }
    }

    if (cleaned > 0) {
      log.info("Cleaned up inactive sessions", { count: cleaned })
    }

    edithMetrics.activeSessions.set(this.sessions.size)
    return cleaned
  }
}

export const sessionStore = new SessionStore()
