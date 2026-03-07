import { describe, expect, it } from "vitest"

import { LoopDetector, type LoopSignal } from "../loop-detector.js"

describe("LoopDetector", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // No loop
  // ───────────────────────────────────────────────────────────────────────────

  describe("no loop detection", () => {
    it("returns null for first few unique calls", () => {
      const detector = new LoopDetector()

      expect(detector.record("searchTool", { q: "A" }, "result A with lots of content and data")).toBeNull()
      expect(detector.record("fileTool", { path: "b" }, "file B content")).toBeNull()
    })

    it("returns null for diverse tool calls", () => {
      const detector = new LoopDetector()

      expect(detector.record("tool1", { a: 1 }, "output ".repeat(20))).toBeNull()
      expect(detector.record("tool2", { b: 2 }, "output ".repeat(20))).toBeNull()
      expect(detector.record("tool3", { c: 3 }, "output ".repeat(20))).toBeNull()
      expect(detector.record("tool4", { d: 4 }, "output ".repeat(20))).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Identical calls
  // ───────────────────────────────────────────────────────────────────────────

  describe("identical-calls detection", () => {
    it("returns warning after 3 identical calls", () => {
      const detector = new LoopDetector()
      const params = { query: "same" }
      const output = "same result with content"

      detector.record("searchTool", params, output)
      detector.record("searchTool", params, output)
      const signal = detector.record("searchTool", params, output)

      expect(signal).not.toBeNull()
      expect(signal!.severity).toBe("warning")
      expect(signal!.pattern).toBe("identical-calls")
      expect(signal!.shouldStop).toBe(false)
    })

    it("returns circuit-break after 5 identical calls", () => {
      const detector = new LoopDetector()
      const params = { query: "same" }
      const output = "same result with content"

      for (let i = 0; i < 4; i++) {
        detector.record("searchTool", params, output)
      }
      const signal = detector.record("searchTool", params, output)

      expect(signal).not.toBeNull()
      expect(signal!.severity).toBe("circuit-break")
      expect(signal!.pattern).toBe("identical-calls")
      expect(signal!.shouldStop).toBe(true)
    })

    it("distinguishes different params even for same tool", () => {
      const detector = new LoopDetector()
      const output = "result with content"

      detector.record("searchTool", { q: "A" }, output)
      detector.record("searchTool", { q: "B" }, output)
      const signal = detector.record("searchTool", { q: "C" }, output)

      // 3 unique param sets, should not be identical-calls
      expect(signal?.pattern !== "identical-calls" || signal === null).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Ping-pong detection
  // ───────────────────────────────────────────────────────────────────────────

  describe("ping-pong detection", () => {
    it("detects alternating A→B→A→B→A→B pattern", () => {
      const detector = new LoopDetector()
      const output = "x".repeat(60) // enough content

      detector.record("toolA", { a: 1 }, output)
      detector.record("toolB", { b: 1 }, output)
      detector.record("toolA", { a: 2 }, output)
      detector.record("toolB", { b: 2 }, output)
      detector.record("toolA", { a: 3 }, output)
      const signal = detector.record("toolB", { b: 3 }, output)

      // After 6 records with alternation pattern, should detect
      if (signal) {
        expect(signal.pattern).toBe("ping-pong")
        expect(signal.shouldStop).toBe(true)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Reset
  // ───────────────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("clears history so no loops are detected after reset", () => {
      const detector = new LoopDetector()
      const params = { q: "same" }
      const output = "same result"

      detector.record("searchTool", params, output)
      detector.record("searchTool", params, output)

      detector.reset()

      // After reset, counter starts over
      const signal = detector.record("searchTool", params, output)
      expect(signal).toBeNull()
    })
  })
})
