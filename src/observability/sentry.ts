/**
 * @file sentry.ts
 * @description Optional Sentry error tracking. No-op when SENTRY_DSN is unset.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Initialized by error-boundaries.ts at startup
 *   - captureException() called on uncaughtException/unhandledRejection
 *   - @sentry/node is dynamically imported — zero cost when not installed
 *   - SENTRY_DSN env var controls activation
 *
 * @module observability/sentry
 */

import { createLogger } from "../logger.js"

const log = createLogger("observability.sentry")

/** Whether Sentry has been successfully initialized. */
let sentryInitialized = false

/** Cached captureException function from @sentry/node. */
let captureExceptionFn: ((err: Error) => void) | null = null

/**
 * Initialize Sentry if SENTRY_DSN is configured and @sentry/node is installed.
 * Safe to call multiple times — only initializes once.
 */
async function init(): Promise<void> {
  if (sentryInitialized) return
  if (!process.env.SENTRY_DSN) return

  try {
    // Dynamic import — @sentry/node is an optional dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry = await import("@sentry/node" as any) as {
      init: (opts: { dsn: string; tracesSampleRate: number }) => void
      captureException: (err: Error) => void
    }
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    })
    captureExceptionFn = Sentry.captureException.bind(Sentry)
    sentryInitialized = true
    log.info("Sentry initialized")
  } catch {
    log.debug("@sentry/node not available — Sentry disabled")
  }
}

/**
 * Capture an exception in Sentry (if initialized).
 * No-op if Sentry is not available.
 */
function captureException(err: Error): void {
  if (captureExceptionFn) {
    captureExceptionFn(err)
  }
}

/** Whether Sentry is active. */
function isActive(): boolean {
  return sentryInitialized
}

export const sentry = { init, captureException, isActive }
