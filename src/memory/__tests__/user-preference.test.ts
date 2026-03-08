/**
 * @file user-preference.test.ts
 * @description Unit tests for UserPreferenceEngine (Phase 10A).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../database/index.js", () => ({
  prisma: {
    userPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

vi.mock("../../config.js", () => ({
  default: {
    PERSONALIZATION_ENABLED: true,
    PREFERENCE_ALPHA: 0.15,
    DEFAULT_TONE_PRESET: "jarvis",
    DEFAULT_TITLE_WORD: "Sir",
  },
}))

import { UserPreferenceEngine } from "../user-preference.js"
import { prisma } from "../../database/index.js"
import { orchestrator } from "../../engines/orchestrator.js"

describe("UserPreferenceEngine", () => {
  let engine: UserPreferenceEngine

  beforeEach(() => {
    engine = new UserPreferenceEngine()
    vi.clearAllMocks()
  })

  describe("getSnapshot", () => {
    it("returns defaults for new user when no DB record exists", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)

      const snap = await engine.getSnapshot("user-1")

      expect(snap.userId).toBe("user-1")
      expect(snap.formality).toBe(3)
      expect(snap.verbosity).toBe(2)
      expect(snap.humor).toBe(1)
      expect(snap.proactivity).toBe(3)
      expect(snap.language).toBe("auto")
      expect(snap.tonePreset).toBe("jarvis")
      expect(snap.behavioralPrefs).toEqual([])
    })

    it("returns cached snapshot on second call without hitting DB again", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)

      await engine.getSnapshot("user-2")
      await engine.getSnapshot("user-2")

      expect(prisma.userPreference.findUnique).toHaveBeenCalledTimes(1)
    })

    it("maps DB record correctly to snapshot", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue({
        userId: "user-3",
        formality: 5,
        verbosity: 1,
        humor: 2,
        proactivity: 4,
        language: "id",
        titleWord: "Bro",
        tonePreset: "friday",
        behavioralPrefs: [{ description: "prefers bullet points", confidence: 0.8, source: "implicit", updatedAt: "2026-01-01" }],
        customTraits: ["Never apologize excessively"],
        inferenceConfidence: 0.7,
        preferenceHistory: {},
        lastInferredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const snap = await engine.getSnapshot("user-3")

      expect(snap.formality).toBe(5)
      expect(snap.verbosity).toBe(1)
      expect(snap.language).toBe("id")
      expect(snap.titleWord).toBe("Bro")
      expect(snap.tonePreset).toBe("friday")
      expect(snap.behavioralPrefs).toHaveLength(1)
      expect(snap.customTraits).toEqual(["Never apologize excessively"])
      expect(snap.inferenceConfidence).toBe(0.7)
    })
  })

  describe("applySignal", () => {
    it("increases verbosity slider when positive delta", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.userPreference.upsert).mockResolvedValue({} as never)

      await engine.applySignal("user-1", "verbosity", 1, 0.9)

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          update: expect.objectContaining({ verbosity: expect.any(Number) }),
        }),
      )
      const updateCall = vi.mocked(prisma.userPreference.upsert).mock.calls[0]?.[0]
      const newValue = (updateCall?.update as Record<string, number>)?.verbosity ?? 0
      expect(newValue).toBeGreaterThan(2) // default was 2, delta +1 should increase it
    })

    it("decreases formality slider when negative delta", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.userPreference.upsert).mockResolvedValue({} as never)

      await engine.applySignal("user-1", "formality", -1, 0.9)

      const updateCall = vi.mocked(prisma.userPreference.upsert).mock.calls[0]?.[0]
      const newValue = (updateCall?.update as Record<string, number>)?.formality ?? 3
      expect(newValue).toBeLessThan(3) // default was 3
    })

    it("clamps verbosity to [1, 5] range", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue({
        userId: "user-1", formality: 5, verbosity: 5, humor: 1, proactivity: 3,
        language: "auto", titleWord: "Sir", tonePreset: "jarvis",
        behavioralPrefs: [], customTraits: [], inferenceConfidence: 0,
        preferenceHistory: {}, lastInferredAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      })
      vi.mocked(prisma.userPreference.upsert).mockResolvedValue({} as never)

      await engine.applySignal("user-1", "verbosity", 100, 1.0)

      const updateCall = vi.mocked(prisma.userPreference.upsert).mock.calls[0]?.[0]
      const newValue = (updateCall?.update as Record<string, number>)?.verbosity ?? 0
      expect(newValue).toBeLessThanOrEqual(5)
    })

    it("clamps humor to [1, 3] range (humor max is 3)", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.userPreference.upsert).mockResolvedValue({} as never)

      await engine.applySignal("user-1", "humor", 100, 1.0)

      const updateCall = vi.mocked(prisma.userPreference.upsert).mock.calls[0]?.[0]
      const newValue = (updateCall?.update as Record<string, number>)?.humor ?? 0
      expect(newValue).toBeLessThanOrEqual(3)
    })
  })

  describe("setLanguage", () => {
    it("persists language preference", async () => {
      vi.mocked(prisma.userPreference.upsert).mockResolvedValue({} as never)

      await engine.setLanguage("user-1", "id")

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { language: "id" },
        }),
      )
    })
  })

  describe("setTonePreset", () => {
    it("persists tone preset", async () => {
      vi.mocked(prisma.userPreference.upsert).mockResolvedValue({} as never)

      await engine.setTonePreset("user-1", "friday")

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { tonePreset: "friday" },
        }),
      )
    })
  })

  describe("runInferenceCycle", () => {
    it("skips inference when less than 3 messages", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)

      await engine.runInferenceCycle("user-1", ["hello"])

      expect(orchestrator.generate).not.toHaveBeenCalled()
    })

    it("calls LLM and updates behavioral prefs with 3+ messages", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)
      vi.mocked(orchestrator.generate).mockResolvedValue(
        '[{"description": "prefers brief answers", "confidence": 0.8}]',
      )
      vi.mocked(prisma.userPreference.upsert).mockResolvedValue({} as never)
      vi.mocked(prisma.userPreference.update).mockResolvedValue({} as never)

      await engine.runInferenceCycle("user-1", ["msg1", "msg2", "msg3"])

      expect(orchestrator.generate).toHaveBeenCalledWith("fast", expect.objectContaining({
        prompt: expect.stringContaining("communication style"),
      }))
    })

    it("handles invalid JSON response from LLM gracefully", async () => {
      vi.mocked(prisma.userPreference.findUnique).mockResolvedValue(null)
      vi.mocked(orchestrator.generate).mockResolvedValue("not valid json")

      // Should not throw
      await expect(engine.runInferenceCycle("user-1", ["a", "b", "c"])).resolves.not.toThrow()
    })
  })
})
