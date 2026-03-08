/**
 * @file habit-model.test.ts
 * @description Unit tests for HabitModel (Phase 10B).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../database/index.js", () => ({
  prisma: {
    activityRecord: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("../../config.js", () => ({
  default: {
    HABIT_MODEL_ENABLED: true,
    HABIT_MODEL_UPDATE_INTERVAL_MS: 3_600_000,
  },
}))

import { HabitModel } from "../habit-model.js"
import { prisma } from "../../database/index.js"

describe("HabitModel", () => {
  let model: HabitModel

  beforeEach(() => {
    model = new HabitModel()
    vi.clearAllMocks()
    vi.mocked(prisma.activityRecord.create).mockResolvedValue({} as never)
    vi.mocked(prisma.activityRecord.count).mockResolvedValue(0)
    vi.mocked(prisma.activityRecord.findMany).mockResolvedValue([])
  })

  describe("record", () => {
    it("creates an activity record in Prisma", async () => {
      const timestamp = new Date(2026, 2, 8, 9, 0, 0).getTime() // 09:00

      await model.record("user-1", timestamp)

      expect(prisma.activityRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            hour: 9,
          }),
        }),
      )
    })

    it("records day of week correctly", async () => {
      // March 8, 2026 is a Sunday (dayOfWeek=0)
      const sunday = new Date(2026, 2, 8, 10, 0, 0).getTime()

      await model.record("user-1", sunday)

      expect(prisma.activityRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dayOfWeek: 0,
          }),
        }),
      )
    })
  })

  describe("getActiveHours", () => {
    it("returns empty array with fewer than 10 total observations", async () => {
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue([
        { id: "1", userId: "u1", hour: 9, dayOfWeek: 1, weight: 1, timestamp: new Date() },
        { id: "2", userId: "u1", hour: 10, dayOfWeek: 1, weight: 1, timestamp: new Date() },
      ])

      const hours = await model.getActiveHours("user-1")
      expect(hours).toEqual([])
    })

    it("returns peak hours with 15+ observations concentrated at specific times", async () => {
      // Simulate user always active at 9, 10, 11 — never at 2, 3, 4
      const records = []
      for (let i = 0; i < 15; i++) {
        records.push({ id: `r${i}-9`, userId: "u1", hour: 9, dayOfWeek: 1, weight: 1.0, timestamp: new Date() })
        records.push({ id: `r${i}-10`, userId: "u1", hour: 10, dayOfWeek: 1, weight: 1.0, timestamp: new Date() })
        records.push({ id: `r${i}-11`, userId: "u1", hour: 11, dayOfWeek: 1, weight: 0.8, timestamp: new Date() })
      }
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue(records)

      const hours = await model.getActiveHours("user-1")
      expect(hours).toContain(9)
      expect(hours).toContain(10)
    })
  })

  describe("getQuietHours", () => {
    it("returns empty array with fewer than 10 observations", async () => {
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue([])

      const hours = await model.getQuietHours("user-1")
      expect(hours).toEqual([])
    })

    it("returns low-activity hours as quiet hours", async () => {
      // User only active at 9–11, never at 2–5
      const records = []
      for (let i = 0; i < 15; i++) {
        records.push({ id: `r${i}`, userId: "u1", hour: 9, dayOfWeek: 1, weight: 1.0, timestamp: new Date() })
        records.push({ id: `r${i}b`, userId: "u1", hour: 10, dayOfWeek: 1, weight: 1.0, timestamp: new Date() })
      }
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue(records)

      const quietHours = await model.getQuietHours("user-1")
      // Hours 2, 3, 4 should be quiet (no activity)
      expect(quietHours).toContain(3)
    })
  })

  describe("isLikelyActive", () => {
    it("returns true (fail-open) when insufficient data", async () => {
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue([])

      const result = await model.isLikelyActive("user-1", new Date())
      expect(result).toBe(true)
    })

    it("returns true during typically active hours", async () => {
      const records = []
      for (let i = 0; i < 15; i++) {
        records.push({ id: `r${i}`, userId: "u1", hour: 9, dayOfWeek: 1, weight: 1.0, timestamp: new Date() })
        records.push({ id: `r${i}b`, userId: "u1", hour: 9, dayOfWeek: 2, weight: 1.0, timestamp: new Date() })
      }
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue(records)

      const nineAM = new Date()
      nineAM.setHours(9, 0, 0, 0)

      const result = await model.isLikelyActive("user-1", nineAM)
      expect(result).toBe(true)
    })
  })

  describe("getProactiveHints", () => {
    it("returns empty array with fewer than 14 observations", async () => {
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue([
        { id: "1", userId: "u1", hour: 9, dayOfWeek: 1, weight: 1, timestamp: new Date() },
      ])

      const hints = await model.getProactiveHints("user-1")
      expect(hints).toEqual([])
    })

    it("generates morning-brief hint when morning activity established", async () => {
      const records = []
      for (let i = 0; i < 15; i++) {
        records.push({ id: `r${i}-morning`, userId: "u1", hour: 8, dayOfWeek: 1, weight: 1.0, timestamp: new Date() })
        records.push({ id: `r${i}-morning2`, userId: "u1", hour: 9, dayOfWeek: 1, weight: 1.0, timestamp: new Date() })
      }
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue(records)

      const hints = await model.getProactiveHints("user-1")
      const morningHints = hints.filter((h) => h.category === "morning-brief")
      expect(morningHints.length).toBeGreaterThan(0)
      expect(morningHints[0]!.userId).toBe("user-1")
    })

    it("returns hints with valid confidence values (0–1)", async () => {
      const records = Array.from({ length: 20 }, (_, i) => ({
        id: `r${i}`,
        userId: "u1",
        hour: 9 + (i % 4),
        dayOfWeek: i % 7,
        weight: 1.0,
        timestamp: new Date(),
      }))
      vi.mocked(prisma.activityRecord.findMany).mockResolvedValue(records)

      const hints = await model.getProactiveHints("user-1")
      for (const hint of hints) {
        expect(hint.confidence).toBeGreaterThanOrEqual(0)
        expect(hint.confidence).toBeLessThanOrEqual(1)
      }
    })
  })
})
