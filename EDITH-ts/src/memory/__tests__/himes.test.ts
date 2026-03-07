import { describe, expect, it } from "vitest"

import { __himesTestUtils } from "../himes.js"

describe("HiMeS helper transforms", () => {
  it("deduplicates long-term memories", () => {
    const deduped = __himesTestUtils.dedupeMemories([
      "User likes tea",
      "user likes tea",
      "Prefers morning meetings",
    ])

    expect(deduped).toEqual([
      "User likes tea",
      "Prefers morning meetings",
    ])
  })

  it("applies forgetting curve while preserving at least some context", () => {
    const memories = Array.from({ length: 12 }, (_, idx) => `memory-${idx}`)
    const retained = __himesTestUtils.applyForgettingCurve(memories)

    expect(retained.length).toBeGreaterThan(0)
    expect(retained.length).toBeLessThan(memories.length)
  })

  it("consolidates long tail memories into a summary block", () => {
    const memories = Array.from({ length: 9 }, (_, idx) => `fact-${idx}`)
    const consolidated = __himesTestUtils.consolidateMemories(memories)

    expect(consolidated.length).toBeLessThan(memories.length)
    expect(consolidated[consolidated.length - 1]).toContain("[Consolidated Memory]")
  })
})

