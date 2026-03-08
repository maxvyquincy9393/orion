/**
 * @file ical-connector.test.ts
 * @description Tests for ICalConnector — iCal feed parsing, caching, and range filtering.
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

// ---------------------------------------------------------------------------
// Fake ical.js module — replaces the optional runtime dependency
// ---------------------------------------------------------------------------
const ICAL_EVENTS_BY_SUMMARY: Record<
  string,
  { uid: string; start: Date; end: Date; summary: string; description?: string }
> = {
  "Team Standup": {
    uid: "test-event-001@test",
    start: new Date("2026-03-10T09:00:00Z"),
    end: new Date("2026-03-10T11:00:00Z"),
    summary: "Team Standup",
    description: "Daily standup meeting",
  },
  "Sprint Review": {
    uid: "test-event-002@test",
    start: new Date("2026-03-11T14:00:00Z"),
    end: new Date("2026-03-11T15:00:00Z"),
    summary: "Sprint Review",
  },
}

/** Create a fake ical.js ICalTime wrapper. */
function fakeTime(d: Date) {
  return { toJSDate: () => d }
}

/** Create a fake vevent component for a given event fixture. */
function fakeVevent(evt: (typeof ICAL_EVENTS_BY_SUMMARY)[string]) {
  return {
    getFirstPropertyValue: <T>(name: string): T | null => {
      if (name === "uid") return evt.uid as unknown as T
      if (name === "summary") return evt.summary as unknown as T
      if (name === "dtstart") return fakeTime(evt.start) as unknown as T
      if (name === "dtend") return fakeTime(evt.end) as unknown as T
      if (name === "description") return (evt.description ?? null) as unknown as T
      if (name === "location") return null
      return null
    },
    getFirstProperty: () => null,
  }
}

vi.mock("ical.js", () => {
  const fakeModule = {
    parse: vi.fn().mockReturnValue({}),
    Component: function FakeComponent(_jCal: unknown) {
      return {
        getAllSubcomponents: (_name: string) =>
          Object.values(ICAL_EVENTS_BY_SUMMARY).map(fakeVevent),
      }
    },
    Time: { fromDateTimeString: (_s: string) => fakeTime(new Date()) },
  }
  return { default: fakeModule, ...fakeModule }
})

// Minimal well-formed iCal text fixture (content doesn't matter — ical.js is mocked)
const ICAL_FIXTURE = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR`

describe("ICalConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("parses events from a valid .ics response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(ICAL_FIXTURE),
      }),
    )

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    const events = await connector.fetchEvents("https://example.com/cal.ics")
    expect(events.length).toBe(2)
    expect(events[0].title).toBe("Team Standup")
    expect(events[0].start).toBeInstanceOf(Date)
    expect(events[0].end).toBeInstanceOf(Date)
  })

  it("caches results on second call (no re-fetch)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(ICAL_FIXTURE),
    })
    vi.stubGlobal("fetch", fetchMock)

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    await connector.fetchEvents("https://example.com/cal2.ics", 60_000)
    await connector.fetchEvents("https://example.com/cal2.ics", 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refetches when cache TTL expired", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(ICAL_FIXTURE),
    })
    vi.stubGlobal("fetch", fetchMock)

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    await connector.fetchEvents("https://example.com/cal3.ics", -1) // TTL already expired
    await connector.fetchEvents("https://example.com/cal3.ics", -1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns empty array when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue("Not Found"),
      }),
    )

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    const events = await connector.fetchEvents("https://example.com/missing.ics")
    expect(events).toEqual([])
  })

  it("returns empty array when network throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    const events = await connector.fetchEvents("https://example.com/error.ics")
    expect(events).toEqual([])
  })

  it("fetchAll merges events from multiple urls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(ICAL_FIXTURE),
      }),
    )

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    // Two different URLs → two separate fetches → 2 × 2 events = 4
    const events = await connector.fetchAll(
      "https://example.com/a.ics,https://example.com/b.ics",
    )
    expect(events.length).toBeGreaterThanOrEqual(2)
  })

  it("filterByRange returns events overlapping the range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(ICAL_FIXTURE),
      }),
    )

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    const events = await connector.fetchEvents("https://example.com/filter.ics")
    const rangeStart = new Date("2026-03-10T00:00:00Z")
    const rangeEnd = new Date("2026-03-10T23:59:59Z")
    const filtered = connector.filterByRange(events, rangeStart, rangeEnd)
    expect(filtered.length).toBe(1)
    expect(filtered[0].title).toBe("Team Standup")
  })

  it("filterByRange returns empty array for non-overlapping range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(ICAL_FIXTURE),
      }),
    )

    const { ICalConnector } = await import("../ical-connector.js")
    const connector = new ICalConnector()
    const events = await connector.fetchEvents("https://example.com/filterempty.ics")
    const rangeStart = new Date("2026-01-01T00:00:00Z")
    const rangeEnd = new Date("2026-01-31T23:59:59Z")
    const filtered = connector.filterByRange(events, rangeStart, rangeEnd)
    expect(filtered).toEqual([])
  })
})
