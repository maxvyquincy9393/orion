/**
 * @file knowledge-citation-builder.test.ts
 * @description Unit tests for Phase 13 citation-builder.ts
 */

import { describe, it, expect } from "vitest"
import { CitationBuilder, citationBuilder, type CitedChunk } from "../knowledge/citation-builder.js"

function makeChunk(overrides: Partial<CitedChunk> = {}): CitedChunk {
  return {
    content: "Some content.",
    sourceName: "Test Doc",
    sourceFile: "/tmp/test.md",
    score: 0.8,
    ...overrides,
  }
}

describe("CitationBuilder", () => {
  const builder = new CitationBuilder()

  it("returns empty CitationResult for empty chunks", () => {
    const result = builder.build("query", [])
    expect(result.prompt).toBe("")
    expect(result.sources).toHaveLength(0)
    expect(result.shortCitation).toBe("")
  })

  it("sorts chunks by score descending", () => {
    const chunks = [
      makeChunk({ sourceName: "Low", score: 0.3 }),
      makeChunk({ sourceName: "High", score: 0.9 }),
      makeChunk({ sourceName: "Mid", score: 0.6 }),
    ]
    const result = builder.build("q", chunks)
    // sources are sorted descending
    expect(result.sources[0].sourceName).toBe("High")
    expect(result.sources[1].sourceName).toBe("Mid")
    expect(result.sources[2].sourceName).toBe("Low")
  })

  it("applies Lost-in-Middle ordering (best first, second-best last)", () => {
    const chunks = [
      makeChunk({ sourceName: "A", score: 0.9 }),
      makeChunk({ sourceName: "B", score: 0.8 }),
      makeChunk({ sourceName: "C", score: 0.7 }),
    ]
    const result = builder.build("q", chunks)
    // Prompt should start with A and end with B
    expect(result.prompt).toContain("[1] From: A")
    expect(result.prompt).toContain("[3] From: B")
  })

  it("includes page numbers in prompt when present", () => {
    const chunks = [makeChunk({ page: 5 })]
    const result = builder.build("q", chunks)
    expect(result.prompt).toContain("page 5")
  })

  it("includes shortCitation string", () => {
    const chunks = [
      makeChunk({ sourceName: "DocA", score: 0.9 }),
      makeChunk({ sourceName: "DocB", score: 0.7 }),
    ]
    const result = builder.build("q", chunks)
    expect(result.shortCitation).toContain("[1] DocA")
    expect(result.shortCitation).toContain("[2] DocB")
  })

  it("formatAnswer appends sources footer", () => {
    const chunks = [makeChunk({ sourceName: "Source1" })]
    const result = builder.build("q", chunks)
    const answer = builder.formatAnswer("The answer is X.", result)
    expect(answer).toContain("The answer is X.")
    expect(answer).toContain("Sources:")
    expect(answer).toContain("[1] Source1")
  })

  it("formatAnswer returns unchanged response when no sources", () => {
    const result = builder.build("q", [])
    const answer = builder.formatAnswer("No sources here.", result)
    expect(answer).toBe("No sources here.")
  })

  it("singleton is the same class instance", () => {
    expect(citationBuilder).toBeInstanceOf(CitationBuilder)
  })
})
