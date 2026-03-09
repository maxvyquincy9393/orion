import { createLogger } from "../logger.js"
import { getHistory } from "../database/index.js"
import { prisma } from "../database/index.js"
import { edithMetrics } from "../observability/metrics.js"
import config from "../config.js"
import { sessionSummarizer, setStoreAdapter } from "../memory/session-summarizer.js"
import type { Message, Session } from "./session-types.js"

export type { Message, Session }

const log = createLogger("sessions.store")

/**
 * Minimal interface for a Redis-backed session store.
 * Defined locally to avoid a circular import with redis-session-store.ts, which
 * itself imports the `Message` and `Session` types from session-types.ts.
 */
interface RedisBackend {
  connect(): Promise<void>
  isConnected(): boolean
  getSessionHistory(userId: string, channel: string, limit: number): Promise<Message[]>
  addMessage(userId: string, channel: string, message: Message): Promise<void>
}

/**
 * Maximum number of concurrent in-memory sessions.
 * When this cap is reached, the least-recently-active session is evicted.
 * Evicted sessions are not lost — history persists in SQLite and is reloaded on demand.
 */
const MAX_SESSIONS = 500

function makeSessionKey(userId: string, channel: string): string {
  return `${userId}:${channel}`
}

class SessionStore {
  private sessions = new Map<string, Session>()
  private histories = new Map<string, Message[]>()
  private redisBackend: RedisBackend | null = null

  /** Initialize Redis backend if REDIS_URL is configured. */
  async initRedis(): Promise<void> {
    if (!config.REDIS_URL) {
      log.debug("REDIS_URL not set — using in-memory sessions")
      return
    }
    try {
      const { RedisSessionStore: RedisCls } = await import("./redis-session-store.js")
      this.redisBackend = new RedisCls(config.REDIS_URL, config.REDIS_SESSION_TTL_SECONDS)
      await this.redisBackend.connect()
      log.info("Redis session backend active")
    } catch (err) {
      log.warn("Redis unavailable — falling back to in-memory sessions", { err })
      this.redisBackend = null
    }
  }

  /** Restore active sessions from DB on startup. */
  async restoreFromDb(): Promise<void> {
    try {
      const rows = await prisma.activeSession.findMany()
      for (const row of rows) {
        const session: Session = {
          key: row.key,
          userId: row.userId,
          channel: row.channel,
          createdAt: row.createdAt.getTime(),
          lastActivityAt: row.lastActivityAt.getTime(),
        }
        this.sessions.set(session.key, session)
      }
      edithMetrics.activeSessions.set(this.sessions.size)
      log.info("Restored sessions from DB", { count: rows.length })
    } catch (err) {
      log.warn("Failed to restore sessions from DB, starting fresh", { err })
    }
  }

  /** Write-through: persist session state to DB. */
  private persistSession(session: Session): void {
    void prisma.activeSession
      .upsert({
        where: { key: session.key },
        create: {
          key: session.key,
          userId: session.userId,
          channel: session.channel,
        },
        update: {},
      })
      .catch((err: unknown) => log.debug("session persist failed", { key: session.key, err }))
  }

  /** Remove session from DB on eviction/clear. */
  private unpersistSession(key: string): void {
    void prisma.activeSession
      .delete({ where: { key } })
      .catch(() => {/* ignore if not found */})
  }

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
      this.persistSession(session)
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
    // Try Redis first
    if (this.redisBackend?.isConnected()) {
      try {
        return await this.redisBackend.getSessionHistory(userId, channel, limit)
      } catch (err) {
        log.debug("Redis getSessionHistory failed, falling back to memory", { err })
      }
    }

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

    // Replicate to Redis (fire-and-forget)
    if (this.redisBackend?.isConnected()) {
      void this.redisBackend.addMessage(userId, channel, message)
        .catch((err) => log.debug("Redis addMessage failed", { err }))
    }

    void this.maybeCompressAsync(userId, channel)
  }

  replaceSessionHistory(userId: string, channel: string, messages: Message[]): void {
    const key = makeSessionKey(userId, channel)
    this.histories.set(key, messages)
  }

  private async maybeCompressAsync(userId: string, channel: string): Promise<void> {
    try {
      await sessionSummarizer.maybeCompress(userId, channel)
    } catch (error) {
      log.debug("Session summarizer unavailable", { userId, channel, error })
    }
  }

  clearSession(userId: string, channel: string): void {
    const key = makeSessionKey(userId, channel)
    this.sessions.delete(key)
    this.histories.delete(key)
    this.unpersistSession(key)
    log.debug("Session cleared", { key })
  }

  clearAllSessions(): void {
    this.sessions.clear()
    this.histories.clear()
    void prisma.activeSession.deleteMany().catch(() => {/* ignore */})
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
      this.unpersistSession(lruKey)
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
        this.unpersistSession(key)
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

// Register this store as the provider for SessionSummarizer so that
// session-summarizer.ts does not need to import from this module.
setStoreAdapter(sessionStore)
