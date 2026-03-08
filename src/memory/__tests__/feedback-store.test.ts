/**
 * @file feedback-store.test.ts
 * @description Unit tests for FeedbackStore (Phase 10C).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../database/index.js", () => ({
  prisma: {
    preferenceSignal: {
      create: vi.fn(),
    },
  },
}))

vi.mock("../user-preference.js", () => ({
  userPreferenceEngine: {
    applySignal: vi.fn(),
    setLanguage: vi.fn(),
  },
}))

vi.mock("../store.js", () => ({
  memory: {
    provideFeedback: vi.fn(),
  },
}))

vi.mock("../../config.js", () => ({
  default: {
    PERSONALIZATION_ENABLED: true,
    PREFERENCE_ALPHA: 0.15,
  },
}))

import { FeedbackStore } from "../feedback-store.js"
import { userPreferenceEngine } from "../user-preference.js"
import { memory } from "../store.js"
import { prisma } from "../../database/index.js"

describe("FeedbackStore", () => {
  let store: FeedbackStore

  beforeEach(() => {
    store = new FeedbackStore()
    vi.clearAllMocks()
    vi.mocked(prisma.preferenceSignal.create).mockResolvedValue({} as never)
    vi.mocked(memory.provideFeedback).mockResolvedValue(undefined)
  })

  describe("captureExplicit", () => {
    it("detects 'too long' pattern and applies negative verbosity delta", async () => {
      await store.captureExplicit({ userId: "u1", message: "that was too long, please be more brief" })

      expect(userPreferenceEngine.applySignal).toHaveBeenCalledWith(
        "u1", "verbosity", expect.any(Number), expect.any(Number),
      )
      const call = vi.mocked(userPreferenceEngine.applySignal).mock.calls[0]!
      expect(call[2]).toBeLessThan(0) // negative delta
    })

    it("detects 'more detail' pattern and applies positive verbosity delta", async () => {
      await store.captureExplicit({ userId: "u1", message: "can you give more detail on that?" })

      const call = vi.mocked(userPreferenceEngine.applySignal).mock.calls[0]!
      expect(call[1]).toBe("verbosity")
      expect(call[2]).toBeGreaterThan(0)
    })

    it("detects Indonesian language signal and calls setLanguage", async () => {
      // Must match pattern: /\b(speak (in )?indonesian|pakai (bahasa )?indonesia|bahasa indonesia)\b/i
      await store.captureExplicit({ userId: "u1", message: "pakai bahasa indonesia ya" })

      expect(userPreferenceEngine.setLanguage).toHaveBeenCalledWith("u1", "id")
    })

    it("detects English language signal and calls setLanguage", async () => {
      // Must match pattern: /\b(speak (in )?english|pakai english|in english|bahasa inggris)\b/i
      await store.captureExplicit({ userId: "u1", message: "speak in english please" })

      expect(userPreferenceEngine.setLanguage).toHaveBeenCalledWith("u1", "en")
    })

    it("detects 'too formal' pattern and applies negative formality delta", async () => {
      await store.captureExplicit({ userId: "u1", message: "you're being too formal, just be casual" })

      const call = vi.mocked(userPreferenceEngine.applySignal).mock.calls[0]!
      expect(call[1]).toBe("formality")
      expect(call[2]).toBeLessThan(0)
    })

    it("persists signal to database", async () => {
      await store.captureExplicit({ userId: "u1", message: "too long please be brief" })

      expect(prisma.preferenceSignal.create).toHaveBeenCalled()
    })

    it("does not crash on message with no matching patterns", async () => {
      await expect(
        store.captureExplicit({ userId: "u1", message: "what is the weather today?" }),
      ).resolves.not.toThrow()

      expect(userPreferenceEngine.applySignal).not.toHaveBeenCalled()
    })
  })

  describe("captureBargeIn", () => {
    it("applies negative verbosity delta for early barge-in (<40% delivered)", async () => {
      await store.captureBargeIn({
        userId: "u1",
        responseLengthChars: 1000,
        deliveredChars: 300, // 30% — early
        memoryIds: [],
      })

      const call = vi.mocked(userPreferenceEngine.applySignal).mock.calls[0]!
      expect(call[1]).toBe("verbosity")
      expect(call[2]).toBeLessThan(0)
    })

    it("persists barge-in signal to database", async () => {
      await store.captureBargeIn({
        userId: "u1",
        responseLengthChars: 500,
        deliveredChars: 100,
        memoryIds: ["mem-1", "mem-2"],
      })

      // Signal should be persisted synchronously within captureBargeIn
      expect(prisma.preferenceSignal.create).toHaveBeenCalled()
    })

    it("uses lower confidence for late barge-in (>50% delivered)", async () => {
      await store.captureBargeIn({
        userId: "u1",
        responseLengthChars: 1000,
        deliveredChars: 750,
        memoryIds: [],
      })

      const call = vi.mocked(userPreferenceEngine.applySignal).mock.calls[0]!
      expect(call[3]).toBeLessThan(0.7) // confidence should be lower
    })
  })

  describe("captureEdit", () => {
    it("applies negative verbosity delta when text is significantly shortened", async () => {
      const original = "A".repeat(500) // long
      const edited = "A".repeat(100)   // shortened by >50 chars

      await store.captureEdit({ userId: "u1", original, edited })

      const call = vi.mocked(userPreferenceEngine.applySignal).mock.calls[0]!
      expect(call[1]).toBe("verbosity")
      expect(call[2]).toBeLessThan(0)
    })

    it("applies positive verbosity delta when text is significantly lengthened", async () => {
      const original = "Short answer."
      const edited = "A".repeat(200)

      await store.captureEdit({ userId: "u1", original, edited })

      const call = vi.mocked(userPreferenceEngine.applySignal).mock.calls[0]!
      expect(call[2]).toBeGreaterThan(0)
    })

    it("handles edit with no significant length change without crashing", async () => {
      await expect(
        store.captureEdit({ userId: "u1", original: "hello there", edited: "hi there" }),
      ).resolves.not.toThrow()
    })
  })

  describe("captureImplicit", () => {
    it("skips processing when no memory IDs provided", async () => {
      await store.captureImplicit({
        userId: "u1",
        userReply: "thanks!",
        previousResponseLengthChars: 200,
        memoryIds: [],
      })

      expect(memory.provideFeedback).not.toHaveBeenCalled()
    })

    it("routes high reward for explicit positive follow-up", async () => {
      await store.captureImplicit({
        userId: "u1",
        userReply: "that was very helpful, thanks!",
        previousResponseLengthChars: 300,
        memoryIds: ["mem-1"],
      })

      const call = vi.mocked(memory.provideFeedback).mock.calls[0]?.[0]
      expect(call?.reward).toBeGreaterThan(0.7)
      expect(call?.taskSuccess).toBe(true)
    })

    it("routes low reward for negative follow-up", async () => {
      await store.captureImplicit({
        userId: "u1",
        userReply: "that's wrong, not what i asked",
        previousResponseLengthChars: 300,
        memoryIds: ["mem-1"],
      })

      const call = vi.mocked(memory.provideFeedback).mock.calls[0]?.[0]
      expect(call?.reward).toBeLessThan(0.3)
      expect(call?.taskSuccess).toBe(false)
    })
  })
})
