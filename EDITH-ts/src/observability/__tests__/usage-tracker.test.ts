import { describe, expect, it } from "vitest"

import { UsageTracker } from "../usage-tracker.js"

describe("UsageTracker", () => {
  it("infers pricing for openrouter models from underlying provider model names", () => {
    const tracker = new UsageTracker({ enabled: false })
    const cost = tracker.estimateCost("openrouter", "anthropic/claude-3-sonnet", 1000, 1000)

    // claude-3-sonnet pricing in table: 0.003 prompt + 0.015 completion
    expect(cost).toBeCloseTo(0.018)
  })

  it("uses conservative default pricing for unknown models", () => {
    const tracker = new UsageTracker({ enabled: false })
    const cost = tracker.estimateCost("unknown", "mystery-model", 500_000, 500_000)

    // $1 per 1M tokens fallback
    expect(cost).toBeCloseTo(1)
  })
})
