/**
 * @file voice-debounce.ts
 * @description Debounce voice transcripts to avoid redundant pipeline calls during continuous speech.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used by gateway/server.ts voice transcript WebSocket handler to coalesce
 *   rapid transcript updates into a single pipeline call after a silence window.
 *
 *   Each user gets an independent debounce timer. When a new transcript arrives
 *   before the timer fires, the previous timer is cancelled and a new one starts
 *   with the updated (latest) transcript text.
 */

import { createLogger } from "../logger.js"

const log = createLogger("gateway.voice-debounce")

/** Default silence window in milliseconds before committing a transcript. */
const DEFAULT_DEBOUNCE_DELAY_MS = 400

/**
 * Debounces voice transcript updates on a per-user basis.
 *
 * Each call to `debounce()` resets the timer for the given userId.
 * The callback fires only once after the silence window elapses,
 * receiving the most recent transcript text.
 */
export class VoiceDebouncer {
  /** Active timers keyed by userId. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Schedule (or reschedule) a debounced callback for a user's transcript.
   *
   * If called again for the same userId before the delay elapses,
   * the previous timer is cleared and replaced with a new one carrying
   * the latest transcript.
   *
   * @param userId - Unique user identifier.
   * @param transcript - The latest transcript text from the STT stream.
   * @param callback - Invoked with the final transcript after the silence window.
   * @param delayMs - Silence window in milliseconds (default 400ms).
   */
  debounce(
    userId: string,
    transcript: string,
    callback: (final: string) => void,
    delayMs: number = DEFAULT_DEBOUNCE_DELAY_MS,
  ): void {
    // Clear any existing timer for this user
    const existing = this.timers.get(userId)
    if (existing !== undefined) {
      clearTimeout(existing)
    }

    const timer = setTimeout(() => {
      this.timers.delete(userId)
      log.debug("voice debounce fired", { userId, transcriptLength: transcript.length })

      try {
        callback(transcript)
      } catch (err) {
        log.warn("voice debounce callback error", { userId, error: err })
      }
    }, delayMs)

    this.timers.set(userId, timer)
  }

  /**
   * Cancel a pending debounce timer for a specific user.
   *
   * @param userId - The user whose timer should be cancelled.
   * @returns true if a timer was found and cancelled; false otherwise.
   */
  cancel(userId: string): boolean {
    const timer = this.timers.get(userId)
    if (timer === undefined) {
      return false
    }
    clearTimeout(timer)
    this.timers.delete(userId)
    return true
  }

  /**
   * Returns the number of currently active debounce timers.
   */
  getActiveCount(): number {
    return this.timers.size
  }

  /**
   * Clear all pending debounce timers.
   * Call during shutdown or when the WebSocket handler is torn down.
   */
  dispose(): void {
    for (const [userId, timer] of this.timers) {
      clearTimeout(timer)
      log.debug("voice debounce timer disposed", { userId })
    }
    this.timers.clear()
  }
}

/** Singleton voice debouncer instance. */
export const voiceDebouncer = new VoiceDebouncer()
