/**
 * @file nl-datetime-parser.test.ts
 * @description Tests for NLDateTimeParser fast-path heuristics and LLM fallback.
 *
 * Phase 14 — Calendar & Schedule Intelligence
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

vi.mock("../../config.js", () => ({
  default: {
    GCAL_TIMEZONE: "Asia/Jakarta",
  },
}))

import { orchestrator } from "../../engines/orchestrator.js"
import { NLDateTimeParser } from "../../calendar/nl-datetime-parser.js"

const mockOrch = orchestrator as unknown as { generate: ReturnType<typeof vi.fn> }

// Reference: Monday 2026-03-09 10:00:00 local
const REF = new Date("2026-03-09T10:00:00.000Z")

describe("NLDateTimeParser — fast path", () => {
  let parser: NLDateTimeParser

  beforeEach(() => {
    vi.clearAllMocks()
    parser = new NLDateTimeParser()
  })

  it("parses 'besok jam 3 sore' → tomorrow 15:00", () => {
    const result = parser.tryFastParse("besok jam 3 sore", REF)
    expect(result).not.toBeNull()
    expect(result!.start.getDate()).toBe(REF.getDate() + 1)
    expect(result!.start.getHours()).toBe(15)
    expect(result!.start.getMinutes()).toBe(0)
    expect(result!.isAllDay).toBe(false)
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("parses 'besok jam 10 pagi' → tomorrow 10:00", () => {
    const result = parser.tryFastParse("besok jam 10 pagi", REF)
    expect(result).not.toBeNull()
    expect(result!.start.getHours()).toBe(10)
  })

  it("parses 'besok jam 8 malam' → tomorrow 20:00", () => {
    const result = parser.tryFastParse("besok jam 8 malam", REF)
    expect(result).not.toBeNull()
    expect(result!.start.getHours()).toBe(20)
  })

  it("parses 'setengah 4 sore' → :30 of 15h → 15:30", () => {
    const result = parser.tryFastParse("besok setengah 4 sore", REF)
    expect(result).not.toBeNull()
    expect(result!.start.getHours()).toBe(15)
    expect(result!.start.getMinutes()).toBe(30)
  })

  it("parses 'besok jam 2pm' → tomorrow 14:00", () => {
    const result = parser.tryFastParse("besok jam 2pm", REF)
    expect(result).not.toBeNull()
    expect(result!.start.getHours()).toBe(14)
  })

  it("parses duration 'besok jam 3 sore selama 1 jam' → end +60min", () => {
    const result = parser.tryFastParse("besok jam 3 sore selama 1 jam", REF)
    expect(result).not.toBeNull()
    expect(result!.durationMinutes).toBe(60)
    expect(result!.end).toBeDefined()
    const diffMs = result!.end!.getTime() - result!.start.getTime()
    expect(diffMs).toBe(60 * 60_000)
  })

  it("parses recurrence 'setiap Senin jam 10 pagi' → isRecurring=true", () => {
    const result = parser.tryFastParse("setiap Senin jam 10 pagi", REF)
    expect(result).not.toBeNull()
    expect(result!.isRecurring).toBe(true)
    expect(result!.recurrenceRule).toContain("WEEKLY")
  })

  it("parses 'lusa jam 9 pagi' → in 2 days at 09:00", () => {
    const result = parser.tryFastParse("lusa jam 9 pagi", REF)
    expect(result).not.toBeNull()
    expect(result!.start.getDate()).toBe(REF.getDate() + 2)
    expect(result!.start.getHours()).toBe(9)
  })

  it("returns null for unknown date reference", () => {
    // 'jam 3 sore' with no date → fast path can't determine date
    const result = parser.tryFastParse("jam 3 sore", REF)
    // Null is acceptable — no date context
    expect(result === null || result!.confidence < 0.8).toBe(true)
  })

  it("detects all-day when no time is specified", () => {
    const result = parser.tryFastParse("besok", REF)
    expect(result).not.toBeNull()
    expect(result!.isAllDay).toBe(true)
  })
})

describe("NLDateTimeParser — LLM fallback", () => {
  let parser: NLDateTimeParser

  beforeEach(() => {
    vi.clearAllMocks()
    parser = new NLDateTimeParser()
  })

  it("calls LLM when fast parse confidence is low", async () => {
    mockOrch.generate.mockResolvedValue(
      JSON.stringify({
        startIso: "2026-03-10T15:00:00.000Z",
        endIso: "2026-03-10T16:00:00.000Z",
        durationMinutes: 60,
        isAllDay: false,
        isRecurring: false,
        recurrenceRule: null,
        confidence: 0.92,
      }),
    )

    const result = await parser.parse("jam 3 sore lusa di kantor", REF)
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.start).toBeInstanceOf(Date)
  })

  it("returns low-confidence default when LLM fails", async () => {
    mockOrch.generate.mockRejectedValue(new Error("timeout"))
    const result = await parser.parse("some ambiguous time expression", REF)
    expect(result.confidence).toBeLessThan(0.3)
    expect(result.start).toBeInstanceOf(Date)
  })

  it("returns low-confidence default when LLM returns no JSON", async () => {
    mockOrch.generate.mockResolvedValue("I cannot parse that.")
    const result = await parser.parse("totally ambiguous", REF)
    expect(result.confidence).toBeLessThan(0.3)
  })
})
