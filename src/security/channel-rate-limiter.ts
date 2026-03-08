/**
 * @file channel-rate-limiter.ts
 * @description Per-user rate limiter for bot channel inbound messages.
 * Uses a token-bucket algorithm to cap message processing rate per userId+channel.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Injected into TelegramChannel, DiscordChannel, WhatsAppChannel inbound handlers
 *   - Keyed on `${channel}:${userId}` so limits are per-channel, not global
 *   - Default limits: 10 messages per minute per user (configurable via config)
 *   - Violations are logged and the message is silently dropped (no error reply)
 *
 * PAPER BASIS:
 *   - Token Bucket algorithm — classic network traffic shaping §2.1
 */

import { createLogger } from "../logger.js"

const log = createLogger("security.channel-rate-limiter")

/** Per-bucket state */
interface BucketState {
  /** Available tokens (float) */
  tokens: number
  /** Last refill timestamp (ms) */
  lastRefill: number
  /** Count of denied requests this session */
  deniedCount: number
}

export interface RateLimitResult {
  /** Whether the message is allowed to be processed */
  allowed: boolean
  /** Remaining tokens after this call */
  remaining: number
  /** Seconds until full refill */
  retryAfterSec: number
}

export interface ChannelRateLimiterOptions {
  /** Max messages per window. Default: 10 */
  maxTokens?: number
  /** Refill window in ms. Default: 60_000 (1 minute) */
  windowMs?: number
  /** Bucket TTL in ms — buckets not accessed for this duration are evicted. Default: 5 minutes */
  bucketTtlMs?: number
}

const DEFAULT_MAX_TOKENS = 10
const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_BUCKET_TTL_MS = 5 * 60_000
const EVICTION_CHECK_INTERVAL_MS = 60_000

/**
 * Token-bucket rate limiter for channel inbound messages.
 * One instance per channel; keyed on userId.
 */
export class ChannelRateLimiter {
  private readonly maxTokens: number
  private readonly windowMs: number
  private readonly bucketTtlMs: number
  private readonly buckets = new Map<string, BucketState>()
  private evictionTimer: ReturnType<typeof setInterval> | null = null

  /**
   * @param options - Rate limit configuration
   */
  constructor(options: ChannelRateLimiterOptions = {}) {
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
    this.bucketTtlMs = options.bucketTtlMs ?? DEFAULT_BUCKET_TTL_MS
  }

  /**
   * Check whether a message from `userId` on `channel` is allowed.
   * Consumes one token if allowed; does not consume if denied.
   *
   * @param channel - Channel name (e.g. "telegram", "discord")
   * @param userId - User identifier within the channel
   */
  check(channel: string, userId: string): RateLimitResult {
    const key = `${channel}:${userId}`
    const now = Date.now()
    let bucket = this.buckets.get(key)

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now, deniedCount: 0 }
      this.buckets.set(key, bucket)
    }

    // Refill tokens proportionally to elapsed time
    const elapsed = now - bucket.lastRefill
    const refill = (elapsed / this.windowMs) * this.maxTokens
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refill)
    bucket.lastRefill = now

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      const remaining = Math.floor(bucket.tokens)
      return { allowed: true, remaining, retryAfterSec: 0 }
    }

    // Denied
    bucket.deniedCount += 1
    const retryAfterSec = Math.ceil((1 - bucket.tokens) * (this.windowMs / 1000) / this.maxTokens)

    if (bucket.deniedCount === 1 || bucket.deniedCount % 10 === 0) {
      log.warn("rate limit exceeded", { channel, userId, deniedCount: bucket.deniedCount, retryAfterSec })
    }

    return { allowed: false, remaining: 0, retryAfterSec }
  }

  /**
   * Reset the bucket for a specific user (e.g. on verified re-auth).
   *
   * @param channel - Channel name
   * @param userId - User identifier
   */
  reset(channel: string, userId: string): void {
    this.buckets.delete(`${channel}:${userId}`)
  }

  /**
   * Start periodic eviction of stale buckets.
   * Call once after creation if long-running; not needed in tests.
   */
  startEviction(): void {
    if (this.evictionTimer) return
    this.evictionTimer = setInterval(() => this.evictStaleBuckets(), EVICTION_CHECK_INTERVAL_MS)
    if (typeof this.evictionTimer === "object" && "unref" in this.evictionTimer) {
      (this.evictionTimer as { unref(): void }).unref()
    }
  }

  /** Stop the eviction timer. */
  stopEviction(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
    }
  }

  /** Evict buckets that have not been accessed within bucketTtlMs. */
  private evictStaleBuckets(): void {
    const cutoff = Date.now() - this.bucketTtlMs
    let evicted = 0
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) {
        this.buckets.delete(key)
        evicted++
      }
    }
    if (evicted > 0) {
      log.debug("evicted stale rate limit buckets", { evicted, remaining: this.buckets.size })
    }
  }
}

/** Shared rate limiter instance for all bot channels (10 msg/min per user per channel). */
export const channelRateLimiter = new ChannelRateLimiter()
channelRateLimiter.startEviction()
