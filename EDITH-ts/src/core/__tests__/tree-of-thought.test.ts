import { describe, expect, it } from "vitest"

import { __totTestUtils } from "../tree-of-thought.js"

const {
  parseThoughtArray,
  DEFAULT_BRANCHING_FACTOR,
  DEFAULT_MAX_DEPTH,
  DEFAULT_BEAM_WIDTH,
  DFS_PRUNE_THRESHOLD,
} = __totTestUtils

describe("core/tree-of-thought", () => {
  it("exports expected constants", () => {
    expect(DEFAULT_BRANCHING_FACTOR).toBe(3)
    expect(DEFAULT_MAX_DEPTH).toBe(3)
    expect(DEFAULT_BEAM_WIDTH).toBe(2)
    expect(DFS_PRUNE_THRESHOLD).toBe(0.3)
  })

  describe("parseThoughtArray", () => {
    it("parses valid JSON array", () => {
      const raw = '["thought 1", "thought 2", "thought 3"]'
      const result = parseThoughtArray(raw, 3)
      expect(result).toEqual(["thought 1", "thought 2", "thought 3"])
    })

    it("respects k limit", () => {
      const raw = '["a", "b", "c", "d"]'
      const result = parseThoughtArray(raw, 2)
      expect(result).toHaveLength(2)
    })

    it("parses JSON from markdown code block", () => {
      const raw = '```json\n["idea 1", "idea 2"]\n```'
      const result = parseThoughtArray(raw, 3)
      expect(result).toEqual(["idea 1", "idea 2"])
    })

    it("falls back to line splitting for non-JSON", () => {
      const raw = "1. First approach to solve\n2. Alternative approach here\n3. Third idea about this"
      const result = parseThoughtArray(raw, 3)
      expect(result.length).toBeGreaterThan(0)
      // Each line should be cleaned of numbering
      expect(result[0]).not.toMatch(/^\d+\./)
    })

    it("handles empty strings by returning raw as fallback", () => {
      const result = parseThoughtArray("short", 3)
      expect(result).toHaveLength(1)
      expect(result[0]).toBe("short")
    })

    it("filters empty strings from array", () => {
      const raw = '["valid", "", "also valid"]'
      const result = parseThoughtArray(raw, 3)
      expect(result).toEqual(["valid", "also valid"])
    })
  })

  describe("tracePath", () => {
    it("traces path from root to target", () => {
      const { tracePath } = __totTestUtils

      type TNode = {
        id: string; depth: number; thought: string; score: number;
        parentId: string | null; children: TNode[]; isTerminal: boolean
      }

      const root: TNode = {
        id: "root", depth: 0, thought: "", score: 1,
        parentId: null, children: [], isTerminal: false,
      }

      const child1: TNode = {
        id: "c1", depth: 1, thought: "step 1", score: 0.8,
        parentId: "root", children: [], isTerminal: false,
      }

      const child2: TNode = {
        id: "c2", depth: 2, thought: "step 2", score: 0.9,
        parentId: "c1", children: [], isTerminal: true,
      }

      root.children = [child1]
      child1.children = [child2]

      const path = tracePath(root, child2)
      expect(path).toHaveLength(3)
      expect(path[0].id).toBe("root")
      expect(path[1].id).toBe("c1")
      expect(path[2].id).toBe("c2")
    })
  })
})
