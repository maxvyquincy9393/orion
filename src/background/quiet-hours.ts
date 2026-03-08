/**
 * @file quiet-hours.ts
 * @description Hard-coded and adaptive quiet-hours guard for EDITH's proactive triggers.
 *
 * ARCHITECTURE:
 *   Two-layer system:
 *   1. Hard quiet hours (22:00–06:00): always enforced, cannot be learned away.
 *   2. AdaptiveQuietHours: learns from per-user message timestamps over 2+ weeks
 *      to dynamically extend or shift the quiet window based on actual sleep patterns.
 *
 *   Used by daemon.ts trigger loop and any module that needs to gate proactive
 *   notifications (e.g. HabitModel). Hard hours take precedence.
 *
 * PAPER BASIS:
 *   - PPP (arXiv:2511.02208): proactivity must respect user's circadian patterns
 *   - PersonaMem (arXiv:2504.14225): preferences evolve and shift over time
 */

import { createLogger } from "../logger.js"

const log = createLogger("background.quiet-hours")

/** Hard quiet start hour (22:00). Always enforced regardless of adaptive learning. */
const QUIET_HOURS_START = 22

/** Hard quiet end hour (06:00). Always enforced regardless of adaptive learning. */
const QUIET_HOURS_END = 6

/** Minimum observations before adaptive model has any confidence. */
const ADAPTIVE_MIN_OBSERVATIONS = 14

/** Confidence threshold (0–1) before adaptive schedule is trusted. */
const ADAPTIVE_CONFIDENCE_THRESHOLD = 0.65

/** Decay factor per week for stale observations (0.95 = 5% decay per week). */
const ADAPTIVE_DECAY_FACTOR = 0.95

/** Hours window around peak sleep time that is considered part of quiet period. */
const ADAPTIVE_QUIET_WINDOW_HOURS = 2

/**
 * Returns true if the given hour is within the hardcoded 22:00–06:00 quiet window.
 * This check is always enforced — use it as a fast gate before any adaptive check.
 */
export function isWithinHardQuietHours(date = new Date()): boolean {
  const hour = date.getHours()
  // 22:00–06:00 inclusive (hour <= 6 means 06:00 is still considered quiet)
  return hour >= QUIET_HOURS_START || hour <= QUIET_HOURS_END
}

/** Per-user activity record used by the adaptive model. */
export interface ActivityRecord {
  /** Unix timestamp (ms) of the activity. */
  timestamp: number
  /** Weight of the observation (decays over time). */
  weight: number
}

/** Snapshot of the adaptive model's current confidence and learned window. */
export interface AdaptiveQuietSnapshot {
  /** Whether the model has enough data to be trusted. */
  confident: boolean
  /** Confidence value 0–1. */
  confidence: number
  /** Inferred quiet start hour (0–23), or null if not yet determined. */
  quietStartHour: number | null
  /** Inferred quiet end hour (0–23), or null if not yet determined. */
  quietEndHour: number | null
  /** Total observation count. */
  observations: number
}

/**
 * Adaptive quiet-hours model for a single user.
 *
 * Learns from message send timestamps to infer sleep/inactive hours.
 * Only trusted after ADAPTIVE_MIN_OBSERVATIONS records with sufficient confidence.
 *
 * Usage:
 *   1. Call `record(timestamp)` each time the user sends a message.
 *   2. Call `isQuiet(date)` to check if the adaptive model suggests quiet time.
 *   3. Call `getSnapshot()` for debug/logging.
 */
export class AdaptiveQuietHours {
  private readonly userId: string
  private records: ActivityRecord[] = []

  constructor(userId: string) {
    this.userId = userId
  }

  /**
   * Record a user activity event (e.g. message sent).
   * Applies temporal decay to existing records before adding the new one.
   */
  record(timestamp = Date.now()): void {
    const nowWeek = timestamp / (7 * 24 * 60 * 60 * 1000)
    this.records = this.records.map((record) => {
      const ageWeeks = nowWeek - record.timestamp / (7 * 24 * 60 * 60 * 1000)
      return {
        ...record,
        weight: record.weight * Math.pow(ADAPTIVE_DECAY_FACTOR, Math.max(0, ageWeeks)),
      }
    })

    this.records.push({ timestamp, weight: 1.0 })

    // Prune zero-weight records to avoid unbounded growth.
    this.records = this.records.filter((record) => record.weight > 0.01)

    log.debug("activity recorded", { userId: this.userId, total: this.records.length })
  }

  /**
   * Estimate the probability that each hour of the day (0–23) is a "quiet" (sleep) hour
   * based on the distribution of activity timestamps.
   *
   * @returns Array of 24 floats (0=active, 1=quiet) indexed by hour.
   */
  private computeHourActivityDistribution(): number[] {
    const hourWeights = new Array<number>(24).fill(0)
    const totalWeight = this.records.reduce((sum, record) => sum + record.weight, 0)

    if (totalWeight === 0) {
      return hourWeights
    }

    for (const record of this.records) {
      const hour = new Date(record.timestamp).getHours()
      hourWeights[hour] += record.weight
    }

    // Normalize to 0–1 (fraction of activity at each hour).
    return hourWeights.map((w) => w / totalWeight)
  }

  /**
   * Find the most likely quiet window using a sliding window of low-activity hours.
   *
   * @returns { quietStart, quietEnd, confidence } or null if insufficient data.
   */
  private findQuietWindow(): { quietStart: number; quietEnd: number; confidence: number } | null {
    if (this.records.length < ADAPTIVE_MIN_OBSERVATIONS) {
      return null
    }

    const activity = this.computeHourActivityDistribution()
    // Inactivity = inverse of activity (we want hours with low message frequency)
    const inactivity = activity.map((a) => 1 - a)

    // Sliding window sum over ADAPTIVE_QUIET_WINDOW_HOURS * 2 + 1 hours
    const windowSize = ADAPTIVE_QUIET_WINDOW_HOURS * 2 + 1
    let bestStart = 0
    let bestScore = -1

    for (let start = 0; start < 24; start += 1) {
      let score = 0
      for (let offset = 0; offset < windowSize; offset += 1) {
        score += inactivity[(start + offset) % 24] ?? 0
      }
      if (score > bestScore) {
        bestScore = score
        bestStart = start
      }
    }

    const maxPossibleScore = windowSize
    const confidence = Math.min(1, bestScore / maxPossibleScore)
    const quietEnd = (bestStart + windowSize) % 24

    return { quietStart: bestStart, quietEnd, confidence }
  }

  /**
   * Returns true if the adaptive model considers the given date/time to be a quiet period.
   * Falls back to false (allow) if model is not yet confident enough.
   */
  isQuiet(date = new Date()): boolean {
    const window = this.findQuietWindow()
    if (!window || window.confidence < ADAPTIVE_CONFIDENCE_THRESHOLD) {
      return false
    }

    const hour = date.getHours()
    const { quietStart, quietEnd } = window

    if (quietStart <= quietEnd) {
      return hour >= quietStart && hour < quietEnd
    }

    // Wraps midnight (e.g. 23:00–05:00)
    return hour >= quietStart || hour < quietEnd
  }

  /**
   * Returns a snapshot of the adaptive model's current state for logging/debugging.
   */
  getSnapshot(): AdaptiveQuietSnapshot {
    const window = this.findQuietWindow()

    return {
      confident: window !== null && window.confidence >= ADAPTIVE_CONFIDENCE_THRESHOLD,
      confidence: window?.confidence ?? 0,
      quietStartHour: window?.quietStart ?? null,
      quietEndHour: window?.quietEnd ?? null,
      observations: this.records.length,
    }
  }

  /**
   * Export records for persistence (e.g. Prisma or edith.json).
   */
  exportRecords(): ActivityRecord[] {
    return [...this.records]
  }

  /**
   * Import previously persisted records (call during startup).
   */
  importRecords(records: ActivityRecord[]): void {
    this.records = records.filter(
      (record) =>
        typeof record.timestamp === "number"
        && typeof record.weight === "number"
        && record.weight > 0,
    )
    log.debug("records imported", { userId: this.userId, count: this.records.length })
  }
}

export const __quietHoursTestUtils = {
  QUIET_HOURS_START,
  QUIET_HOURS_END,
  ADAPTIVE_MIN_OBSERVATIONS,
  ADAPTIVE_CONFIDENCE_THRESHOLD,
}
