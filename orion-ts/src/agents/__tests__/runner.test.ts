import { describe, expect, it } from "vitest"

import { __runnerTestUtils } from "../runner.js"

describe("agents/runner budget helpers", () => {
  it("normalizes max llm calls with sane lower bound", () => {
    expect(__runnerTestUtils.normalizeMaxLlmCalls(12.8)).toBe(12)
    expect(__runnerTestUtils.normalizeMaxLlmCalls(0)).toBe(1)
  })

  it("detects budget overflow before consuming calls", () => {
    expect(__runnerTestUtils.wouldExceedLlmBudget(5, 3, 10)).toBe(false)
    expect(__runnerTestUtils.wouldExceedLlmBudget(8, 3, 10)).toBe(true)
  })
})

