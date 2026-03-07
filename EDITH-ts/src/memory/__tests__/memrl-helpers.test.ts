import { describe, expect, it } from "vitest"

import { __memrlTestUtils } from "../memrl.js"

const { toSimilarityScore, normalizeSimilarityThreshold, extractIntent, computeEffectiveReward } = __memrlTestUtils

function makeRow(overrides: Record<string, unknown>) {
  return {
    id: "m1",
    userId: "u1",
    content: "content",
    metadata: "{}",
    ...overrides,
  }
}

describe("MemRL toSimilarityScore", () => {
  it("converts zero distance to 1.0 similarity", () => {
    expect(toSimilarityScore(makeRow({ _distance: 0 }))).toBe(1)
  })

  it("converts large distance to low (but positive) similarity", () => {
    const score = toSimilarityScore(makeRow({ _distance: 100 }))
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.05)
  })

  it("prefers _distance over distance", () => {
    const score = toSimilarityScore(makeRow({ _distance: 1, distance: 100 }))
    expect(score).toBeCloseTo(0.5, 1)
  })

  it("uses distance field as fallback", () => {
    const score = toSimilarityScore(makeRow({ distance: 3 }))
    expect(score).toBeCloseTo(0.25, 1)
  })

  it("uses similarity field directly when in [0, 1]", () => {
    expect(toSimilarityScore(makeRow({ similarity: 0.8 }))).toBe(0.8)
    expect(toSimilarityScore(makeRow({ similarity: 0.0 }))).toBe(0)
    expect(toSimilarityScore(makeRow({ similarity: 1.0 }))).toBe(1)
  })

  it("converts negative scores via sigmoid-like transform", () => {
    const score = toSimilarityScore(makeRow({ _score: -4 }))
    expect(score).toBeCloseTo(0.2, 1)
  })

  it("returns 0.5 when no recognizable field exists", () => {
    expect(toSimilarityScore(makeRow({ unknown: 42 }))).toBe(0.5)
  })

  it("handles large negative _score gracefully", () => {
    const score = toSimilarityScore(makeRow({ _score: -1000 }))
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it("handles _score of 0", () => {
    // 0 is in [0,1] so treated as direct similarity
    const score = toSimilarityScore(makeRow({ _score: 0 }))
    expect(score).toBe(0)
  })
})

describe("MemRL normalizeSimilarityThreshold", () => {
  it("returns 0.3 for NaN", () => {
    expect(normalizeSimilarityThreshold(Number.NaN)).toBe(0.3)
  })

  it("returns 0.3 for Infinity", () => {
    expect(normalizeSimilarityThreshold(Number.POSITIVE_INFINITY)).toBe(0.3)
    expect(normalizeSimilarityThreshold(Number.NEGATIVE_INFINITY)).toBe(0.3)
  })

  it("clamps negative values to 0", () => {
    expect(normalizeSimilarityThreshold(-1)).toBe(0)
    expect(normalizeSimilarityThreshold(-0.5)).toBe(0)
  })

  it("clamps values above 1", () => {
    expect(normalizeSimilarityThreshold(2)).toBe(1)
    expect(normalizeSimilarityThreshold(1.001)).toBe(1)
  })

  it("preserves valid thresholds", () => {
    expect(normalizeSimilarityThreshold(0)).toBe(0)
    expect(normalizeSimilarityThreshold(0.5)).toBe(0.5)
    expect(normalizeSimilarityThreshold(1)).toBe(1)
  })
})

describe("MemRL extractIntent", () => {
  it("extracts first sentence from multi-sentence text", () => {
    expect(extractIntent("Plan a migration. Then run tests.")).toBe("Plan a migration")
  })

  it("uses question mark as sentence delimiter", () => {
    expect(extractIntent("Why does it fail? I need help.")).toBe("Why does it fail")
  })

  it("uses exclamation mark as sentence delimiter", () => {
    expect(extractIntent("Fix this now! It's urgent.")).toBe("Fix this now")
  })

  it("clips at 200 characters", () => {
    const longText = "a".repeat(300)
    expect(extractIntent(longText).length).toBeLessThanOrEqual(200)
  })

  it("handles empty string", () => {
    expect(extractIntent("")).toBe("")
  })

  it("trims whitespace from intent", () => {
    expect(extractIntent("  Plan a migration.  ")).toBe("Plan a migration")
  })
})

describe("MemRL computeEffectiveReward", () => {
  it("blends explicit reward with task success signal", () => {
    // 0.8 * 0.7 + 0 * 0.3 = 0.56
    expect(computeEffectiveReward(0.8, false)).toBeCloseTo(0.56, 2)
    // 0.8 * 0.7 + 1 * 0.3 = 0.86
    expect(computeEffectiveReward(0.8, true)).toBeCloseTo(0.86, 2)
  })

  it("clamps negative explicit reward to 0", () => {
    expect(computeEffectiveReward(-10, false)).toBe(0)
    expect(computeEffectiveReward(-1, true)).toBeCloseTo(0.3, 2)
  })

  it("clamps above-1 explicit reward", () => {
    expect(computeEffectiveReward(10, true)).toBe(1)
    expect(computeEffectiveReward(10, false)).toBeCloseTo(0.7, 2)
  })

  it("returns 0.3 for zero reward + task success", () => {
    expect(computeEffectiveReward(0, true)).toBeCloseTo(0.3, 2)
  })

  it("returns 0 for zero reward + task failure", () => {
    expect(computeEffectiveReward(0, false)).toBe(0)
  })

  it("returns exactly 1 for perfect reward + success", () => {
    expect(computeEffectiveReward(1, true)).toBe(1)
  })
})
