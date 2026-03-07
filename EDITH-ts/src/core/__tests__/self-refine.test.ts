import { describe, expect, it, vi } from "vitest"

import { selfRefine, __selfRefineTestUtils } from "../self-refine.js"

const { MAX_ITERATIONS, SATISFACTION_THRESHOLD, DEFAULT_DIMENSIONS } = __selfRefineTestUtils

describe("core/self-refine", () => {
  it("exports expected constants", () => {
    expect(MAX_ITERATIONS).toBe(3)
    expect(SATISFACTION_THRESHOLD).toBe(0.85)
    expect(DEFAULT_DIMENSIONS).toContain("accuracy")
    expect(DEFAULT_DIMENSIONS).toContain("clarity")
    expect(DEFAULT_DIMENSIONS).toContain("completeness")
  })

  it("stops immediately when feedback says stopRefining", async () => {
    // Mock a generator that returns the feedback JSON directly
    const generator = vi.fn()
      // First call: feedback (all scores high → stop)
      .mockResolvedValueOnce(JSON.stringify({
        dimensions: [
          { name: "accuracy", score: 0.95, feedback: "Great" },
          { name: "clarity", score: 0.9, feedback: "Good" },
        ],
        overallScore: 0.92,
        stopRefining: true,
        summary: "Excellent output",
      }))

    const result = await selfRefine("initial good output", {
      task: "write a greeting",
      generator,
      dimensions: ["accuracy", "clarity"],
    })

    expect(result.satisfiedEarly).toBe(true)
    expect(result.iterations).toBe(1)
    expect(result.output).toBe("initial good output")
    // Only feedback call, no refine call needed
    expect(generator).toHaveBeenCalledTimes(1)
  })

  it("refines when feedback scores are below threshold", async () => {
    let callCount = 0
    const generator = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        // First: feedback (low scores)
        return JSON.stringify({
          dimensions: [
            { name: "accuracy", score: 0.5, feedback: "Contains errors" },
          ],
          overallScore: 0.5,
          stopRefining: false,
          summary: "Needs improvement",
        })
      }
      if (callCount === 2) {
        // Second: refined output
        return "improved output"
      }
      // Third: feedback on improved (happy)
      return JSON.stringify({
        dimensions: [
          { name: "accuracy", score: 0.95, feedback: "Fixed" },
        ],
        overallScore: 0.95,
        stopRefining: true,
        summary: "Good now",
      })
    })

    const result = await selfRefine("initial bad output", {
      task: "write accurate info",
      generator,
      dimensions: ["accuracy"],
    })

    expect(result.satisfiedEarly).toBe(true)
    expect(result.iterations).toBe(2)
    expect(result.output).toBe("improved output")
    expect(result.initial).toBe("initial bad output")
  })

  it("limits to maxIterations", async () => {
    const generator = vi.fn().mockResolvedValue(JSON.stringify({
      dimensions: [
        { name: "accuracy", score: 0.4, feedback: "Still wrong" },
      ],
      overallScore: 0.4,
      stopRefining: false,
      summary: "Not good enough",
    }))

    const result = await selfRefine("bad output", {
      task: "complex task",
      generator,
      maxIterations: 2,
      dimensions: ["accuracy"],
    })

    expect(result.satisfiedEarly).toBe(false)
    // The history should track the iterations
    expect(result.history.length).toBeGreaterThan(0)
  })

  it("preserves history of all iterations", async () => {
    let callCount = 0
    const generator = vi.fn().mockImplementation(async () => {
      callCount++
      // All feedback returns not satisfied
      return JSON.stringify({
        dimensions: [{ name: "accuracy", score: 0.3, feedback: "Bad" }],
        overallScore: 0.3,
        stopRefining: false,
        summary: "Not good",
      })
    })

    const result = await selfRefine("initial", {
      task: "task",
      generator,
      maxIterations: 2,
      dimensions: ["accuracy"],
    })

    // Each iteration should be in history
    expect(result.history.length).toBeGreaterThan(0)
    for (const iter of result.history) {
      expect(iter.feedback).toBeDefined()
      expect(iter.feedback.dimensions).toBeDefined()
    }
  })

  it("returns finalScores from the last evaluation", async () => {
    const generator = vi.fn().mockResolvedValue(JSON.stringify({
      dimensions: [
        { name: "accuracy", score: 0.9, feedback: "Good" },
        { name: "clarity", score: 0.95, feedback: "Clear" },
      ],
      overallScore: 0.92,
      stopRefining: true,
      summary: "Great",
    }))

    const result = await selfRefine("output", {
      task: "task",
      generator,
      dimensions: ["accuracy", "clarity"],
    })

    expect(result.finalScores).toHaveLength(2)
    expect(result.finalScores[0].name).toBe("accuracy")
    expect(result.finalScores[1].name).toBe("clarity")
  })
})
