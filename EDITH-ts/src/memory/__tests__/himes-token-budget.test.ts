import { describe, expect, it } from "vitest"

import { __himesTestUtils } from "../himes.js"

const { estimateTokens, enforceTokenBudget } = __himesTestUtils

describe("HiMeS token estimation", () => {
  it("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("")).toBe(0)
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("hello world")).toBe(3) // 11 chars / 4 → ceil(2.75) = 3
    expect(estimateTokens("a")).toBe(1)
  })

  it("handles long text proportionally", () => {
    const text = "x".repeat(4000)
    expect(estimateTokens(text)).toBe(1000)
  })
})

describe("HiMeS token budget enforcement", () => {
  const makeEntry = (content: string, role: "user" | "assistant" = "user") => ({ role, content })

  it("returns all entries when within budget", () => {
    const context = [
      makeEntry("short message"),       // ~4 tokens
      makeEntry("another short one"),   // ~5 tokens
    ]

    const result = enforceTokenBudget(context, 1000)
    expect(result).toHaveLength(2)
    expect(result).toEqual(context)
  })

  it("drops entries that exceed the budget", () => {
    const context = [
      makeEntry("a".repeat(400)),   // ~100 tokens
      makeEntry("b".repeat(400)),   // ~100 tokens
      makeEntry("c".repeat(400)),   // ~100 tokens — should be dropped
    ]

    const result = enforceTokenBudget(context, 200)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("a".repeat(400))
    expect(result[1].content).toBe("b".repeat(400))
  })

  it("truncates a partially-fitting entry", () => {
    const context = [
      makeEntry("a".repeat(400)),   // ~100 tokens
      makeEntry("b".repeat(800)),   // ~200 tokens — should be truncated to fit remaining ~100 tokens
    ]

    const result = enforceTokenBudget(context, 150)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("a".repeat(400))
    expect(result[1].content).toContain("[…truncated]")
    expect(result[1].content.length).toBeLessThan(800)
  })

  it("skips truncation when remaining budget is too small (≤20 tokens)", () => {
    const context = [
      makeEntry("a".repeat(396)),   // 99 tokens
      makeEntry("b".repeat(800)),   // should be skipped entirely since only ~1 token left
    ]

    const result = enforceTokenBudget(context, 100)
    expect(result).toHaveLength(1)
  })

  it("returns all entries when maxTokens is 0 (disabled)", () => {
    const context = [
      makeEntry("a".repeat(100_000)),
      makeEntry("b".repeat(100_000)),
    ]

    const result = enforceTokenBudget(context, 0)
    expect(result).toHaveLength(2)
  })

  it("preserves entry roles through truncation", () => {
    const context = [
      makeEntry("profile info", "user"),
      makeEntry("assistant response", "assistant"),
    ]

    const result = enforceTokenBudget(context, 10000)
    expect(result[0].role).toBe("user")
    expect(result[1].role).toBe("assistant")
  })

  it("handles empty context gracefully", () => {
    expect(enforceTokenBudget([], 100)).toEqual([])
  })

  it("handles single entry that exactly fits", () => {
    // 100 tokens = 400 chars exactly
    const context = [makeEntry("x".repeat(400))]
    const result = enforceTokenBudget(context, 100)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("x".repeat(400))
  })
})
