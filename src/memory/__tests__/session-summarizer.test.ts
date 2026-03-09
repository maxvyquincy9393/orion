/**
 * @file session-summarizer.test.ts
 * @description Unit tests for SessionSummarizer — compression trigger,
 * summary generation, fallback, and side effects.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ─────────────────────────────────────────────────────────────────────
const {
  getSessionHistoryMock,
  replaceSessionHistoryMock,
  saveMessageMock,
  generateMock,
} = vi.hoisted(() => ({
  getSessionHistoryMock: vi.fn(),
  replaceSessionHistoryMock: vi.fn(),
  saveMessageMock: vi.fn().mockResolvedValue(undefined),
  generateMock: vi.fn().mockResolvedValue("\u2022 Discussed task\n\u2022 Action item noted"),
}))

vi.mock("../../database/index.js", () => ({
  saveMessage: saveMessageMock,
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: { generate: generateMock },
}))

import { SessionSummarizer, setStoreAdapter } from "../session-summarizer.js"

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `Message ${i + 1} content that is meaningful.`,
    timestamp: Date.now() - (count - i) * 1000,
  })) as Array<{ role: "user" | "assistant" | "system"; content: string; timestamp: number }>
}

describe("SessionSummarizer", () => {
  let summarizer: SessionSummarizer

  beforeEach(() => {
    summarizer = new SessionSummarizer()
    vi.clearAllMocks()
    generateMock.mockResolvedValue("• Key point\n• Action noted")
    saveMessageMock.mockResolvedValue(undefined)
    // Inject mock store adapter (no module-level import of session-store needed)
    setStoreAdapter({
      getSessionHistory: getSessionHistoryMock,
      replaceSessionHistory: replaceSessionHistoryMock,
    })
  })

  // ── maybeCompress() ──────────────────────────────────────────────────────
  describe("maybeCompress()", () => {
    it("does nothing when history has fewer than 30 messages", async () => {
      getSessionHistoryMock.mockResolvedValue(makeMessages(15))
      await summarizer.maybeCompress("user1", "telegram")
      expect(generateMock).not.toHaveBeenCalled()
    })

    it("compresses when history reaches 30 messages", async () => {
      getSessionHistoryMock.mockResolvedValue(makeMessages(30))
      await summarizer.maybeCompress("user1", "telegram")
      expect(generateMock).toHaveBeenCalled()
    })

    it("silently returns on error", async () => {
      getSessionHistoryMock.mockRejectedValue(new Error("DB error"))
      await expect(summarizer.maybeCompress("user1", "telegram")).resolves.toBeUndefined()
    })
  })

  // ── compress() ───────────────────────────────────────────────────────────
  describe("compress()", () => {
    it("returns empty string when history is too short to compress", async () => {
      getSessionHistoryMock.mockResolvedValue(makeMessages(5))
      const result = await summarizer.compress("user1", "telegram", 10)
      expect(result).toBe("")
    })

    it("saves a summary message to the database", async () => {
      const messages = makeMessages(25)
      getSessionHistoryMock.mockResolvedValue(messages)

      await summarizer.compress("user1", "telegram", 10)

      expect(saveMessageMock).toHaveBeenCalledWith(
        "user1",
        "system",
        expect.any(String),
        "telegram",
        expect.objectContaining({ compressed: true }),
      )
    })

    it("replaces session history with summary + remaining messages", async () => {
      const messages = makeMessages(25)
      getSessionHistoryMock.mockResolvedValue(messages)

      await summarizer.compress("user1", "telegram", 10)

      expect(replaceSessionHistoryMock).toHaveBeenCalledWith(
        "user1",
        "telegram",
        expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
        ])
      )
    })

    it("returns the generated summary string", async () => {
      getSessionHistoryMock.mockResolvedValue(makeMessages(25))
      generateMock.mockResolvedValue("Summary text")

      const result = await summarizer.compress("user1", "telegram", 5)
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })

    it("uses fallback summary when LLM fails", async () => {
      getSessionHistoryMock.mockResolvedValue(makeMessages(25))
      generateMock.mockRejectedValue(new Error("LLM unavailable"))

      const result = await summarizer.compress("user1", "telegram", 5)
      expect(result).toContain("Compressed session summary")
    })

    it("silently returns on database error", async () => {
      getSessionHistoryMock.mockResolvedValue(makeMessages(25))
      saveMessageMock.mockRejectedValue(new Error("DB error"))

      const result = await summarizer.compress("user1", "telegram", 5)
      expect(typeof result).toBe("string")
    })
  })
})
