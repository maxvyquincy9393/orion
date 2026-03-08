/**
 * @file shutdown.ts
 * @description Graceful shutdown sequence for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by SIGTERM and SIGINT handlers registered in startup.ts.
 *   Shutdown sequence (10s timeout, then force exit):
 *     1. Final outbox flush
 *     2. Stop outbox flusher timer
 *     3. Stop daemon background loop
 *     4. Stop all channels
 *     5. Stop Python sidecars
 *     6. Destroy pipeline rate limiter timer
 *     7. WAL checkpoint (flush WAL → main DB file)
 *     8. Prisma disconnect
 *    Callers are responsible for calling process.exit(0) after this resolves.
 *
 * @module core/shutdown
 */

import path from "node:path"
import { outbox } from "../channels/outbox.js"
import { channelManager } from "../channels/manager.js"
import { sidecarManager } from "./sidecar-manager.js"
import { prisma } from "../database/index.js"
import { pipelineRateLimiter } from "../security/pipeline-rate-limiter.js"
import { daemon } from "../background/daemon.js"
import { createLogger } from "../logger.js"
import { SessionPersistence } from "../sessions/session-persistence.js"

const log = createLogger("core.shutdown")

/** Timeout before force-exiting if graceful shutdown hangs (10 seconds). */
const SHUTDOWN_TIMEOUT_MS = 10_000

/** Guards against multiple concurrent shutdown calls. */
let shutdownCalled = false

/** FOR TESTING ONLY — reset the once-only guard between test cases. */
export function _resetShutdownState(): void {
  shutdownCalled = false
}

/**
 * Perform a graceful shutdown of all EDITH services.
 *
 * Idempotent — subsequent calls after the first are silently ignored.
 * A 10-second watchdog timer force-exits the process if any shutdown step hangs.
 *
 * Shutdown order:
 *   1. Final outbox flush (best-effort delivery of pending messages)
 *   2. Stop outbox retry flusher timer
 *   3. Stop daemon background loop
 *   4. Stop all channel adapters
 *   5. Stop Python sidecars
 *   6. Destroy pipeline rate limiter eviction timer
 *   7. SQLite WAL checkpoint (flush WAL → main database file)
 *   8. Prisma disconnect
 *
 * Resolves cleanly when all steps complete. Callers should call process.exit(0)
 * after awaiting. The internal watchdog timer calls process.exit(1) if any
 * shutdown step hangs beyond SHUTDOWN_TIMEOUT_MS (last-resort escape hatch).
 */
export async function performShutdown(): Promise<void> {
  if (shutdownCalled) return
  shutdownCalled = true

  log.info("graceful shutdown started")

  const timer = setTimeout(() => {
    log.error("shutdown timed out — force exiting", { timeoutMs: SHUTDOWN_TIMEOUT_MS })
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)

  try {
    // 0. Persist active sessions before shutdown
    const sessionPersistence = new SessionPersistence(path.resolve(process.cwd(), ".edith"))
    await sessionPersistence.save()
      .catch((err) => log.warn("session persist failed", { err: String(err) }))

    // 1. Final outbox flush — best-effort delivery of any pending messages
    await outbox
      .flush((userId, message) => channelManager.send(userId, message))
      .catch((err) => log.warn("final outbox flush failed", { err: String(err) }))

    // 2. Stop outbox retry flusher timer
    outbox.stopFlushing()

    // 3. Stop daemon background loop
    if (daemon.isRunning()) daemon.stop()

    // 4. Stop all channel adapters
    await channelManager
      .stop()
      .catch((err) => log.warn("channel manager stop failed", { err: String(err) }))

    // 5. Stop Python sidecars
    sidecarManager.stopAll()

    // 6. Destroy pipeline rate limiter eviction timer
    pipelineRateLimiter.destroy()

    // 7. SQLite WAL checkpoint — flush WAL to the main DB file before disconnect
    await prisma
      .$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)")
      .catch((err) => log.warn("WAL checkpoint failed", { err: String(err) }))

    // 8. Disconnect Prisma
    await prisma
      .$disconnect()
      .catch((err) => log.warn("prisma disconnect failed", { err: String(err) }))

    log.info("graceful shutdown complete")
  } finally {
    clearTimeout(timer)
  }
}
