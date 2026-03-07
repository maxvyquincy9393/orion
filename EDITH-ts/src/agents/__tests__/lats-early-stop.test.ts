import { describe, expect, it, vi } from "vitest"

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(async (_task: string, options: { prompt: string }) => {
      if (options.prompt.includes("Propose")) {
        return JSON.stringify([
          { description: "take best action", reasoning: "high confidence" },
        ])
      }

      if (options.prompt.includes("Simulate the outcome")) {
        return JSON.stringify({
          observation: "perfect outcome",
          value: 1,
          newState: "solved",
        })
      }

      return "final answer"
    }),
  },
}))

import { latsSearch } from "../lats.js"

describe("agents/lats early termination", () => {
  it("stops early when best value passes threshold", async () => {
    const result = await latsSearch("solve this", {
      iterations: 5,
      expansionWidth: 1,
      maxDepth: 2,
      earlyStopThreshold: 0.95,
    })

    expect(result.terminatedEarly).toBe(true)
    expect(result.iterationsUsed).toBe(1)
    expect(result.bestValue).toBeGreaterThanOrEqual(0.95)
  })
})

