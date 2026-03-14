/**
 * @file shutdown.ts
 * @description Graceful shutdown orchestration with in-flight request draining.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by startup.ts shutdown handler and SIGTERM/SIGINT handlers.
 *   Ensures all in-flight requests complete, outbox flushes, and resources close
 *   in the correct order to prevent data loss.
 *
 *   Shutdown sequence:
 *     1. Stop accepting new connections (set draining flag)
 *     2. Drain in-flight pipeline requests (30s max)
 *     3. Flush outbox
 *     4. Stop background workers (daemon)
 *     5. Close DB connections (Prisma disconnect)
 *     6. Final log
 */

import { createLogger } from "../logger.js"

const log = createLogger("core.shutdown")

/** Default maximum time (ms) to wait for in-flight requests to complete. */
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000

/** Polling interval (ms) when waiting for in-flight requests to reach zero. */
const DRAIN_POLL_INTERVAL_MS = 250

/**
 * Dependencies injected into performShutdown to avoid circular imports.
 * Each dependency is optional — shutdown proceeds even if a subsystem is unavailable.
 */
export interface ShutdownDeps {
  /** Flush the message outbox (e.g., outbox.flush()). */
  flushOutbox?: () => Promise<void>
  /** Stop the background daemon loop. */
  stopDaemon?: () => Promise<void> | void
  /** Disconnect from the database (e.g., prisma.$disconnect()). */
  disconnectDb?: () => Promise<void>
  /** Stop accepting new gateway connections (e.g., server.close()). */
  closeGateway?: () => Promise<void>
}

/**
 * Manages in-flight request tracking and graceful shutdown sequencing.
 *
 * Usage:
 *   - Call `trackRequest()` at pipeline entry, `untrackRequest()` at pipeline exit.
 *   - Call `performShutdown(deps)` from signal handlers to drain and tear down.
 */
export class ShutdownManager {
  /** Number of pipeline requests currently being processed. */
  private inFlightCount = 0

  /** Set to true once shutdown has been initiated. */
  private draining = false

  /** Resolves when shutdown is fully complete. Prevents double-shutdown. */
  private shutdownPromise: Promise<void> | null = null

  /**
   * Returns whether the system is currently draining (shutting down).
   * New requests should be rejected when this returns true.
   */
  isDraining(): boolean {
    return this.draining
  }

  /**
   * Returns the current number of in-flight pipeline requests.
   */
  getInFlightCount(): number {
    return this.inFlightCount
  }

  /**
   * Increment the in-flight request counter.
   * Call at the beginning of pipeline processing for each request.
   *
   * @returns false if the system is draining and the request should be rejected.
   */
  trackRequest(): boolean {
    if (this.draining) {
      return false
    }
    this.inFlightCount += 1
    return true
  }

  /**
   * Decrement the in-flight request counter.
   * Call at the end of pipeline processing (in a finally block).
   */
  untrackRequest(): void {
    if (this.inFlightCount > 0) {
      this.inFlightCount -= 1
    }
  }

  /**
   * Wait for all in-flight requests to complete, up to a maximum timeout.
   *
   * @param timeoutMs - Maximum time to wait before force-proceeding (default 30s).
   * @returns true if all requests drained; false if timed out.
   */
  async drainInFlight(timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): Promise<boolean> {
    if (this.inFlightCount === 0) {
      return true
    }

    log.info("draining in-flight requests", { count: this.inFlightCount, timeoutMs })

    const deadline = Date.now() + timeoutMs

    while (this.inFlightCount > 0 && Date.now() < deadline) {
      await this.sleep(DRAIN_POLL_INTERVAL_MS)
    }

    if (this.inFlightCount > 0) {
      log.warn("drain timeout reached, proceeding with shutdown", {
        remaining: this.inFlightCount,
        timeoutMs,
      })
      return false
    }

    log.info("all in-flight requests drained")
    return true
  }

  /**
   * Execute the full graceful shutdown sequence.
   *
   * Idempotent: calling multiple times returns the same promise.
   *
   * @param deps - Optional subsystem hooks to call during shutdown.
   */
  async performShutdown(deps: ShutdownDeps = {}): Promise<void> {
    if (this.shutdownPromise) {
      log.info("shutdown already in progress, waiting")
      return this.shutdownPromise
    }

    this.shutdownPromise = this.executeShutdownSequence(deps)
    return this.shutdownPromise
  }

  /**
   * Internal shutdown sequence implementation.
   *
   * @param deps - Subsystem hooks.
   */
  private async executeShutdownSequence(deps: ShutdownDeps): Promise<void> {
    const startedAt = Date.now()
    log.info("graceful shutdown initiated")

    // Step 1: Stop accepting new connections
    this.draining = true
    if (deps.closeGateway) {
      try {
        await deps.closeGateway()
        log.info("gateway closed")
      } catch (err) {
        log.warn("gateway close failed", { error: err })
      }
    }

    // Step 2: Drain in-flight requests
    await this.drainInFlight()

    // Step 3: Flush outbox
    if (deps.flushOutbox) {
      try {
        await deps.flushOutbox()
        log.info("outbox flushed")
      } catch (err) {
        log.warn("outbox flush failed", { error: err })
      }
    }

    // Step 4: Stop background workers
    if (deps.stopDaemon) {
      try {
        await Promise.resolve(deps.stopDaemon())
        log.info("daemon stopped")
      } catch (err) {
        log.warn("daemon stop failed", { error: err })
      }
    }

    // Step 5: Close DB connections
    if (deps.disconnectDb) {
      try {
        await deps.disconnectDb()
        log.info("database disconnected")
      } catch (err) {
        log.warn("database disconnect failed", { error: err })
      }
    }

    // Step 6: Final log
    const elapsedMs = Date.now() - startedAt
    log.info("shutdown complete", { elapsedMs })
  }

  /**
   * Reset internal state. Intended for testing only.
   */
  reset(): void {
    this.inFlightCount = 0
    this.draining = false
    this.shutdownPromise = null
  }

  /** Promise-based sleep utility. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }
}

/** Singleton shutdown manager instance. */
export const shutdownManager = new ShutdownManager()

// ---------------------------------------------------------------------------
// Backward-compatible free-function API
// ---------------------------------------------------------------------------
// Several modules (error-boundaries.ts, startup.ts, memory-guard.ts) import
// `performShutdown` as a free function with no arguments. This wrapper imports
// the concrete subsystems and delegates to them directly.
// ---------------------------------------------------------------------------

/** Guard to ensure the free-function shutdown only runs once. */
let shutdownCalled = false

/**
 * Legacy free-function shutdown entry point.
 *
 * Imported by error-boundaries.ts, startup.ts, and memory-guard.ts.
 * Performs the full teardown sequence: stop outbox, stop channels, stop daemon,
 * stop sidecars, WAL checkpoint, Prisma disconnect.
 */
export async function performShutdown(): Promise<void> {
  if (shutdownCalled) return
  shutdownCalled = true

  log.info("performShutdown() invoked")

  // Dynamic imports avoid circular dependency issues
  // (these modules may import from core/* which imports shutdown.js).
  try {
    const [
      { outbox },
      { channelManager },
      { sidecarManager },
      { prisma },
      { pipelineRateLimiter },
      { daemon },
    ] = await Promise.all([
      import("../channels/outbox.js"),
      import("../channels/manager.js"),
      import("./sidecar-manager.js"),
      import("../database/index.js"),
      import("../security/pipeline-rate-limiter.js"),
      import("../background/daemon.js"),
    ])

    // 1. Stop outbox flushing
    try { outbox.stopFlushing() } catch (err) { log.warn("outbox stopFlushing failed", { error: err }) }

    // 2. Stop channels
    try { await channelManager.stop() } catch (err) { log.warn("channelManager stop failed", { error: err }) }

    // 3. Stop daemon
    try {
      if (typeof daemon.isRunning === "function" && daemon.isRunning()) {
        daemon.stop()
      }
    } catch (err) { log.warn("daemon stop failed", { error: err }) }

    // 4. Stop sidecars
    try { sidecarManager.stopAll() } catch (err) { log.warn("sidecarManager stopAll failed", { error: err }) }

    // 5. Destroy rate limiter
    try { pipelineRateLimiter.destroy() } catch (err) { log.warn("rateLimiter destroy failed", { error: err }) }

    // 6. WAL checkpoint
    try { await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)") } catch (err) { log.warn("WAL checkpoint failed", { error: err }) }

    // 7. Prisma disconnect
    try { await prisma.$disconnect() } catch (err) { log.warn("prisma disconnect failed", { error: err }) }

    log.info("performShutdown() complete")
  } catch (err) {
    log.error("performShutdown() failed during import resolution", { error: err })
  }
}

/**
 * Reset the once-only guard so tests can call performShutdown() multiple times.
 * @internal Test-only export.
 */
export function _resetShutdownState(): void {
  shutdownCalled = false
  shutdownManager.reset()
}
