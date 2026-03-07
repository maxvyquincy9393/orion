import { describe, expect, it } from "vitest"

import { __causalGraphTestUtils } from "../causal-graph.js"

const {
  parseExtractionPayload,
  extractFirstJsonObject,
  buildHyperEdgeKey,
  sameStringSet,
  normalizeQueryText,
  bayesianStrengthUpdate,
} = __causalGraphTestUtils

describe("extractFirstJsonObject", () => {
  it("extracts JSON from surrounding prose", () => {
    const raw = 'Here is the result:\n{"key": "value"}\nEnd.'
    expect(extractFirstJsonObject(raw)).toBe('{"key": "value"}')
  })

  it("handles nested objects", () => {
    const raw = '{"outer": {"inner": true}}'
    expect(extractFirstJsonObject(raw)).toBe('{"outer": {"inner": true}}')
  })

  it("handles strings with escaped quotes", () => {
    const raw = '{"text": "he said \\"hi\\"."}'
    expect(extractFirstJsonObject(raw)).toBe('{"text": "he said \\"hi\\"."}')
  })

  it("returns null when no JSON object found", () => {
    expect(extractFirstJsonObject("no json here")).toBeNull()
    expect(extractFirstJsonObject("[1,2,3]")).toBeNull()
    expect(extractFirstJsonObject("")).toBeNull()
  })

  it("returns null for unclosed object", () => {
    expect(extractFirstJsonObject('{"key": "value"')).toBeNull()
  })
})

describe("parseExtractionPayload edge cases", () => {
  it("returns null for empty string", () => {
    expect(parseExtractionPayload("")).toBeNull()
  })

  it("returns null for non-object JSON", () => {
    expect(parseExtractionPayload("[1,2,3]")).toBeNull()
    expect(parseExtractionPayload('"hello"')).toBeNull()
  })

  it("handles missing arrays gracefully", () => {
    const parsed = parseExtractionPayload('{"events": [], "causes": [], "hyperEdges": []}')
    expect(parsed).not.toBeNull()
    expect(parsed?.events).toEqual([])
    expect(parsed?.causes).toEqual([])
    expect(parsed?.hyperEdges).toEqual([])
  })

  it("filters out events with empty text", () => {
    const parsed = parseExtractionPayload('{"events": [{"event": "", "category": "work"}, {"event": "Valid event", "category": "work"}], "causes": [], "hyperEdges": []}')
    expect(parsed?.events).toEqual([{ event: "Valid event", category: "work" }])
  })

  it("rejects self-referential causes (cause === effect)", () => {
    const parsed = parseExtractionPayload('{"events": [], "causes": [{"cause": "sleep", "effect": "sleep", "confidence": 0.8}], "hyperEdges": []}')
    expect(parsed?.causes).toEqual([])
  })

  it("clamps confidence above 1.0 to 1.0", () => {
    const parsed = parseExtractionPayload('{"events": [], "causes": [{"cause": "A", "effect": "B", "confidence": 5.0}], "hyperEdges": []}')
    expect(parsed?.causes[0].confidence).toBe(1)
  })

  it("uses default confidence when value is missing", () => {
    const parsed = parseExtractionPayload('{"events": [], "causes": [{"cause": "A", "effect": "B"}], "hyperEdges": []}')
    expect(parsed?.causes[0].confidence).toBe(0.5)
  })

  it("deduplicates hyper-edges by normalized key", () => {
    const parsed = parseExtractionPayload(JSON.stringify({
      events: [],
      causes: [],
      hyperEdges: [
        { nodes: ["A", "B"], relation: "related", context: "ctx1", weight: 0.5 },
        { nodes: ["B", "A"], relation: "related", context: "ctx2", weight: 0.7 },
      ],
    }))
    expect(parsed?.hyperEdges).toHaveLength(1)
  })

  it("requires at least 2 unique nodes for hyper-edges", () => {
    const parsed = parseExtractionPayload(JSON.stringify({
      events: [],
      causes: [],
      hyperEdges: [
        { nodes: ["A"], relation: "orphan", context: "", weight: 0.5 },
        { nodes: ["A", "A"], relation: "self", context: "", weight: 0.5 },
      ],
    }))
    expect(parsed?.hyperEdges).toEqual([])
  })
})

describe("buildHyperEdgeKey", () => {
  it("is order-independent", () => {
    expect(buildHyperEdgeKey(["X", "Y", "Z"], "rel"))
      .toBe(buildHyperEdgeKey(["Z", "X", "Y"], "rel"))
  })

  it("is case-insensitive for relation", () => {
    expect(buildHyperEdgeKey(["A", "B"], "Related"))
      .toBe(buildHyperEdgeKey(["A", "B"], "related"))
  })

  it("distinguishes different relations", () => {
    expect(buildHyperEdgeKey(["A", "B"], "causes"))
      .not.toBe(buildHyperEdgeKey(["A", "B"], "correlates"))
  })
})

describe("sameStringSet", () => {
  it("matches identical sets in different order", () => {
    expect(sameStringSet(["c", "a", "b"], ["a", "b", "c"])).toBe(true)
  })

  it("fails on different lengths", () => {
    expect(sameStringSet(["a"], ["a", "b"])).toBe(false)
  })

  it("fails on different contents", () => {
    expect(sameStringSet(["a", "b"], ["a", "c"])).toBe(false)
  })

  it("matches empty sets", () => {
    expect(sameStringSet([], [])).toBe(true)
  })
})

describe("normalizeQueryText", () => {
  it("trims whitespace", () => {
    expect(normalizeQueryText("  hello  ")).toBe("hello")
  })

  it("clips to max 500 chars", () => {
    const long = "x".repeat(600)
    expect(normalizeQueryText(long)).toHaveLength(500)
  })

  it("handles empty string", () => {
    expect(normalizeQueryText("")).toBe("")
  })
})

describe("bayesianStrengthUpdate", () => {
  it("increases strength when new confidence is high", () => {
    const updated = bayesianStrengthUpdate(0.3, 2, 0.9)
    expect(updated).toBeGreaterThan(0.3)
  })

  it("decreases strength when new confidence is low", () => {
    const updated = bayesianStrengthUpdate(0.7, 5, 0.1)
    expect(updated).toBeLessThan(0.7)
  })

  it("stays bounded in [0, 1]", () => {
    expect(bayesianStrengthUpdate(1, 100, 1)).toBeLessThanOrEqual(1)
    expect(bayesianStrengthUpdate(0, 100, 0)).toBeGreaterThanOrEqual(0)
  })

  it("moves slowly with high evidence (Bayesian inertia)", () => {
    const lowEvidence = bayesianStrengthUpdate(0.5, 1, 0.9)
    const highEvidence = bayesianStrengthUpdate(0.5, 50, 0.9)
    // High evidence should change less from the prior
    expect(Math.abs(highEvidence - 0.5)).toBeLessThan(Math.abs(lowEvidence - 0.5))
  })

  it("handles zero evidence gracefully", () => {
    const result = bayesianStrengthUpdate(0.5, 0, 0.8)
    expect(result).toBeGreaterThan(0.5)
    expect(result).toBeLessThanOrEqual(1)
  })

  it("handles NaN strength by treating as min", () => {
    const result = bayesianStrengthUpdate(Number.NaN, 3, 0.5)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })
})
