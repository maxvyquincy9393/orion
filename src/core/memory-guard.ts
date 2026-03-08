/**
 * @file memory-guard.ts
 * @description Heap memory pressure monitor for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Checks Node.js heap usage ratio every 60 seconds.
 *   At MEMORY_WARN_THRESHOLD (default 80%): evicts oldest sessions to free
 *   references and allow GC to reclaim memory.
 *   At MEMORY_CRITICAL_THRESHOLD (default 95%): initiates graceful shutdown
 *   to prevent an OOM crash that would lose state entirely.
 *   Started by startup.ts; timer is unref()-ed so it doesn't block process exit.
 *
 * @module core/memory-guard
 */

import { createLogger } from "../logger.js"
import { sessionStore } from "../sessions/session-store.js"
import { performShutdown } from "./shutdown.js"
import { edithMetrics } from "../observability/metrics.js"
import config from "../config.js"

const log = createLogger("core.memory-guard")

/** How often to check heap usage (60 seconds). */
const CHECK_INTERVAL_MS = 60_000

/** Sessions idle longer than this are evicted under memory pressure (5 minutes). */
const PRESSURE_EVICT_IDLE_MS = 5 * 60 * 1_000

/**
 * Monitors heap usage and reacts to memory pressure by evicting sessions
 * or triggering graceful shutdown.
 */
export class MemoryGuard {
  /** Active check timer, null when stopped. */
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Run one memory check cycle.
   * Compares heapUsed / heapTotal against configured thresholds.
   */
  async check(): Promise<void> {
    const { heapUsed, heapTotal } = process.memoryUsage()
    const ratio = heapUsed / heapTotal

    if (ratio >= config.MEMORY_CRITICAL_THRESHOLD) {
      log.error("memory critical — initiating graceful shutdown", {
        heapUsedMB: Math.round(heapUsed / 1_048_576),
        ratio: ratio.toFixed(2),
        threshold: config.MEMORY_CRITICAL_THRESHOLD,
      })
      edithMetrics.errorsTotal.inc({ source: "memory_critical" })
      await performShutdown()
      return
    }

    if (ratio >= config.MEMORY_WARN_THRESHOLD) {
      log.warn("memory pressure — evicting idle sessions", {
        heapUsedMB: Math.round(heapUsed / 1_048_576),
        ratio: ratio.toFixed(2),
        threshold: config.MEMORY_WARN_THRESHOLD,
      })
      const evicted = sessionStore.cleanupInactiveSessions(PRESSURE_EVICT_IDLE_MS)
      log.info("session eviction complete", { evicted })
    }
  }

  /**
   * Start the periodic memory check. No-op if already running.
   */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.check() }, CHECK_INTERVAL_MS)
    this.timer.unref()
    log.info("memory guard started", {
      warnAt: config.MEMORY_WARN_THRESHOLD,
      criticalAt: config.MEMORY_CRITICAL_THRESHOLD,
    })
  }

  /** Stop the memory guard timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

/** Singleton memory guard. */
export const memoryGuard = new MemoryGuard()
