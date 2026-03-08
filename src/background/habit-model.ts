/**
 * @file habit-model.ts
 * @description HabitModel — learns per-user routine patterns from message timestamps
 *              to enable proactive context-aware triggers.
 *
 * ARCHITECTURE:
 *   HabitModel runs as a background service (updated every HABIT_MODEL_UPDATE_INTERVAL_MS).
 *   It maintains a per-user activity histogram (by hour × day-of-week) using exponential
 *   moving average with a weekly decay factor.
 *
 *   Outputs:
 *     - getActiveHours(userId): number[] — hours (0–23) where user is typically active
 *     - getQuietHours(userId): number[] — hours where user is typically inactive/sleeping
 *     - isLikelyActive(userId, date): boolean — point-in-time prediction
 *     - getProactiveHints(userId): ProactiveHint[] — scheduled habit-based triggers
 *
 *   Integration:
 *     - daemon.ts: reads getProactiveHints() to decide when to send proactive messages
 *     - quiet-hours.ts: AdaptiveQuietHours uses records from this model
 *     - message-pipeline.ts Stage 9: calls model.record() for each user message
 *
 * PAPER BASIS:
 *   - PPP (arXiv:2511.02208): proactive agents must respect user availability
 *   - PersonaMem (arXiv:2504.14225): behavioral patterns evolve over time
 *   Note: routine detection uses exponential smoothing, not neural networks.
 *         This is intentional — deterministic, explainable, CPU-only.
 *
 * @module background/habit-model
 */

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("background.habit-model")

/** Hours below this activity percentile are considered "quiet". */
const QUIET_HOUR_PERCENTILE = 0.2

/** Hours above this activity percentile are considered "active". */
const ACTIVE_HOUR_PERCENTILE = 0.6

/** Minimum activity weight before a period is considered "established". */
const MIN_ESTABLISHED_WEIGHT = 0.3

/** Decay factor applied per week to each activity record's weight. */
const WEEKLY_DECAY_FACTOR = 0.95

/** Maximum number of activity records per user (sliding window). */
const MAX_RECORDS_PER_USER = 200

/**
 * A proactive hint from the habit model suggesting when and what to trigger.
 */
export interface ProactiveHint {
  /** User ID this hint applies to. */
  userId: string
  /** Suggested hour to deliver the hint (0–23). */
  suggestedHour: number
  /** Category of the hint. */
  category: "morning-brief" | "work-start" | "work-end" | "evening-check"
  /** Confidence score (0–1). */
  confidence: number
  /** Human-readable description for the trigger. */
  description: string
}

/**
 * Per-user activity histogram (hour × day-of-week → total weight).
 * 24 hours × 7 days = 168 cells.
 */
interface ActivityHistogram {
  /** Total weighted activity count per hour (0–23). */
  hourly: number[]
  /** Total weighted activity per day-of-week (0=Sunday…6=Saturday). */
  daily: number[]
  /** Total weight of all observations. */
  totalWeight: number
}

/**
 * HabitModel — learns user activity patterns from message timestamps.
 *
 * Stores compressed per-hour activity records to Prisma for persistence across restarts.
 */
export class HabitModel {
  /** In-memory histogram cache — rebuilt from Prisma on startup or cache miss. */
  private readonly histogramCache = new Map<string, ActivityHistogram>()
  private updateTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Record a user activity event (e.g. message sent).
   * Updates the in-memory histogram and queues a Prisma write.
   *
   * @param userId    - User who was active
   * @param timestamp - Unix timestamp (ms), defaults to now
   */
  async record(userId: string, timestamp = Date.now()): Promise<void> {
    if (!config.HABIT_MODEL_ENABLED) {
      return
    }

    try {
      const date = new Date(timestamp)
      const hour = date.getHours()
      const dayOfWeek = date.getDay()

      // Update in-memory histogram
      const hist = this.getOrCreateHistogram(userId)
      hist.hourly[hour] = (hist.hourly[hour] ?? 0) + 1
      hist.daily[dayOfWeek] = (hist.daily[dayOfWeek] ?? 0) + 1
      hist.totalWeight += 1

      // Persist activity record to Prisma (for cross-restart persistence)
      await prisma.activityRecord.create({
        data: { userId, hour, dayOfWeek, weight: 1.0 },
      })

      // Prune old records if needed
      void this.pruneOldRecords(userId)
        .catch((err) => log.debug("prune failed (non-critical)", { err }))
    } catch (err) {
      log.debug("habit record failed (non-critical)", { userId, err })
    }
  }

  /**
   * Returns the hours (0–23) where this user is typically active.
   * Returns an empty array if insufficient data.
   */
  async getActiveHours(userId: string): Promise<number[]> {
    const hist = await this.loadHistogram(userId)
    if (hist.totalWeight < 10) {
      return [] // Not enough data
    }

    const maxActivity = Math.max(...hist.hourly)
    if (maxActivity === 0) {
      return []
    }

    return hist.hourly
      .map((weight, hour) => ({ hour, ratio: weight / maxActivity }))
      .filter((item) => item.ratio >= ACTIVE_HOUR_PERCENTILE)
      .map((item) => item.hour)
  }

  /**
   * Returns hours (0–23) where this user is typically inactive.
   */
  async getQuietHours(userId: string): Promise<number[]> {
    const hist = await this.loadHistogram(userId)
    if (hist.totalWeight < 10) {
      return []
    }

    const maxActivity = Math.max(...hist.hourly)
    if (maxActivity === 0) {
      return [...Array(24).keys()]
    }

    return hist.hourly
      .map((weight, hour) => ({ hour, ratio: weight / maxActivity }))
      .filter((item) => item.ratio <= QUIET_HOUR_PERCENTILE)
      .map((item) => item.hour)
  }

  /**
   * Returns true if the user is likely active at the given date/time.
   *
   * @param userId - User to check
   * @param date   - Point in time (defaults to now)
   */
  async isLikelyActive(userId: string, date = new Date()): Promise<boolean> {
    const hist = await this.loadHistogram(userId)
    if (hist.totalWeight < 10) {
      return true // Not enough data — assume active (fail-open)
    }

    const hour = date.getHours()
    const maxActivity = Math.max(...hist.hourly)
    const hourActivity = hist.hourly[hour] ?? 0
    const ratio = maxActivity > 0 ? hourActivity / maxActivity : 0

    return ratio >= QUIET_HOUR_PERCENTILE
  }

  /**
   * Generate proactive hints based on observed activity patterns.
   * Used by daemon.ts to schedule contextual notifications.
   *
   * @param userId - User to generate hints for
   * @returns Array of ProactiveHint objects (may be empty if insufficient data)
   */
  async getProactiveHints(userId: string): Promise<ProactiveHint[]> {
    const hist = await this.loadHistogram(userId)
    if (hist.totalWeight < 14) {
      return [] // Need at least 2 weeks of data for reliable hints
    }

    const hints: ProactiveHint[] = []
    const maxActivity = Math.max(...hist.hourly)
    if (maxActivity === 0) {
      return []
    }

    const normalizedHourly = hist.hourly.map((w) => w / maxActivity)

    // Morning brief: first active hour in morning (6–11)
    const morningHour = this.findPeakHour(normalizedHourly, 6, 11)
    if (morningHour !== null && normalizedHourly[morningHour]! >= MIN_ESTABLISHED_WEIGHT) {
      hints.push({
        userId,
        suggestedHour: morningHour,
        category: "morning-brief",
        confidence: normalizedHourly[morningHour]!,
        description: `User is typically active around ${morningHour}:00. Good time for a morning brief.`,
      })
    }

    // Work start: peak activity in work hours (8–12)
    const workStartHour = this.findPeakHour(normalizedHourly, 8, 12)
    if (workStartHour !== null && workStartHour !== morningHour) {
      hints.push({
        userId,
        suggestedHour: workStartHour,
        category: "work-start",
        confidence: normalizedHourly[workStartHour]!,
        description: `User typically starts work around ${workStartHour}:00.`,
      })
    }

    // Work end: peak in afternoon (16–20)
    const workEndHour = this.findPeakHour(normalizedHourly, 16, 20)
    if (workEndHour !== null && normalizedHourly[workEndHour]! >= MIN_ESTABLISHED_WEIGHT) {
      hints.push({
        userId,
        suggestedHour: workEndHour,
        category: "work-end",
        confidence: normalizedHourly[workEndHour]!,
        description: `User is typically winding down around ${workEndHour}:00.`,
      })
    }

    // Evening check: activity in evening (19–22)
    const eveningHour = this.findPeakHour(normalizedHourly, 19, 22)
    if (eveningHour !== null && eveningHour !== workEndHour) {
      hints.push({
        userId,
        suggestedHour: eveningHour,
        category: "evening-check",
        confidence: normalizedHourly[eveningHour]!,
        description: `User is typically available in the evening around ${eveningHour}:00.`,
      })
    }

    log.debug("proactive hints generated", { userId, count: hints.length })
    return hints
  }

  /**
   * Start the background update loop.
   * Updates the decay of activity records and rebuilds histograms.
   */
  startMonitoring(): void {
    if (!config.HABIT_MODEL_ENABLED || this.updateTimer !== null) {
      return
    }

    this.updateTimer = setInterval(() => {
      void this.runDecayCycle().catch((err) => {
        log.warn("decay cycle failed", { err })
      })
    }, config.HABIT_MODEL_UPDATE_INTERVAL_MS)

    log.info("habit model monitoring started")
  }

  /** Stop the background update loop. */
  stopMonitoring(): void {
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
  }

  // ============================================================
  //  Private helpers
  // ============================================================

  private getOrCreateHistogram(userId: string): ActivityHistogram {
    let hist = this.histogramCache.get(userId)
    if (!hist) {
      hist = {
        hourly: new Array<number>(24).fill(0),
        daily: new Array<number>(7).fill(0),
        totalWeight: 0,
      }
      this.histogramCache.set(userId, hist)
    }
    return hist
  }

  private async loadHistogram(userId: string): Promise<ActivityHistogram> {
    const cached = this.histogramCache.get(userId)
    if (cached) {
      return cached
    }

    const hist = this.getOrCreateHistogram(userId)

    try {
      const records = await prisma.activityRecord.findMany({
        where: { userId },
        orderBy: { timestamp: "desc" },
        take: MAX_RECORDS_PER_USER,
      })

      for (const record of records) {
        hist.hourly[record.hour] = (hist.hourly[record.hour] ?? 0) + record.weight
        hist.daily[record.dayOfWeek] = (hist.daily[record.dayOfWeek] ?? 0) + record.weight
        hist.totalWeight += record.weight
      }

      this.histogramCache.set(userId, hist)
    } catch (err) {
      log.debug("histogram load failed", { userId, err })
    }

    return hist
  }

  private async pruneOldRecords(userId: string): Promise<void> {
    const count = await prisma.activityRecord.count({ where: { userId } })
    if (count <= MAX_RECORDS_PER_USER) {
      return
    }

    const oldest = await prisma.activityRecord.findMany({
      where: { userId },
      orderBy: { timestamp: "asc" },
      take: count - MAX_RECORDS_PER_USER,
      select: { id: true },
    })

    if (oldest.length > 0) {
      await prisma.activityRecord.deleteMany({
        where: { id: { in: oldest.map((r) => r.id) } },
      })
    }
  }

  private async runDecayCycle(): Promise<void> {
    // Apply weekly decay to all recent records
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const records = await prisma.activityRecord.findMany({
      where: { timestamp: { lte: oneWeekAgo } },
    })

    for (const record of records) {
      const ageWeeks = (Date.now() - record.timestamp.getTime()) / (7 * 24 * 60 * 60 * 1000)
      const newWeight = record.weight * Math.pow(WEEKLY_DECAY_FACTOR, Math.max(0, ageWeeks - 1))

      if (newWeight < 0.01) {
        await prisma.activityRecord.delete({ where: { id: record.id } })
      } else {
        await prisma.activityRecord.update({
          where: { id: record.id },
          data: { weight: newWeight },
        })
      }
    }

    // Invalidate cache so next read rebuilds from updated records
    this.histogramCache.clear()
    log.debug("decay cycle complete", { processed: records.length })
  }

  /**
   * Find the hour with peak activity within a given range [startHour, endHour].
   * Returns null if no activity found in that range.
   */
  private findPeakHour(normalized: number[], startHour: number, endHour: number): number | null {
    let peak = -1
    let peakValue = 0

    for (let h = startHour; h <= endHour; h += 1) {
      const value = normalized[h] ?? 0
      if (value > peakValue) {
        peakValue = value
        peak = h
      }
    }

    return peak >= 0 && peakValue > 0 ? peak : null
  }
}

/** Singleton export. */
export const habitModel = new HabitModel()
