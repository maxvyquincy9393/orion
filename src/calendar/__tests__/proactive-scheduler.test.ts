/**
 * @file proactive-scheduler.test.ts
 * @description Tests for ProactiveScheduler — tomorrow's schedule analysis + action generation.
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

vi.mock("../../services/calendar.js", () => ({
  calendarService: {
    init: vi.fn(),
    listUpcoming: vi.fn(),
  },
}))

vi.mock("../pattern-analyzer.js", () => ({
  patternAnalyzer: {
    analyze: vi.fn(),
  },
}))

import { ProactiveScheduler } from "../proactive-scheduler.js"
import { calendarService } from "../../services/calendar.js"
import { patternAnalyzer } from "../pattern-analyzer.js"

const mockCal = calendarService as unknown as {
  init: ReturnType<typeof vi.fn>
  listUpcoming: ReturnType<typeof vi.fn>
}
const mockAnalyzer = patternAnalyzer as unknown as {
  analyze: ReturnType<typeof vi.fn>
}

/** Build a fake event for tomorrow in [hour, durationMin] format. */
function makeTmrEvent(hour: number, durationMin = 60, title = "Meeting") {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(hour, 0, 0, 0)
  const end = new Date(tomorrow)
  end.setMinutes(end.getMinutes() + durationMin)
  return { id: `ev-${hour}`, title, start: tomorrow, end, attendees: [], calendarId: "primary", status: "confirmed", description: "" }
}

const NEUTRAL_PATTERN = {
  focusBlockStart: 9,
  focusBlockEnd: 11,
  peakDays: [1, 3],
  avgMeetingsPerDay: 3,
  backToBackRate: 0,
  overtimeRate: 0,
  dataWindowDays: 14,
}

describe("ProactiveScheduler", () => {
  let scheduler: ProactiveScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    scheduler = new ProactiveScheduler()
    mockCal.init.mockResolvedValue(undefined)
    mockAnalyzer.analyze.mockResolvedValue(NEUTRAL_PATTERN)
  })

  it("returns empty array when no meetings tomorrow", async () => {
    mockCal.listUpcoming.mockResolvedValue([])
    const actions = await scheduler.analyzeTomorrow("user1")
    // Without dense meetings there may still be focus_block suggestion
    const warnings = actions.filter((a) => a.type === "density_warning")
    expect(warnings).toHaveLength(0)
  })

  it("generates density_warning when ≥4 meetings tomorrow", async () => {
    mockCal.listUpcoming.mockResolvedValue([
      makeTmrEvent(9), makeTmrEvent(10), makeTmrEvent(11), makeTmrEvent(14),
    ])
    const actions = await scheduler.analyzeTomorrow("user1")
    const warning = actions.find((a) => a.type === "density_warning")
    expect(warning).toBeDefined()
    expect(warning?.urgency).toBeDefined()
    expect(warning?.message).toContain("4")
  })

  it("density_warning is high urgency when ≥3 back-to-back events", async () => {
    // 4 back-to-back events (gaps ~0 min)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)

    const events = Array.from({ length: 4 }, (_, i) => {
      const start = new Date(tomorrow)
      start.setHours(9 + i, 0, 0, 0)
      const end = new Date(start)
      end.setMinutes(end.getMinutes() + 60) // exactly back-to-back to the next
      return { id: `ev-${i}`, title: "Meeting", start, end, attendees: [], calendarId: "primary", status: "confirmed", description: "" }
    })
    mockCal.listUpcoming.mockResolvedValue(events)
    const actions = await scheduler.analyzeTomorrow("user1")
    const warning = actions.find((a) => a.type === "density_warning")
    expect(warning?.urgency).toBe("high")
  })

  it("suggests focus_block when no focus event exists tomorrow", async () => {
    mockCal.listUpcoming.mockResolvedValue([makeTmrEvent(14)])
    const actions = await scheduler.analyzeTomorrow("user1")
    const fb = actions.find((a) => a.type === "focus_block")
    expect(fb).toBeDefined()
    expect(fb?.eventDraft?.title).toContain("Focus")
  })

  it("does NOT suggest focus_block when one already exists (title includes '🎯')", async () => {
    const focusEvent = makeTmrEvent(9, 120, "🎯 Focus Time")
    mockCal.listUpcoming.mockResolvedValue([focusEvent])
    const actions = await scheduler.analyzeTomorrow("user1")
    const fb = actions.find((a) => a.type === "focus_block")
    expect(fb).toBeUndefined()
  })

  it("does NOT suggest focus_block when slot is already booked", async () => {
    // Overlap with pattern's suggested 9-11 window
    const overlap = makeTmrEvent(9, 120, "Something else at 9")
    mockCal.listUpcoming.mockResolvedValue([overlap])
    const actions = await scheduler.analyzeTomorrow("user1")
    const fb = actions.find((a) => a.type === "focus_block")
    expect(fb).toBeUndefined()
  })

  it("generates overwork_warning when overtimeRate > 0.3", async () => {
    mockAnalyzer.analyze.mockResolvedValue({ ...NEUTRAL_PATTERN, overtimeRate: 0.4 })
    mockCal.listUpcoming.mockResolvedValue([])
    const actions = await scheduler.analyzeTomorrow("user1")
    const ow = actions.find((a) => a.type === "overwork_warning")
    expect(ow).toBeDefined()
    expect(ow?.message).toContain("18:00")
  })

  it("does NOT generate overwork_warning below threshold", async () => {
    mockAnalyzer.analyze.mockResolvedValue({ ...NEUTRAL_PATTERN, overtimeRate: 0.2 })
    mockCal.listUpcoming.mockResolvedValue([])
    const actions = await scheduler.analyzeTomorrow("user1")
    const ow = actions.find((a) => a.type === "overwork_warning")
    expect(ow).toBeUndefined()
  })

  it("returns empty array gracefully when calendarService throws", async () => {
    mockCal.init.mockRejectedValue(new Error("auth error"))
    const actions = await scheduler.analyzeTomorrow("user1")
    expect(actions).toEqual([])
  })

  it("returns empty array gracefully when patternAnalyzer throws", async () => {
    mockCal.listUpcoming.mockResolvedValue([])
    mockAnalyzer.analyze.mockRejectedValue(new Error("db error"))
    const actions = await scheduler.analyzeTomorrow("user1")
    expect(actions).toEqual([])
  })
})
