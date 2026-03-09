/**
 * @file error-boundaries.ts
 * @description Global process-level error boundaries for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called once at the very start of startup.ts initialize() before any async work.
 *   Two handlers are registered:
 *     - unhandledRejection: log + increment errorsTotal metric. Does NOT crash the
 *       process — unhandled rejections are often recoverable in long-running servers.
 *     - uncaughtException: log + call performShutdown() — exceptions are unrecoverable
 *       (unknown process state) so we shut down cleanly rather than crash abruptly.
 *   Idempotent: safe to call multiple times, only registers once.
 *
 * @module core/error-boundaries
 */

import { createLogger } from "../logger.js"
import { edithMetrics } from "../observability/metrics.js"
import { sentry } from "../observability/sentry.js"
import { performShutdown } from "./shutdown.js"

const log = createLogger("core.error-boundaries")

/** Guard to ensure handlers are only registered once. */
let registered = false

/**
 * Register global process error boundaries.
 * Call once at the start of initialize() in startup.ts.
 * Idempotent — subsequent calls are no-ops.
 */
export function registerErrorBoundaries(): void {
  if (registered) return
  registered = true

  // Initialize Sentry (no-op if SENTRY_DSN not set or @sentry/node not installed)
  void sentry.init()

  process.on("unhandledRejection", (reason: unknown) => {
    log.error("unhandled promise rejection — continuing", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
    edithMetrics.errorsTotal.inc({ source: "unhandled_rejection" })
    sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)))
  })

  process.on("uncaughtException", (err: Error) => {
    log.error("uncaught exception — initiating graceful shutdown", {
      err: err.message,
      stack: err.stack,
    })
    edithMetrics.errorsTotal.inc({ source: "uncaught_exception" })
    sentry.captureException(err)
    void performShutdown()
  })

  log.info("error boundaries registered")
}

/** FOR TESTING ONLY — reset the registration guard between tests. */
export function _resetErrorBoundaries(): void {
  registered = false
}
