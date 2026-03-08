/**
 * @file wellness-detector.ts
 * @description Detects stress, burnout, and negative spirals from mood trends.
 *
 * ARCHITECTURE:
 *   Runs after each MoodProfile update. When thresholds are exceeded,
 *   returns a WellnessAlert which can be injected into the system prompt
 *   as a gentle contextual nudge for EDITH to surface.
 *
 *   Only triggers once per cooldown period to avoid over-alerting.
 *   Requires EMOTION_WELLNESS_ENABLED=true.
 */

import { createLogger } from "../logger.js"
import config from "../config.js"
import type { MoodProfile, WellnessAlert } from "./emotion-schema.js"

const log = createLogger("emotion.wellness-detector")

/** Minimum ms between consecutive alerts for the same user+type. */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

/**
 * Detects user wellness concerns based on sustained negative mood signals.
 */
export class WellnessDetector {
  /** Last alert time keyed by `${userId}:${alertType}`. */
  private readonly lastAlert = new Map<string, number>()

  /**
   * Evaluates the mood profile and returns an alert if thresholds exceeded.
   *
   * @param userId - User identifier
   * @param profile - Current mood profile from MoodTracker
   * @param sessionStartMs - When the current session started (epoch ms)
   * @returns A WellnessAlert, or null if everything is fine
   */
  evaluate(
    userId: string,
    profile: MoodProfile,
    sessionStartMs: number,
  ): WellnessAlert | null {
    if (!config.EMOTION_WELLNESS_ENABLED) return null

    const { averageScore: avg, dominant } = profile
    const stressScore = avg.anger * 0.5 + avg.fear * 0.4 + avg.sadness * 0.3
    const sessionHours = (Date.now() - sessionStartMs) / 3_600_000

    // --- Burnout detection: extended high-stress session ---
    if (
      sessionHours >= config.EMOTION_BURNOUT_HOURS &&
      stressScore > config.EMOTION_STRESS_THRESHOLD * 0.8
    ) {
      return this.emit(userId, "burnout", "You've been at it for a while. Consider taking a short break.")
    }

    // --- Stress spike ---
    if (stressScore > config.EMOTION_STRESS_THRESHOLD) {
      return this.emit(
        userId,
        "stress",
        "You seem a bit stressed. Is there anything I can help prioritise or simplify?",
      )
    }

    // --- Negative spiral: 3+ consecutive negative-dominant samples ---
    if (
      (dominant === "sadness" || dominant === "anger" || dominant === "fear") &&
      profile.sampleCount >= 3
    ) {
      return this.emit(
        userId,
        "negative_spiral",
        "I've noticed a difficult emotional pattern lately. Just here if you want to talk.",
      )
    }

    return null
  }

  /** Emits an alert if outside cooldown. */
  private emit(
    userId: string,
    type: WellnessAlert["type"],
    suggestion: string,
  ): WellnessAlert | null {
    const key = `${userId}:${type}`
    const last = this.lastAlert.get(key) ?? 0
    if (Date.now() - last < ALERT_COOLDOWN_MS) return null

    this.lastAlert.set(key, Date.now())
    log.info("wellness alert emitted", { userId, type })
    return { type, userId, detectedAt: new Date(), suggestion }
  }
}

export const wellnessDetector = new WellnessDetector()
