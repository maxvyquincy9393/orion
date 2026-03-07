import { describe, expect, it } from "vitest"

import { __memrlTestUtils } from "../memrl.js"

function makeRow(overrides: Record<string, unknown>): {
  id: string
  userId: string
  content: string
  metadata: string
} & Record<string, unknown> {
  return {
    id: "m1",
    userId: "u1",
    content: "content",
    metadata: "{}",
    ...overrides,
  }
}

describe("MemRL helpers", () => {
  it("converts distance-based and score-based LanceDB rows to bounded similarity", () => {
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ _distance: 0 }))).toBe(1)
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ distance: 3 }))).toBeCloseTo(0.25)
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ similarity: 0.8 }))).toBe(0.8)
    expect(__memrlTestUtils.toSimilarityScore(makeRow({ _score: -4 }))).toBeCloseTo(0.2)
  })

  it("normalizes similarity thresholds safely", () => {
    expect(__memrlTestUtils.normalizeSimilarityThreshold(Number.NaN)).toBe(0.3)
    expect(__memrlTestUtils.normalizeSimilarityThreshold(-1)).toBe(0)
    expect(__memrlTestUtils.normalizeSimilarityThreshold(2)).toBe(1)
  })

  it("extracts intent from the first sentence and clips long text", () => {
    const text = `Plan a migration. Then run tests.${"x".repeat(400)}`
    const intent = __memrlTestUtils.extractIntent(text)

    expect(intent).toBe("Plan a migration")
    expect(intent.length).toBeLessThanOrEqual(200)
  })

  it("blends explicit reward with task-success signal deterministically", () => {
    expect(__memrlTestUtils.computeEffectiveReward(0.8, false)).toBeCloseTo(0.56)
    expect(__memrlTestUtils.computeEffectiveReward(0.8, true)).toBeCloseTo(0.86)
    expect(__memrlTestUtils.computeEffectiveReward(-10, false)).toBe(0)
    expect(__memrlTestUtils.computeEffectiveReward(10, true)).toBe(1)
  })
})
