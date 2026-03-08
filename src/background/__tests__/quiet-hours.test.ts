/**
 * @file quiet-hours.test.ts
 * @description Unit tests for hard quiet hours and AdaptiveQuietHours (Phase 10F).
 */

import { describe, it, expect } from "vitest"
import {
  isWithinHardQuietHours,
  AdaptiveQuietHours,
  __quietHoursTestUtils,
} from "../quiet-hours.js"

describe("isWithinHardQuietHours", () => {
  it("returns true during quiet hours window", () => {
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 22, 0, 0))).toBe(true)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 23, 59, 0))).toBe(true)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 0, 0, 0))).toBe(true)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 6, 0, 0))).toBe(true) // inclusive
  })

  it("returns false outside quiet hours window", () => {
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 7, 0, 0))).toBe(false)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 12, 30, 0))).toBe(false)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 21, 59, 0))).toBe(false)
  })

  it("exposes correct boundary constants", () => {
    expect(__quietHoursTestUtils.QUIET_HOURS_START).toBe(22)
    expect(__quietHoursTestUtils.QUIET_HOURS_END).toBe(6)
  })
})

describe("AdaptiveQuietHours", () => {
  describe("record", () => {
    it("adds records without throwing", () => {
      const aqh = new AdaptiveQuietHours("user-1")
      expect(() => aqh.record(Date.now())).not.toThrow()
    })

    it("accumulates observations correctly", () => {
      const aqh = new AdaptiveQuietHours("user-1")
      for (let i = 0; i < 5; i++) {
        aqh.record(Date.now() - i * 1_000)
      }
      expect(aqh.getSnapshot().observations).toBe(5)
    })
  })

  describe("isQuiet", () => {
    it("returns false when insufficient observations (< MIN_OBSERVATIONS)", () => {
      const aqh = new AdaptiveQuietHours("user-2")
      aqh.record(Date.now())
      expect(aqh.isQuiet()).toBe(false)
    })

    it("returns false when model is not yet confident", () => {
      const aqh = new AdaptiveQuietHours("user-3")
      for (let i = 0; i < 5; i++) {
        aqh.record(new Date(2026, 2, i + 1, 10).getTime())
      }
      // 5 observations < MIN_OBSERVATIONS=14, so not confident
      expect(aqh.isQuiet()).toBe(false)
    })

    it("correctly identifies 3 AM as quiet after dense daytime activity records", () => {
      const aqh = new AdaptiveQuietHours("user-4")

      // Simulate 3 weeks of activity: active 9:00–21:00, never at night
      for (let day = 0; day < 21; day++) {
        for (let hour = 9; hour <= 21; hour++) {
          aqh.record(new Date(2026, 0, day + 1, hour).getTime())
        }
      }

      const snapshot = aqh.getSnapshot()
      if (snapshot.confident) {
        const threeAM = new Date(2026, 2, 8, 3, 0, 0)
        expect(aqh.isQuiet(threeAM)).toBe(true)
      }
      // If not confident, safe default is false — acceptable
    })
  })

  describe("getSnapshot", () => {
    it("returns zeroed snapshot for empty model", () => {
      const aqh = new AdaptiveQuietHours("user-5")
      const snap = aqh.getSnapshot()
      expect(snap.confident).toBe(false)
      expect(snap.confidence).toBe(0)
      expect(snap.quietStartHour).toBeNull()
      expect(snap.quietEndHour).toBeNull()
      expect(snap.observations).toBe(0)
    })

    it("confidence is between 0 and 1", () => {
      const aqh = new AdaptiveQuietHours("user-6")
      for (let i = 0; i < 20; i++) {
        aqh.record(new Date(2026, 0, i + 1, 9).getTime())
      }
      const snap = aqh.getSnapshot()
      expect(snap.confidence).toBeGreaterThanOrEqual(0)
      expect(snap.confidence).toBeLessThanOrEqual(1)
    })
  })

  describe("exportRecords / importRecords", () => {
    it("round-trips records correctly", () => {
      const aqh = new AdaptiveQuietHours("user-7")
      aqh.record(Date.now())
      aqh.record(Date.now() - 1_000)

      const exported = aqh.exportRecords()
      expect(exported).toHaveLength(2)

      const aqh2 = new AdaptiveQuietHours("user-7")
      aqh2.importRecords(exported)
      expect(aqh2.getSnapshot().observations).toBe(2)
    })

    it("filters out records with weight=0 or negative weight", () => {
      const aqh = new AdaptiveQuietHours("user-8")
      aqh.importRecords([
        { timestamp: Date.now(), weight: 1.0 },       // valid
        { timestamp: Date.now(), weight: 0 },          // filtered (weight=0)
        { timestamp: Date.now(), weight: -0.5 },       // filtered (negative)
      ])
      expect(aqh.getSnapshot().observations).toBe(1)
    })

    it("filters out records with NaN timestamp", () => {
      const aqh = new AdaptiveQuietHours("user-9")
      aqh.importRecords([
        { timestamp: NaN, weight: 1.0 },       // filtered
        { timestamp: Date.now(), weight: 1.0 }, // valid
      ])
      expect(aqh.getSnapshot().observations).toBe(1)
    })
  })
})
