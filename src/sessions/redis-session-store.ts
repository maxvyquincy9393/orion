/**
 * @file redis-session-store.ts
 * @description Redis-backed session store with sliding TTL expiry.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used by session-store.ts when REDIS_URL is configured.
 *   Falls back to in-memory store if Redis is unavailable.
 *   Key format:
 *     session:  edith:session:{userId}:{channel}  → JSON Session object
 *     history:  edith:history:{userId}:{channel}  → JSON Message[]
 *   TTL is reset on every read/write (sliding expiry).
 *   The `redis` package is dynamically imported — no hard dependency.
 *
 * @module sessions/redis-session-store
 */

import { createLogger } from "../logger.js"
import type { Session, Message } from "./session-types.js"

const log = createLogger("sessions.redis")

/** Minimal interface for the subset of redis client methods we use. */
interface RedisClientLike {
  connect(): Promise<void>
  disconnect(): Promise<void>
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>
  del(key: string | string[]): Promise<number>
  on(event: string, listener: (...args: unknown[]) => void): unknown
  isOpen: boolean
}

/**
 * Redis-backed session store with sliding TTL expiry.
 * Requires the `redis` npm package (dynamically imported at connect time).
 */
export class RedisSessionStore {
  private client: RedisClientLike | null = null
  private connected = false
  /**
   * Per-key write locks to serialize concurrent addMessage() calls for the
   * same history key. Prevents TOCTOU race conditions (read-modify-write)
   * in single-process deployments.
   */
  private readonly writeLocks = new Map<string, Promise<void>>()

  constructor(
    private readonly redisUrl: string,
    private readonly ttlSeconds: number = 86_400,
  ) {}

  /** Connect to Redis. Throws if connection fails or redis package is missing. */
  async connect(): Promise<void> {
    // Dynamic import — redis is an optional dependency
    // @ts-expect-error — optional dep may not be installed
    const redisMod = await import("redis") as { createClient: (opts: { url: string }) => RedisClientLike }
    this.client = redisMod.createClient({ url: this.redisUrl })
    this.client.on("error", (err) => log.warn("Redis client error", { err }))
    await this.client.connect()
    this.connected = true
    log.info("Redis session store connected", {
      url: this.redisUrl.replace(/:\/\/.*@/, "://***@"),
    })
  }

  /** Disconnect from Redis. */
  async disconnect(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.disconnect()
    }
    this.connected = false
  }

  /** Whether the Redis client is connected. */
  isConnected(): boolean {
    return this.connected && !!this.client?.isOpen
  }

  /** Get or create a session with sliding TTL. */
  async getOrCreateSession(userId: string, channel: string): Promise<Session> {
    if (!this.client) throw new Error("Redis not connected")
    const key = this.sessionKey(userId, channel)
    const raw = await this.client.get(key)
    const now = Date.now()

    if (raw) {
      const session = JSON.parse(raw) as Session
      session.lastActivityAt = now
      await this.client.set(key, JSON.stringify(session), { EX: this.ttlSeconds })
      return session
    }

    const session: Session = {
      key: `${userId}:${channel}`,
      userId,
      channel,
      createdAt: now,
      lastActivityAt: now,
    }
    await this.client.set(key, JSON.stringify(session), { EX: this.ttlSeconds })
    return session
  }

  /** Get session history with sliding TTL. */
  async getSessionHistory(userId: string, channel: string, limit: number): Promise<Message[]> {
    if (!this.client) throw new Error("Redis not connected")
    const key = this.historyKey(userId, channel)
    const raw = await this.client.get(key)

    if (!raw) return []

    // Refresh TTL on read (sliding)
    await this.client.set(key, raw, { EX: this.ttlSeconds })
    const messages = JSON.parse(raw) as Message[]
    return messages.slice(-limit)
  }

  /** Add a message to session history with sliding TTL. */
  async addMessage(userId: string, channel: string, message: Message): Promise<void> {
    if (!this.client) throw new Error("Redis not connected")
    const histKey = this.historyKey(userId, channel)
    const sessKey = this.sessionKey(userId, channel)

    // Serialize writes per history key to prevent TOCTOU race conditions.
    // Two concurrent addMessage() calls for the same key without this would
    // cause one message to be silently lost (last-write-wins overwrite).
    const previous = this.writeLocks.get(histKey) ?? Promise.resolve()
    const current = previous.then(async () => {
      const client = this.client
      if (!client) return

      const raw = await client.get(histKey)
      const messages: Message[] = raw ? JSON.parse(raw) as Message[] : []
      messages.push(message)

      // Cap at 200 messages to prevent unbounded growth
      const trimmed = messages.slice(-200)
      await client.set(histKey, JSON.stringify(trimmed), { EX: this.ttlSeconds })

      // Refresh session TTL
      const sessRaw = await client.get(sessKey)
      if (sessRaw) {
        const session = JSON.parse(sessRaw) as Session
        session.lastActivityAt = Date.now()
        await client.set(sessKey, JSON.stringify(session), { EX: this.ttlSeconds })
      }
    }).finally(() => {
      if (this.writeLocks.get(histKey) === current) {
        this.writeLocks.delete(histKey)
      }
    })

    this.writeLocks.set(histKey, current)
    return current
  }

  /** Clear a specific session and its history. */
  async clearSession(userId: string, channel: string): Promise<void> {
    if (!this.client) throw new Error("Redis not connected")
    await this.client.del([
      this.sessionKey(userId, channel),
      this.historyKey(userId, channel),
    ])
  }

  private sessionKey(userId: string, channel: string): string {
    return `edith:session:${userId}:${channel}`
  }

  private historyKey(userId: string, channel: string): string {
    return `edith:history:${userId}:${channel}`
  }
}
