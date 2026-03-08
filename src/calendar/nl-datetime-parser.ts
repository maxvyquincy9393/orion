/**
 * @file nl-datetime-parser.ts
 * @description Natural language datetime parsing for Bahasa Indonesia + English.
 *
 * ARCHITECTURE:
 *   Fast path (heuristic, <1 ms): simple patterns from bahasa-time-patterns.ts
 *   LLM path (slow, ~300 ms): complex or ambiguous expressions
 *   Selects fast path if confidence ≥ 0.85, otherwise falls back to LLM.
 *
 *   DIPANGGIL dari: calendarTool (create action) + ProactiveScheduler
 *
 * PAPER BASIS:
 *   - Chronos (arXiv:2403.07815): temporal language model — "setengah 4" cannot
 *     be reliably regex-parsed → LLM path for such expressions.
 *   - ScheduleMe (arXiv:2509.25693): 94-96% intent accuracy → target threshold.
 *
 * @module calendar/nl-datetime-parser
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import config from "../config.js"
import {
  BAHASA_RELATIVE_DAYS,
  BAHASA_TIME_OF_DAY,
  BAHASA_DURATION,
  BAHASA_DAY_NAMES,
  detectRecurrence,
} from "./bahasa-time-patterns.js"

const log = createLogger("calendar.nl-datetime-parser")

/** Result of parsing a natural language datetime expression. */
export interface ParsedDateTime {
  /** Event start time. */
  start: Date
  /** Event end time (if determinable). */
  end?: Date
  /** Duration in minutes (if specified). */
  durationMinutes?: number
  /** True if the event spans the whole day without a specific time. */
  isAllDay: boolean
  /** True if a recurrence pattern was detected. */
  isRecurring: boolean
  /** RRULE FREQ token string (e.g. "WEEKLY") if recurring. */
  recurrenceRule?: string
  /** Timezone identifier used. */
  timezone: string
  /** Confidence 0–1. */
  confidence: number
  /** The original input for logging/fallback. */
  rawExpression: string
}

// ---------------------------------------------------------------------------
// LLM prompt
// ---------------------------------------------------------------------------

const LLM_PROMPT_TEMPLATE = (input: string, now: string, tz: string) => `
Parse this datetime expression and return ONLY valid JSON (no markdown):
{
  "startIso": "ISO8601",
  "endIso": "ISO8601 or null",
  "durationMinutes": number_or_null,
  "isAllDay": boolean,
  "isRecurring": boolean,
  "recurrenceRule": "RRULE string or null",
  "confidence": 0_to_1
}

Current time: ${now} (timezone: ${tz})
Expression: "${input}"
`.trim()

/** Natural language datetime parser with fast-heuristic and LLM fallback. */
export class NLDateTimeParser {
  /**
   * Parse a natural language datetime expression.
   *
   * @param input     - e.g. "besok jam 3 sore" or "next Tuesday 2pm for 1 hour"
   * @param reference - Reference date (defaults to now)
   * @returns Parsed datetime with confidence score
   */
  async parse(input: string, reference: Date = new Date()): Promise<ParsedDateTime> {
    const fast = this.tryFastParse(input, reference)
    if (fast && fast.confidence >= 0.85) {
      log.debug("fast parse succeeded", { input, confidence: fast.confidence })
      return fast
    }

    log.debug("falling back to LLM parse", { input })
    return this.llmParse(input, reference)
  }

  // ---------------------------------------------------------------------------
  // Fast heuristic path
  // ---------------------------------------------------------------------------

  /**
   * Attempt to parse common Bahasa + English patterns without an LLM call.
   * Returns null when confidence is insufficient.
   */
  tryFastParse(input: string, reference: Date): ParsedDateTime | null {
    const lower = input.toLowerCase().trim()
    const tz = config.GCAL_TIMEZONE

    // -----------------------------------------------------------------------
    // 1. Recurrence detection
    // -----------------------------------------------------------------------
    const recurrenceFreq = detectRecurrence(lower)
    const isRecurring = recurrenceFreq !== null
    const recurrenceRule = recurrenceFreq ? `FREQ=${recurrenceFreq}` : undefined

    // -----------------------------------------------------------------------
    // 2. Resolve the target date
    // -----------------------------------------------------------------------
    let targetDate = new Date(reference)
    let dateConfidence = 0

    // Relative day keywords
    for (const [keyword, offset] of Object.entries(BAHASA_RELATIVE_DAYS)) {
      if (lower.includes(keyword)) {
        targetDate = new Date(reference)
        targetDate.setDate(reference.getDate() + offset)
        dateConfidence = 0.9
        break
      }
    }

    // "minggu depan Senin" / "next Tuesday"
    const dayMatch = /(?:minggu|pekan)\s+depan\s+(\w+)|(?:next|depan)\s+(\w+)/i.exec(lower)
    if (dayMatch) {
      const dayWord = (dayMatch[1] ?? dayMatch[2] ?? "").toLowerCase()
      const targetDow = BAHASA_DAY_NAMES[dayWord]
      if (targetDow !== undefined) {
        targetDate = nextWeekday(reference, targetDow)
        dateConfidence = 0.9
      }
    }

    // Plain "Senin" / "Rabu" → this week or next occurrence
    if (dateConfidence === 0) {
      for (const [name, dow] of Object.entries(BAHASA_DAY_NAMES)) {
        const pattern = new RegExp(`\\b${name}\\b`, "i")
        if (pattern.test(lower)) {
          targetDate = nextWeekdayOrToday(reference, dow)
          dateConfidence = 0.75
          break
        }
      }
    }

    if (dateConfidence === 0) {
      // No date marker found — can't fast-parse reliably
      return null
    }

    // -----------------------------------------------------------------------
    // 3. Resolve time-of-day
    // -----------------------------------------------------------------------
    let hour = -1
    let minute = 0
    let timeConfidence = 0

    // Explicit "jam X" or "pukul X" — e.g. "jam 3", "pukul 14"
    const jamMatch = /(?:jam|pukul)\s+(\d{1,2})(?:[.:](\d{2}))?/.exec(lower)
    if (jamMatch) {
      hour = Number.parseInt(jamMatch[1], 10)
      minute = jamMatch[2] ? Number.parseInt(jamMatch[2], 10) : 0
      timeConfidence = 0.9
    }

    // setengah X (X:30) — e.g. "setengah 4" = 3:30
    const setengahMatch = /setengah\s+(\d{1,2})/.exec(lower)
    if (setengahMatch) {
      hour = Number.parseInt(setengahMatch[1], 10) - 1
      minute = 30
      timeConfidence = 0.85
    }

    // Time of day bucket: sore → 15, pagi → 8, etc.
    for (const [name, bucket] of Object.entries(BAHASA_TIME_OF_DAY)) {
      if (lower.includes(name)) {
        if (hour < 0) {
          hour = bucket.hour
          minute = 0
          timeConfidence = 0.75
        } else {
          // Merge: "jam 3 sore" → 15:00
          if (name === "sore" && hour < 12) hour += 12
          else if (name === "malam" && hour < 12) hour += 12
          else if (name === "pagi" && hour > 12) hour -= 12
          timeConfidence = Math.max(timeConfidence, 0.85)
        }
        break
      }
    }

    // English AM/PM
    const ampmMatch = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(lower)
    if (ampmMatch) {
      hour = Number.parseInt(ampmMatch[1], 10)
      minute = ampmMatch[2] ? Number.parseInt(ampmMatch[2], 10) : 0
      if (ampmMatch[3].toLowerCase() === "pm" && hour < 12) hour += 12
      if (ampmMatch[3].toLowerCase() === "am" && hour === 12) hour = 0
      timeConfidence = 0.9
    }

    if (hour < 0) {
      // No time found → treat as all-day or unknown time
      if (timeConfidence === 0) {
        const start = new Date(targetDate)
        start.setHours(9, 0, 0, 0)
        return {
          start,
          isAllDay: true,
          isRecurring,
          recurrenceRule,
          timezone: tz,
          confidence: dateConfidence * 0.9,
          rawExpression: input,
        }
      }
      return null
    }

    const start = new Date(targetDate)
    start.setHours(hour, minute, 0, 0)

    // -----------------------------------------------------------------------
    // 4. Resolve duration / end time
    // -----------------------------------------------------------------------
    let durationMinutes: number | undefined
    let end: Date | undefined

    for (const [durationStr, mins] of Object.entries(BAHASA_DURATION)) {
      if (lower.includes(durationStr)) {
        durationMinutes = mins
        end = new Date(start.getTime() + mins * 60_000)
        break
      }
    }

    // English "for X hour(s)" or "selama X jam"
    const forMatch = /(?:for|selama)\s+(\d+(?:[.,]\d+)?)\s*(hour|jam|minute|menit)/i.exec(lower)
    if (forMatch && !durationMinutes) {
      const qty = Number.parseFloat(forMatch[1].replace(",", "."))
      const unit = forMatch[2].toLowerCase()
      durationMinutes = unit.startsWith("h") || unit === "jam" ? qty * 60 : qty
      end = new Date(start.getTime() + durationMinutes * 60_000)
    }

    if (!end) {
      // Default: 1 hour
      end = new Date(start.getTime() + 60 * 60_000)
      durationMinutes = 60
    }

    const confidence = Math.min(0.95, (dateConfidence + timeConfidence) / 2)

    return {
      start,
      end,
      durationMinutes,
      isAllDay: false,
      isRecurring,
      recurrenceRule,
      timezone: tz,
      confidence,
      rawExpression: input,
    }
  }

  // ---------------------------------------------------------------------------
  // LLM fallback path
  // ---------------------------------------------------------------------------

  /** Call LLM to parse complex or ambiguous expressions. */
  private async llmParse(input: string, reference: Date): Promise<ParsedDateTime> {
    const tz = config.GCAL_TIMEZONE
    const now = reference.toISOString()

    try {
      const prompt = LLM_PROMPT_TEMPLATE(input, now, tz)
      const raw = await orchestrator.generate("fast", { prompt })
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error("no JSON in LLM response")

      const parsed = JSON.parse(jsonMatch[0]) as {
        startIso: string
        endIso?: string | null
        durationMinutes?: number | null
        isAllDay: boolean
        isRecurring: boolean
        recurrenceRule?: string | null
        confidence: number
      }

      const start = new Date(parsed.startIso)
      if (Number.isNaN(start.getTime())) throw new Error("invalid startIso from LLM")

      const end = parsed.endIso ? new Date(parsed.endIso) : new Date(start.getTime() + 60 * 60_000)

      return {
        start,
        end,
        durationMinutes: parsed.durationMinutes ?? undefined,
        isAllDay: parsed.isAllDay ?? false,
        isRecurring: parsed.isRecurring ?? false,
        recurrenceRule: parsed.recurrenceRule ?? undefined,
        timezone: tz,
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
        rawExpression: input,
      }
    } catch (err) {
      log.warn("LLM datetime parse failed, using reference + 1h default", { input, err })
      const start = new Date(reference)
      start.setHours(start.getHours() + 1, 0, 0, 0)
      return {
        start,
        end: new Date(start.getTime() + 60 * 60_000),
        durationMinutes: 60,
        isAllDay: false,
        isRecurring: false,
        timezone: tz,
        confidence: 0.1,
        rawExpression: input,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the next occurrence of `dow` (day-of-week) strictly AFTER reference. */
function nextWeekday(reference: Date, dow: number): Date {
  const d = new Date(reference)
  const diff = ((dow - d.getDay() + 7) % 7) || 7 // always at least 1 day ahead
  d.setDate(d.getDate() + diff)
  return d
}

/** Return today if `dow` matches today, otherwise next occurrence. */
function nextWeekdayOrToday(reference: Date, dow: number): Date {
  const d = new Date(reference)
  const diff = (dow - d.getDay() + 7) % 7
  d.setDate(d.getDate() + diff)
  return d
}

/** Singleton instance. */
export const nlDateTimeParser = new NLDateTimeParser()
