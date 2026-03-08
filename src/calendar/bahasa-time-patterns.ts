/**
 * @file bahasa-time-patterns.ts
 * @description Bahasa Indonesia time expression mappings for NLDateTimeParser fast path.
 *
 * ARCHITECTURE:
 *   Imported by nl-datetime-parser.ts.
 *   Coverage:
 *   - Relative days: besok, lusa, kemarin, minggu depan, dll
 *   - Time of day: pagi (08-11), siang (12-14), sore (15-17), malam (18-22)
 *   - Special: "setengah X" = X:30, "jam X lebih Y menit"
 *   - Duration: "1 jam", "30 menit", "setengah jam", "1,5 jam"
 *   - Recurrence: "setiap Senin", "tiap pagi"
 *
 * @module calendar/bahasa-time-patterns
 */

/** Relative day offset in days from today. */
export const BAHASA_RELATIVE_DAYS: Record<string, number> = {
  kemarin: -1,
  tadi: 0,
  hari_ini: 0,
  "hari ini": 0,
  besok: 1,
  lusa: 2,
  "minggu depan": 7,
  "bulan depan": 30,
  "minggu ini": 0,
  "pekan depan": 7,
}

/** Time-of-day bucket: default hour + acceptable minute range. */
export interface TimeOfDayBucket {
  /** Default start hour (24h). */
  hour: number
  /** Minute range start (0–59). */
  minuteMin: number
  /** Minute range end (0–1439 for crossing midnight). */
  minuteMax: number
}

export const BAHASA_TIME_OF_DAY: Record<string, TimeOfDayBucket> = {
  pagi:  { hour: 8,  minuteMin: 0, minuteMax: 719  }, // 08:00–11:59
  siang: { hour: 12, minuteMin: 0, minuteMax: 179  }, // 12:00–14:59
  sore:  { hour: 15, minuteMin: 0, minuteMax: 179  }, // 15:00–17:59
  malam: { hour: 18, minuteMin: 0, minuteMax: 299  }, // 18:00–22:59
  tengah_malam: { hour: 0, minuteMin: 0, minuteMax: 359 }, // 00:00–05:59
}

/** Duration expressions in minutes. */
export const BAHASA_DURATION: Record<string, number> = {
  "1 jam":       60,
  "2 jam":       120,
  "3 jam":       180,
  "setengah jam": 30,
  "½ jam":       30,
  "1,5 jam":     90,
  "1.5 jam":     90,
  "15 menit":    15,
  "20 menit":    20,
  "30 menit":    30,
  "45 menit":    45,
  "satu jam":    60,
  "dua jam":     120,
}

/** Day-of-week name (Bahasa + English) → 0-indexed (0 = Sunday). */
export const BAHASA_DAY_NAMES: Record<string, number> = {
  minggu:   0,
  ahad:     0,
  sunday:   0,
  senin:    1,
  monday:   1,
  selasa:   2,
  tuesday:  2,
  rabu:     3,
  wednesday: 3,
  kamis:    4,
  thursday: 4,
  jumat:    5,
  jum_at:   5,
  friday:   5,
  sabtu:    6,
  saturday: 6,
}

/**
 * Detect if text contains a recurrence signal.
 * Returns the RRULE FREQ token if found, null otherwise.
 */
export function detectRecurrence(input: string): string | null {
  const lower = input.toLowerCase()
  if (/setiap\s+(hari|day)|tiap\s+hari|every\s+day/.test(lower)) return "DAILY"
  if (/setiap\s+(minggu|week)|tiap\s+minggu|every\s+week/.test(lower)) return "WEEKLY"
  if (/setiap\s+(bulan|month)|tiap\s+bulan|every\s+month/.test(lower)) return "MONTHLY"
  if (/setiap\s+(senin|selasa|rabu|kamis|jumat|sabtu|minggu|ahad|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(lower)) return "WEEKLY"
  if (/tiap\s+(senin|selasa|rabu|kamis|jumat|sabtu)/i.test(lower)) return "WEEKLY"
  return null
}
