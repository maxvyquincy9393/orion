import { describe, expect, it } from "vitest"

import { __latsTestUtils } from "../lats.js"
import type { LATSNode, LATSAction } from "../lats.js"

const {
  selectUCB1,
  selectLeaf,
  backpropagate,
  extractBestPath,
  buildStateHistory,
  parseActionArray,
  UCB_C,
  DEFAULT_ITERATIONS,
  DEFAULT_EXPANSION_WIDTH,
  DEFAULT_MAX_DEPTH,
  GAMMA,
} = __latsTestUtils

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(
  overrides: Partial<LATSNode> & { id: string },
): LATSNode {
  return {
    depth: 0,
    action: null,
    state: "test-state",
    totalValue: 0,
    visits: 0,
    parent: null,
    children: [],
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("agents/lats", () => {
  // ── Constants ──────────────────────────────────────────────────────────────

  it("exports expected constants", () => {
    expect(UCB_C).toBeCloseTo(Math.SQRT2, 10)
    expect(DEFAULT_ITERATIONS).toBe(4)
    expect(DEFAULT_EXPANSION_WIDTH).toBe(3)
    expect(DEFAULT_MAX_DEPTH).toBe(4)
    expect(GAMMA).toBe(0.95)
  })

  // ── selectUCB1 ────────────────────────────────────────────────────────────

  describe("selectUCB1", () => {
    it("returns the node itself when it has no children", () => {
      const node = makeNode({ id: "root" })
      expect(selectUCB1(node)).toBe(node)
    })

    it("picks an unvisited child immediately", () => {
      const parent = makeNode({ id: "p", visits: 5 })
      const visited = makeNode({ id: "c1", visits: 3, totalValue: 1.5, parent })
      const unvisited = makeNode({ id: "c2", visits: 0, parent })
      parent.children = [visited, unvisited]

      expect(selectUCB1(parent)).toBe(unvisited)
    })

    it("balances exploitation and exploration", () => {
      const parent = makeNode({ id: "p", visits: 10 })
      // Child A: high exploitation, moderate visits
      const childA = makeNode({ id: "a", visits: 5, totalValue: 4.0, parent })
      // Child B: low exploitation, few visits (high exploration bonus)
      const childB = makeNode({ id: "b", visits: 1, totalValue: 0.3, parent })
      parent.children = [childA, childB]

      // UCB(A) = 4.0/5 + √2 * √(ln(10)/5) ≈ 0.8 + 0.96 ≈ 1.76
      // UCB(B) = 0.3/1 + √2 * √(ln(10)/1) ≈ 0.3 + 2.15 ≈ 2.45
      // B should win due to exploration bonus
      expect(selectUCB1(parent)).toBe(childB)
    })
  })

  // ── selectLeaf ────────────────────────────────────────────────────────────

  describe("selectLeaf", () => {
    it("returns root when it has no children", () => {
      const root = makeNode({ id: "root" })
      expect(selectLeaf(root)).toBe(root)
    })

    it("descends to a leaf node", () => {
      const root = makeNode({ id: "r", visits: 10 })
      const child = makeNode({ id: "c", visits: 5, totalValue: 2, parent: root })
      const leaf = makeNode({ id: "l", visits: 0, parent: child })
      root.children = [child]
      child.children = [leaf]

      expect(selectLeaf(root)).toBe(leaf)
    })
  })

  // ── backpropagate ─────────────────────────────────────────────────────────

  describe("backpropagate", () => {
    it("increments visits from leaf to root", () => {
      const root = makeNode({ id: "r" })
      const mid = makeNode({ id: "m", depth: 1, parent: root })
      const leaf = makeNode({ id: "l", depth: 2, parent: mid })
      root.children = [mid]
      mid.children = [leaf]

      backpropagate(leaf, 0.8)

      expect(leaf.visits).toBe(1)
      expect(mid.visits).toBe(1)
      expect(root.visits).toBe(1)
    })

    it("applies discount factor up the tree", () => {
      const root = makeNode({ id: "r" })
      const mid = makeNode({ id: "m", depth: 1, parent: root })
      const leaf = makeNode({ id: "l", depth: 2, parent: mid })
      root.children = [mid]
      mid.children = [leaf]

      const value = 1.0
      backpropagate(leaf, value)

      expect(leaf.totalValue).toBeCloseTo(value, 5)
      expect(mid.totalValue).toBeCloseTo(value * GAMMA, 5)
      expect(root.totalValue).toBeCloseTo(value * GAMMA * GAMMA, 5)
    })

    it("accumulates over multiple backpropagations", () => {
      const root = makeNode({ id: "r" })
      const leaf = makeNode({ id: "l", depth: 1, parent: root })
      root.children = [leaf]

      backpropagate(leaf, 0.5)
      backpropagate(leaf, 0.8)

      expect(leaf.visits).toBe(2)
      expect(leaf.totalValue).toBeCloseTo(1.3, 5)
      expect(root.visits).toBe(2)
      expect(root.totalValue).toBeCloseTo((0.5 + 0.8) * GAMMA, 5)
    })
  })

  // ── extractBestPath ───────────────────────────────────────────────────────

  describe("extractBestPath", () => {
    it("returns only root for a tree with no children", () => {
      const root = makeNode({ id: "r" })
      const path = extractBestPath(root)
      expect(path).toEqual([root])
    })

    it("follows most-visited children", () => {
      const root = makeNode({ id: "r", visits: 10 })
      const a = makeNode({ id: "a", visits: 7, parent: root })
      const b = makeNode({ id: "b", visits: 3, parent: root })
      const a1 = makeNode({ id: "a1", visits: 5, parent: a })
      const a2 = makeNode({ id: "a2", visits: 2, parent: a })
      root.children = [a, b]
      a.children = [a1, a2]

      const path = extractBestPath(root)
      expect(path.map((n) => n.id)).toEqual(["r", "a", "a1"])
    })
  })

  // ── buildStateHistory ─────────────────────────────────────────────────────

  describe("buildStateHistory", () => {
    it("returns default text for root with no action", () => {
      const root = makeNode({ id: "r" })
      expect(buildStateHistory(root)).toBe("No actions taken yet.")
    })

    it("builds history from leaf to root", () => {
      const root = makeNode({ id: "r" })
      const action1: LATSAction = {
        description: "Search docs",
        reasoning: "Need info",
        observation: "Found answer",
        value: 0.8,
      }
      const child = makeNode({
        id: "c",
        depth: 1,
        parent: root,
        action: action1,
      })
      root.children = [child]

      const history = buildStateHistory(child)
      expect(history).toContain("Search docs")
      expect(history).toContain("Found answer")
    })
  })

  // ── parseActionArray ──────────────────────────────────────────────────────

  describe("parseActionArray", () => {
    it("parses valid JSON array", () => {
      const raw = JSON.stringify([
        { description: "action A", reasoning: "reason A" },
        { description: "action B", reasoning: "reason B" },
      ])
      const result = parseActionArray(raw, 5)
      expect(result).toHaveLength(2)
      expect(result[0].description).toBe("action A")
      expect(result[0].observation).toBe("")
      expect(result[0].value).toBe(0)
    })

    it("limits to k items", () => {
      const raw = JSON.stringify([
        { description: "a1", reasoning: "r1" },
        { description: "a2", reasoning: "r2" },
        { description: "a3", reasoning: "r3" },
      ])
      const result = parseActionArray(raw, 2)
      expect(result).toHaveLength(2)
    })

    it("parses JSON from markdown code blocks", () => {
      const raw = "```json\n" + JSON.stringify([
        { description: "fenced", reasoning: "yes" },
      ]) + "\n```"
      const result = parseActionArray(raw, 5)
      expect(result).toHaveLength(1)
      expect(result[0].description).toBe("fenced")
    })

    it("falls back to raw text when JSON is invalid", () => {
      const raw = "just do the thing basically"
      const result = parseActionArray(raw, 5)
      expect(result).toHaveLength(1)
      expect(result[0].description).toBe(raw)
      expect(result[0].reasoning).toBe("Parsed from raw")
    })

    it("filters out entries with empty description", () => {
      const raw = JSON.stringify([
        { description: "", reasoning: "skip me" },
        { description: "keep me", reasoning: "yes" },
      ])
      const result = parseActionArray(raw, 5)
      expect(result).toHaveLength(1)
      expect(result[0].description).toBe("keep me")
    })
  })
})
