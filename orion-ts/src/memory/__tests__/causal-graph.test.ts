import { describe, expect, it } from "vitest"

import { __causalGraphTestUtils } from "../causal-graph.js"

describe("causal-graph helpers", () => {
  it("extracts and normalizes JSON payloads from noisy model output", () => {
    const parsed = __causalGraphTestUtils.parseExtractionPayload(`
Here is the result:
\`\`\`json
{
  "events": [
    { "event": "Late sleep", "category": "Health" },
    { "event": "late sleep", "category": "health" }
  ],
  "causes": [
    { "cause": "Late sleep", "effect": "Missed meeting", "confidence": 1.5 },
    { "cause": "Late sleep", "effect": "Missed meeting", "confidence": 0.2 }
  ],
  "hyperEdges": [
    { "nodes": ["Late sleep", "Missed meeting", "Late sleep"], "relation": "Routine pattern", "context": "Weekday issue", "weight": 0.9 }
  ]
}
\`\`\`
`)

    expect(parsed).not.toBeNull()
    expect(parsed?.events).toEqual([{ event: "Late sleep", category: "health" }])
    expect(parsed?.causes).toEqual([{ cause: "Late sleep", effect: "Missed meeting", confidence: 1 }])
    expect(parsed?.hyperEdges).toEqual([{
      nodes: ["Late sleep", "Missed meeting"],
      relation: "Routine pattern",
      context: "Weekday issue",
      weight: 0.9,
    }])
  })

  it("builds hyperedge keys independent of node order", () => {
    const a = __causalGraphTestUtils.buildHyperEdgeKey(["A", "B", "C"], "rel")
    const b = __causalGraphTestUtils.buildHyperEdgeKey(["C", "A", "B"], "rel")

    expect(a).toBe(b)
  })

  it("compares string sets independent of order", () => {
    expect(__causalGraphTestUtils.sameStringSet(["a", "b"], ["b", "a"])).toBe(true)
    expect(__causalGraphTestUtils.sameStringSet(["a", "b"], ["a"])).toBe(false)
    expect(__causalGraphTestUtils.sameStringSet(["a", "b"], ["a", "c"])).toBe(false)
  })

  it("normalizes query text by trimming and clipping", () => {
    const normalized = __causalGraphTestUtils.normalizeQueryText(`  hello  ${"x".repeat(600)} `)

    expect(normalized.startsWith("hello")).toBe(true)
    expect(normalized.length).toBeLessThanOrEqual(500)
  })
})
