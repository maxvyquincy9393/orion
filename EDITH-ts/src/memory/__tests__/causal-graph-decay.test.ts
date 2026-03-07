import { describe, expect, it } from "vitest"

import { __causalGraphTestUtils } from "../causal-graph.js"

const { applyTemporalEdgeDecay } = __causalGraphTestUtils

const day = (n: number) => new Date(Date.now() - n * 86_400_000)

describe("causal-graph temporal edge decay", () => {
  it("returns full strength for edges created right now", () => {
    const now = new Date()
    const result = applyTemporalEdgeDecay(0.8, 3, now, now)
    expect(result).toBeCloseTo(0.8, 5)
  })

  it("decays strength over time", () => {
    const strength = 0.8
    const createdAt = day(90) // 90 days ago (one half-life base)

    const decayed = applyTemporalEdgeDecay(strength, 1, createdAt)
    // With evidence=1: stabilizer = 1 + ln(1) = 1
    // effectiveHalfLife = 90 * 1 = 90 days
    // After exactly 1 half-life: strength * 0.5 = 0.4
    expect(decayed).toBeCloseTo(0.4, 1)
  })

  it("decays slower with higher evidence (spacing effect)", () => {
    const strength = 0.8
    const createdAt = day(90)

    const lowEvidence = applyTemporalEdgeDecay(strength, 1, createdAt)
    const highEvidence = applyTemporalEdgeDecay(strength, 10, createdAt)

    // Higher evidence → slower decay → higher remaining strength
    expect(highEvidence).toBeGreaterThan(lowEvidence)
  })

  it("does not decay future edges (createdAt > now)", () => {
    const futureEdge = new Date(Date.now() + 86_400_000)
    const result = applyTemporalEdgeDecay(0.9, 2, futureEdge)
    expect(result).toBe(0.9)
  })

  it("clamps result to [0, 1] range", () => {
    const ancient = day(10_000) // very old
    const result = applyTemporalEdgeDecay(0.5, 1, ancient)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })

  it("decays to near-zero for very old, low-evidence edges", () => {
    const ancient = day(1000) // ~11 half-lives with evidence=1
    const result = applyTemporalEdgeDecay(0.8, 1, ancient)
    expect(result).toBeLessThan(0.01)
  })

  it("preserves well-established edges over moderate time", () => {
    // An edge with 20 reinforcements should still be meaningful after 30 days
    const createdAt = day(30)
    const result = applyTemporalEdgeDecay(0.9, 20, createdAt)
    expect(result).toBeGreaterThan(0.8) // barely decayed
  })

  it("handles evidence of 0 the same as evidence of 1", () => {
    const createdAt = day(90)
    const zeroEvidence = applyTemporalEdgeDecay(0.8, 0, createdAt)
    const oneEvidence = applyTemporalEdgeDecay(0.8, 1, createdAt)
    // Math.max(1, evidence) means 0 is treated as 1
    expect(zeroEvidence).toBeCloseTo(oneEvidence, 5)
  })
})
