/**
 * @file briefing-composer.ts
 * @description Composes JARVIS-style proactive briefings from calendar, memory,
 *              and system health data. Determines when a briefing should be sent
 *              and formats it in a structured, actionable style.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by background/daemon.ts during each cycle. Uses:
 *     - services/calendar.ts for upcoming events
 *     - memory/store.ts for pending tasks / reminders from memory
 *     - core/health.ts for system status
 *     - memory/user-preference.ts to check proactivity level
 *     - permissions/sandbox.ts for proactive message permission
 *
 *   Output is sent to the user via channels/manager.ts.
 *   Briefing deduplication: tracks last briefing time per user
 *   to avoid sending duplicate briefings within a cooldown window.
 */

import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
import { userPreferenceEngine } from "../memory/user-preference.js"
import { getAggregatedHealth } from "../core/health.js"
import { calendarService } from "../services/calendar.js"

const log = createLogger("background.briefing-composer")

/** Minimum gap between briefings for the same user (ms). */
const BRIEFING_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 hours

/** Maximum pending items from memory to include. */
const MAX_PENDING_ITEMS = 5

/** Hours considered as "morning" for greeting purposes. */
const MORNING_HOURS = { start: 5, end: 11 }
const AFTERNOON_HOURS = { start: 12, end: 17 }

// ── Types ───────────────────────────────────────────────────────────────────

/** Structured data for composing a briefing. */
export interface BriefingData {
  /** Time-appropriate greeting. */
  greeting: string
  /** Today's calendar events. */
  calendarItems: string[]
  /** Pending tasks or reminders from memory. */
  pendingItems: string[]
  /** System health summary, or null if all healthy. */
  systemStatus: string | null
}

/** Result of shouldBrief() check. */
export interface BriefingCheck {
  /** Whether a briefing should be sent. */
  should: boolean
  /** Reason for the decision. */
  reason: string
}

// ── BriefingComposer class ──────────────────────────────────────────────────

/**
 * Composes JARVIS-style proactive briefings.
 *
 * Usage:
 *   const check = await briefingComposer.shouldBrief(userId)
 *   if (check.should) {
 *     const message = await briefingComposer.compose(userId)
 *     await channelManager.send(userId, message)
 *     briefingComposer.recordBriefingSent(userId)
 *   }
 */
class BriefingComposer {
  /** Last briefing sent timestamp per user. */
  private readonly lastBriefingAt = new Map<string, number>()

  /**
   * Check whether a briefing should be sent for this user now.
   *
   * Conditions (all must be true):
   *   1. User's proactivity level >= 2
   *   2. No briefing sent within the cooldown window
   *   3. Current hour is within waking hours (5-22)
   *
   * @param userId - The user to check.
   * @returns BriefingCheck with decision and reasoning.
   */
  async shouldBrief(userId: string): Promise<BriefingCheck> {
    // Check proactivity level
    let proactivity = 3
    try {
      const prefs = await userPreferenceEngine.getSnapshot(userId)
      proactivity = prefs.proactivity
    } catch {
      // Preference unavailable — use default
    }

    if (proactivity < 2) {
      return { should: false, reason: `proactivity too low (${proactivity})` }
    }

    // Check cooldown
    const lastSent = this.lastBriefingAt.get(userId) ?? 0
    const elapsed = Date.now() - lastSent
    if (elapsed < BRIEFING_COOLDOWN_MS) {
      const remainingMin = Math.round((BRIEFING_COOLDOWN_MS - elapsed) / 60_000)
      return { should: false, reason: `cooldown active (${remainingMin}m remaining)` }
    }

    // Check waking hours
    const hour = new Date().getHours()
    if (hour < 5 || hour > 22) {
      return { should: false, reason: `outside waking hours (${hour}:00)` }
    }

    return { should: true, reason: "all conditions met" }
  }

  /**
   * Compose a full JARVIS-style briefing message.
   *
   * Gathers data from calendar, memory, and health subsystems. Each section
   * is optional — if a data source is unavailable, the section is simply
   * omitted rather than showing an error.
   *
   * @param userId - The user to compose for.
   * @returns Formatted briefing string ready to send.
   */
  async compose(userId: string): Promise<string> {
    const data = await this.gatherData(userId)
    return this.format(data)
  }

  /**
   * Record that a briefing was sent, starting the cooldown timer.
   *
   * @param userId - The user who received the briefing.
   */
  recordBriefingSent(userId: string): void {
    this.lastBriefingAt.set(userId, Date.now())
    log.info("briefing sent", { userId })
  }

  /**
   * Get time since last briefing for a user.
   *
   * @param userId - The user to check.
   * @returns Milliseconds since last briefing, or Infinity if never briefed.
   */
  getTimeSinceLastBriefing(userId: string): number {
    const lastSent = this.lastBriefingAt.get(userId)
    if (!lastSent) {
      return Infinity
    }
    return Date.now() - lastSent
  }

  /**
   * Reset state. Intended for testing.
   */
  reset(): void {
    this.lastBriefingAt.clear()
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Gather briefing data from all available sources.
   * Each source is queried independently — failures are isolated.
   */
  private async gatherData(userId: string): Promise<BriefingData> {
    const greeting = this.buildGreeting(userId)
    const calendarItems = await this.gatherCalendarItems()
    const pendingItems = await this.gatherPendingItems(userId)
    const systemStatus = await this.gatherSystemStatus()

    return { greeting, calendarItems, pendingItems, systemStatus }
  }

  /**
   * Build a time-appropriate greeting.
   */
  private buildGreeting(_userId: string): string {
    const hour = new Date().getHours()

    // Fetch title word would require async; use "Sir" as default.
    // The LLM will use the user's actual title from the personality engine.
    const title = "Sir"

    if (hour >= MORNING_HOURS.start && hour <= MORNING_HOURS.end) {
      return `Good morning, ${title}. Here is your daily briefing.`
    }
    if (hour >= AFTERNOON_HOURS.start && hour <= AFTERNOON_HOURS.end) {
      return `Good afternoon, ${title}. Here is your status update.`
    }
    return `Good evening, ${title}. Here is your current status.`
  }

  /**
   * Gather upcoming calendar events for today.
   */
  private async gatherCalendarItems(): Promise<string[]> {
    try {
      await calendarService.init()
      // Get events within the next 12 hours
      const alerts = await calendarService.getUpcomingAlerts(720)
      return alerts.slice(0, 8).map((alert) => {
        const time = alert.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        const location = alert.location ? ` (${alert.location})` : ""
        return `${time} — ${alert.title}${location}`
      })
    } catch (err) {
      log.debug("calendar data unavailable for briefing", { error: String(err) })
      return []
    }
  }

  /**
   * Gather pending tasks and reminders from memory.
   */
  private async gatherPendingItems(userId: string): Promise<string[]> {
    try {
      const context = await memory.buildContext(userId, "pending tasks reminders todo due soon")
      if (!context.systemContext || context.systemContext.trim().length === 0) {
        return []
      }

      // Extract actionable items from memory context
      const lines = context.systemContext
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 10 && l.length < 200)
        .filter((l) =>
          /(?:todo|remind|pending|due|deadline|need to|finish|complete|submit)/i.test(l),
        )
        .slice(0, MAX_PENDING_ITEMS)

      return lines
    } catch (err) {
      log.debug("memory data unavailable for briefing", { error: String(err) })
      return []
    }
  }

  /**
   * Check system health and return a summary only if something is degraded.
   */
  private async gatherSystemStatus(): Promise<string | null> {
    try {
      const health = await getAggregatedHealth()

      if (health.status === "healthy") {
        return null // All good — no need to mention
      }

      const issues: string[] = []
      for (const [name, component] of Object.entries(health.components)) {
        if (component.status !== "healthy") {
          issues.push(`${name}: ${component.status}${component.message ? ` — ${component.message}` : ""}`)
        }
      }

      if (issues.length === 0) {
        return null
      }

      return issues.join("; ")
    } catch (err) {
      log.debug("health data unavailable for briefing", { error: String(err) })
      return null
    }
  }

  /**
   * Format gathered data into a JARVIS-style briefing message.
   */
  private format(data: BriefingData): string {
    const sections: string[] = [data.greeting, ""]

    if (data.calendarItems.length > 0) {
      sections.push("Calendar:")
      for (const item of data.calendarItems) {
        sections.push(`- ${item}`)
      }
      sections.push("")
    }

    if (data.pendingItems.length > 0) {
      sections.push("Pending:")
      for (const item of data.pendingItems) {
        sections.push(`- ${item}`)
      }
      sections.push("")
    }

    if (data.systemStatus) {
      sections.push(`System: ${data.systemStatus}`)
      sections.push("")
    } else if (data.calendarItems.length > 0 || data.pendingItems.length > 0) {
      sections.push("System: All services operational.")
      sections.push("")
    }

    sections.push("Shall I elaborate on any of these items?")

    return sections.join("\n").trim()
  }
}

/** Singleton briefing composer instance. */
export const briefingComposer = new BriefingComposer()
