import { describe, expect, it } from "vitest"

import {
  __causalGraphDedupeUtilsTestUtils,
  chooseCanonicalHyperEdge,
  chooseCanonicalNode,
  groupDuplicateCausalNodes,
  groupDuplicateHyperEdges,
  type CausalNodeDedupeCandidate,
  type HyperEdgeDedupeCandidate,
} from "../causal-graph-dedupe-utils.js"

describe("causal-graph-dedupe-utils", () => {
  it("normalizes event and relation keys deterministically", () => {
    expect(__causalGraphDedupeUtilsTestUtils.normalizeCausalEventKey("  Late   Sleep  ")).toBe("late sleep")
    expect(__causalGraphDedupeUtilsTestUtils.normalizeHyperEdgeRelationKey("  Routine   Pattern ")).toBe("routine pattern")
  })

  it("builds stable member-set hash independent of order and duplicates", () => {
    const a = __causalGraphDedupeUtilsTestUtils.computeHyperEdgeMemberSetHash("Rel", ["b", "a", "b"])
    const b = __causalGraphDedupeUtilsTestUtils.computeHyperEdgeMemberSetHash(" rel ", ["a", "b"])

    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it("groups duplicate causal nodes by normalized event key per user", () => {
    const nodes: CausalNodeDedupeCandidate[] = [
      { id: "2", userId: "u1", event: "Late sleep", createdAt: new Date("2026-02-01T00:00:01Z") },
      { id: "1", userId: "u1", event: " late   sleep ", createdAt: new Date("2026-02-01T00:00:00Z") },
      { id: "3", userId: "u2", event: "Late sleep", createdAt: new Date("2026-02-01T00:00:02Z") },
    ]

    const groups = groupDuplicateCausalNodes(nodes)

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ userId: "u1", eventKey: "late sleep" })
    expect(groups[0]?.nodes.map((node) => node.id)).toEqual(["1", "2"])
    expect(chooseCanonicalNode(groups[0]?.nodes ?? [])?.id).toBe("1")
  })

  it("groups duplicate hyperedges by user + relation + member set", () => {
    const edges: HyperEdgeDedupeCandidate[] = [
      { id: "h2", userId: "u1", relation: "Routine", context: "short", weight: 0.4, memberNodeIds: ["b", "a"] },
      { id: "h1", userId: "u1", relation: " routine ", context: "longer context", weight: 0.8, memberNodeIds: ["a", "b", "b"] },
      { id: "h3", userId: "u1", relation: "other", context: "x", weight: 0.5, memberNodeIds: ["a", "b"] },
    ]

    const groups = groupDuplicateHyperEdges(edges)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.relationKey).toBe("routine")
    expect(groups[0]?.edges.map((edge) => edge.id)).toEqual(["h1", "h2"])
    expect(chooseCanonicalHyperEdge(groups[0]?.edges ?? [])?.id).toBe("h1")
  })

  it("prefers longer non-empty context when merging hyperedges", () => {
    const merged = __causalGraphDedupeUtilsTestUtils.chooseMergedHyperEdgeContext(["", "short", "a much longer context"])
    expect(merged).toBe("a much longer context")
  })
})
