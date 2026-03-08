/**
 * @file knowledge-section-chunker.test.ts
 * @description Unit tests for Phase 13 section-chunker.ts
 */

import { describe, it, expect } from "vitest"
import { SectionChunker, sectionChunker } from "../knowledge/section-chunker.js"
import { type ParsedDocument } from "../knowledge/format-handlers.js"

function makeDoc(overrides: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    text: "Default content",
    title: "Test Doc",
    structure: [{ content: "Default content", level: 0 }],
    metadata: { wordCount: 2 },
    ...overrides,
  }
}

describe("SectionChunker", () => {
  const chunker = new SectionChunker()

  it("returns empty array for empty document", () => {
    const doc = makeDoc({ text: "", structure: [{ content: "", level: 0 }] })
    const chunks = chunker.chunk(doc, "Empty")
    expect(chunks).toHaveLength(0)
  })

  it("returns one chunk for simple single-section doc", () => {
    const doc = makeDoc({ structure: [{ content: "Short text.", level: 0 }] })
    const chunks = chunker.chunk(doc, "Doc")
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe("Short text.")
  })

  it("sets contextPrefix correctly for titled section", () => {
    const doc = makeDoc({
      structure: [{ heading: "Introduction", content: "This is the intro.", level: 1 }],
    })
    const chunks = chunker.chunk(doc, "My Doc")
    expect(chunks[0].contextPrefix).toBe("From: My Doc > Introduction")
  })

  it("sets contextPrefix without section for untitled section", () => {
    const doc = makeDoc({ structure: [{ content: "Plain content.", level: 0 }] })
    const chunks = chunker.chunk(doc, "My Doc")
    expect(chunks[0].contextPrefix).toBe("From: My Doc")
  })

  it("produces multiple chunks for multi-section doc", () => {
    const doc = makeDoc({
      structure: [
        { heading: "Sec 1", content: "Content 1", level: 1 },
        { heading: "Sec 2", content: "Content 2", level: 1 },
      ],
    })
    const chunks = chunker.chunk(doc, "Doc")
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })

  it("assigns correct chunkIndex and totalChunks", () => {
    const doc = makeDoc({
      structure: [
        { heading: "A", content: "Content A", level: 1 },
        { heading: "B", content: "Content B", level: 1 },
      ],
    })
    const chunks = chunker.chunk(doc, "Doc")
    chunks.forEach((c, i) => {
      expect(c.chunkIndex).toBe(i)
      expect(c.totalChunks).toBe(chunks.length)
    })
  })

  it("estimateTokens returns ceiling of length/4", () => {
    expect(chunker.estimateTokens("test")).toBe(1)
    expect(chunker.estimateTokens("a".repeat(8))).toBe(2)
    expect(chunker.estimateTokens("a".repeat(9))).toBe(3)
  })

  it("falls back to sliding window for structureless doc", () => {
    const longText = "word ".repeat(3000).trim()
    const doc = makeDoc({ text: longText, structure: [] })
    const chunks = chunker.chunk(doc, "Long Doc")
    expect(chunks.length).toBeGreaterThan(1)
  })

  it("singleton is the same class instance", () => {
    expect(sectionChunker).toBeInstanceOf(SectionChunker)
  })
})
