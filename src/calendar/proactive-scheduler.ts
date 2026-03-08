/**
 * @file proactive-scheduler.ts
 * @description Proactive schedule management: auto-block focus time and density warnings.
 *
 * PAPER BASIS:
 *   - ProAgent (arXiv:2308.11339): anticipate scheduling needs, not just react.
 *     "Besok ada 4 meeting, mau gue block 9-11 dulu buat deep work?"
 *
 * ARCHITECTURE:
 *   Called from daemon.runCycle() at ~20:00 once per evening.
 *   Does NOT auto-create events without user confirmation — sends message first.
 *   After user agrees 3× → auto-block without asking (future: FeedbackStore).
 *
 * ACTIONS:
 *   - focus_block: suggest/auto-create "🎯 Focus Time" event
 *   - density_warning: "Besok 4 meeting back-to-back, mau reschedule?"
 *   - overwork_warning: "Lu kerja sampai jam 9 kemarin, coba blok pulang jam 6?"
 *
 * @module calendar/proactive-scheduler
 */

import { createLogger } from "../logger.js"
import { calendarService } from "../services/calendar.js"
import type { CalendarEventDraft } from "../services/calendar.js"
import { patternAnalyzer } from "./pattern-analyzer.js"

const log = createLogger("calendar.proactive-scheduler")

/** A proactive action to surface to the user. */
export interface ProactiveAction {
  type: "focus_block" | "density_warning" | "overwork_warning"
  message: string
  urgency: "low" | "medium" | "high"
  /** Draft event for focus_block actions. */
  eventDraft?: Partial<CalendarEventDraft>
}

/** Meeting density threshold to trigger a warning (events per day). */
const DENSE_THRESHOLD = 4

/** Back-to-back consecutive events threshold. */
const BACK_TO_BACK_THRESHOLD = 3

/**
 * Proactive scheduler — analyses tomorrow's calendar and generates actions.
 */
export class ProactiveScheduler {
  /**
   * Analyse tomorrow's schedule + historical patterns and return proactive actions.
   *
   * @param userId - User identifier
   * @returns Array of proactive actions (may be empty)
   */
  async analyzeTomorrow(userId: string): Promise<ProactiveAction[]> {
    const actions: ProactiveAction[] = []

    try {
      await calendarService.init()

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(0, 0, 0, 0)

      const tomorrowEnd = new Date(tomorrow)
      tomorrowEnd.setHours(23, 59, 59, 999)

      const tomorrowEvents = await calendarService.listUpcoming(48)
      const tmrEvents = tomorrowEvents.filter((e) => {
        const d = e.start
        return d >= tomorrow && d <= tomorrowEnd
      })

      const sortedTmr = [...tmrEvents].sort((a, b) => a.start.getTime() - b.start.getTime())
      const pattern = await patternAnalyzer.analyze(userId)

      // ------------------------------------------------------------------
      // 1. Density warning
      // ------------------------------------------------------------------
      if (sortedTmr.length >= DENSE_THRESHOLD) {
        const backToBack = countBackToBack(sortedTmr)
        actions.push({
          type: "density_warning",
          urgency: backToBack >= BACK_TO_BACK_THRESHOLD ? "high" : "medium",
          message:
            `📅 Besok lu ada ${sortedTmr.length} meeting` +
            (backToBack > 0 ? `, ${backToBack} di antaranya back-to-back.` : ".") +
            " Mau gue bantu atur ulang jadwal?",
        })
      }

      // ------------------------------------------------------------------
      // 2. Focus block suggestion
      // ------------------------------------------------------------------
      const hasFocusBlock = sortedTmr.some((e) => e.title.includes("Focus") || e.title.includes("🎯"))
      if (!hasFocusBlock) {
        const focusStart = pattern.focusBlockStart ?? 9
        const focusEnd = pattern.focusBlockEnd ?? 11

        const focusFrom = new Date(tomorrow)
        focusFrom.setHours(focusStart, 0, 0, 0)
        const focusTo = new Date(tomorrow)
        focusTo.setHours(focusEnd, 0, 0, 0)

        const alreadyBooked = sortedTmr.some(
          (e) => e.start < focusTo && e.end > focusFrom,
        )

        if (!alreadyBooked) {
          actions.push({
            type: "focus_block",
            urgency: "low",
            message:
              `🎯 Besok jam ${focusStart}:00–${focusEnd}:00 masih kosong. ` +
              "Mau gue block buat deep work?",
            eventDraft: {
              title: "🎯 Focus Time",
              start: focusFrom,
              end: focusTo,
            },
          })
        }
      }

      // ------------------------------------------------------------------
      // 3. Overwork warning (based on pattern)
      // ------------------------------------------------------------------
      if (pattern.overtimeRate > 0.3) {
        const overtime = Math.round(pattern.overtimeRate * 100)
        actions.push({
          type: "overwork_warning",
          urgency: "medium",
          message:
            `⚠️ ${overtime}% dari meeting lu biasanya lewat jam 18:00. ` +
            "Coba block jam pulang biar lebih teratur?",
        })
      }

      log.info("proactive actions generated", { userId, count: actions.length })
    } catch (err) {
      log.warn("proactive scheduler failed", { userId, err })
    }

    return actions
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count consecutive back-to-back event pairs (gap < 15 min). */
function countBackToBack(sorted: Array<{ start: Date; end: Date }>): number {
  let count = 0
  for (let i = 1; i < sorted.length; i++) {
    const gapMs = sorted[i].start.getTime() - sorted[i - 1].end.getTime()
    if (gapMs >= 0 && gapMs < 15 * 60_000) count++
  }
  return count
}

/** Singleton instance. */
export const proactiveScheduler = new ProactiveScheduler()
