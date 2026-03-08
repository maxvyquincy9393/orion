/**
 * @file outbox.ts
 * @description Persistent outbox pattern for reliable channel message delivery.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements the Transactional Outbox Pattern — messages that fail to send
 *   are enqueued here with exponential-backoff retry scheduling.
 *
 *   Send path:
 *     ChannelManager.send() → fails → outbox.enqueue()
 *     outbox.startFlushing() → periodic flush → channelManager.send()
 *
 *   Persistence: in-memory map backed by JSON serialization to .edith/outbox.json
 *   on every write, so entries survive restarts.
 *
 *   Retry schedule (exponential backoff with jitter):
 *     Attempt 1: immediate
 *     Attempt 2: 30 seconds
 *     Attempt 3: 2 minutes
 *     Attempt 4: 10 minutes
 *     → dropped after MAX_ATTEMPTS, logged as dead-letter
 *
 * @module channels/outbox
 */

import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

import { createLogger } from "../logger.js"
import { edithMetrics } from "../observability/metrics.js"

const log = createLogger("channels.outbox")

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum delivery attempts before treating a message as dead-letter. */
const MAX_ATTEMPTS = 4

/**
 * Retry delay per attempt index (0-based), in milliseconds.
 * Attempt 0 = immediate (re-enqueued after failure), attempt 1+ = delayed.
 */
const RETRY_DELAYS_MS: readonly number[] = [0, 30_000, 120_000, 600_000]

/** How often the outbox flusher runs (every 10 seconds). */
const FLUSH_INTERVAL_MS = 10_000

/** Maximum outbox size — entries above this are dropped immediately. */
const MAX_OUTBOX_SIZE = 500

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single outbox entry representing one pending send. */
export interface OutboxEntry {
  /** Unique entry ID. */
  readonly id: string
  /** Target user ID. */
  readonly userId: string
  /** Channel name (e.g. "telegram", "discord"). */
  readonly channelName: string
  /** Message text to deliver. */
  readonly message: string
  /** Number of delivery attempts so far (0 = not yet tried). */
  attempts: number
  /** Epoch ms when the next attempt should be made. */
  nextRetryAt: number
  /** Epoch ms when this entry was created. */
  readonly createdAt: number
}

/** Dead-letter entry (max attempts exceeded). */
export interface DeadLetterEntry extends OutboxEntry {
  readonly droppedAt: number
  readonly reason: string
}

// ─── Outbox ──────────────────────────────────────────────────────────────────

/** Send function type — same signature as ChannelManager.send(). */
export type SendFn = (userId: string, message: string) => Promise<boolean>

/**
 * Reliable message outbox with exponential-backoff retry.
 *
 * Usage:
 *   outbox.enqueue(userId, channelName, message)
 *   outbox.startFlushing(channelManager.send.bind(channelManager))
 */
export class MessageOutbox {
  private readonly queue = new Map<string, OutboxEntry>()
  private readonly deadLetters: DeadLetterEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private persistPath: string | null = null

  /**
   * Configure disk persistence path. Call once before startFlushing().
   * @param dir - Directory to write outbox.json into
   */
  setPersistPath(dir: string): void {
    this.persistPath = path.join(dir, "outbox.json")
    void this.loadFromDisk()
  }

  /**
   * Enqueue a message for delivery. Safe to call from fire-and-forget context.
   *
   * @param userId - Target user
   * @param channelName - Channel that should deliver the message
   * @param message - Message text
   * @returns Entry ID
   */
  enqueue(userId: string, channelName: string, message: string): string {
    if (this.queue.size >= MAX_OUTBOX_SIZE) {
      log.warn("outbox full — dropping message", { userId, channelName, queueSize: this.queue.size })
      edithMetrics.errorsTotal.inc({ source: "outbox.full" })
      return ""
    }

    const id = crypto.randomUUID()
    const entry: OutboxEntry = {
      id,
      userId,
      channelName,
      message,
      attempts: 0,
      nextRetryAt: Date.now(), // immediate
      createdAt: Date.now(),
    }

    this.queue.set(id, entry)
    log.debug("message enqueued", { id, userId, channelName })
    void this.persist()
    return id
  }

  /**
   * Start the periodic flusher. Call once during startup.
   * The flusher calls `sendFn` for each due entry.
   *
   * @param sendFn - Async function that attempts delivery
   */
  startFlushing(sendFn: SendFn): void {
    if (this.flushTimer) return

    this.flushTimer = setInterval(async () => {
      await this.flush(sendFn)
    }, FLUSH_INTERVAL_MS)

    this.flushTimer.unref() // don't prevent process exit
    log.info("outbox flusher started", { intervalMs: FLUSH_INTERVAL_MS })
  }

  /** Stop the periodic flusher (called on shutdown). */
  stopFlushing(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Process all due entries. Called by the timer and optionally on-demand.
   * @param sendFn - Delivery function
   */
  async flush(sendFn: SendFn): Promise<void> {
    const now = Date.now()
    const due = [...this.queue.values()].filter((e) => e.nextRetryAt <= now)
    if (due.length === 0) return

    log.debug("outbox flush", { due: due.length, total: this.queue.size })

    for (const entry of due) {
      const ok = await this.attemptDelivery(entry, sendFn)
      if (ok) {
        this.queue.delete(entry.id)
        edithMetrics.channelSendsTotal.inc({ channel: entry.channelName, status: "ok_retry" })
      } else {
        entry.attempts++
        if (entry.attempts >= MAX_ATTEMPTS) {
          this.deadLetter(entry, "max attempts exceeded")
          this.queue.delete(entry.id)
        } else {
          const delayMs = RETRY_DELAYS_MS[entry.attempts] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!
          // Add ±10% jitter to prevent thundering herd
          const jitter = delayMs * 0.1 * (Math.random() * 2 - 1)
          entry.nextRetryAt = now + delayMs + jitter
          log.debug("outbox retry scheduled", {
            id: entry.id,
            attempts: entry.attempts,
            nextRetryAt: new Date(entry.nextRetryAt).toISOString(),
          })
        }
      }
    }

    void this.persist()
  }

  /** Returns a snapshot of pending entries (for /health and monitoring). */
  getStatus(): { pending: number; deadLetters: number } {
    return { pending: this.queue.size, deadLetters: this.deadLetters.length }
  }

  /** Returns recent dead-letter entries (admin debugging). */
  getDeadLetters(limit = 20): DeadLetterEntry[] {
    return this.deadLetters.slice(-limit)
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async attemptDelivery(entry: OutboxEntry, sendFn: SendFn): Promise<boolean> {
    try {
      return await sendFn(entry.userId, entry.message)
    } catch (err) {
      log.warn("outbox delivery attempt failed", {
        id: entry.id,
        userId: entry.userId,
        channel: entry.channelName,
        attempt: entry.attempts + 1,
        err: String(err),
      })
      edithMetrics.channelSendsTotal.inc({ channel: entry.channelName, status: "error_retry" })
      return false
    }
  }

  private deadLetter(entry: OutboxEntry, reason: string): void {
    const dl: DeadLetterEntry = { ...entry, droppedAt: Date.now(), reason }
    this.deadLetters.push(dl)
    // Keep only the last 100 dead letters in memory
    if (this.deadLetters.length > 100) {
      this.deadLetters.splice(0, this.deadLetters.length - 100)
    }
    log.error("message dead-lettered — max retries exceeded", {
      id: entry.id,
      userId: entry.userId,
      channelName: entry.channelName,
      attempts: entry.attempts,
    })
    edithMetrics.errorsTotal.inc({ source: "outbox.dead_letter" })
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return
    try {
      const entries = [...this.queue.values()]
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true })
      await fs.writeFile(this.persistPath, JSON.stringify(entries, null, 2), "utf-8")
    } catch (err) {
      log.warn("outbox persist failed", { err: String(err) })
    }
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.persistPath) return
    try {
      const raw = await fs.readFile(this.persistPath, "utf-8")
      const entries = JSON.parse(raw) as OutboxEntry[]
      for (const entry of entries) {
        if (entry.attempts < MAX_ATTEMPTS) {
          this.queue.set(entry.id, entry)
        }
      }
      if (this.queue.size > 0) {
        log.info("outbox loaded from disk", { count: this.queue.size })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("outbox load from disk failed", { err: String(err) })
      }
    }
  }
}

/** Singleton outbox instance. */
export const outbox = new MessageOutbox()
