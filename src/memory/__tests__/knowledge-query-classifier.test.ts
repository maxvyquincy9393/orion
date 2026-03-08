/**
 * @file knowledge-query-classifier.test.ts
 * @description Unit tests for Phase 13 query-classifier.ts
 */

import { describe, it, expect } from "vitest"
import { QueryClassifier, queryClassifier } from "../knowledge/query-classifier.js"

describe("QueryClassifier", () => {
  const classifier = new QueryClassifier()

  it("classifies knowledge-seeking queries in English", () => {
    const result = classifier.classify("search my documents for TypeScript tips")
    expect(result.type).toBe("knowledge")
    expect(result.confidence).toBeGreaterThan(0)
  })

  it("classifies knowledge-seeking queries in Indonesian", () => {
    const result = classifier.classify("cari yang aku tulis soal machine learning")
    expect(result.type).toBe("knowledge")
    expect(result.confidence).toBeGreaterThan(0)
  })

  it("classifies summarize requests as knowledge", () => {
    const result = classifier.classify("summarize my notes on React")
    expect(result.type).toBe("knowledge")
  })

  it("classifies Obsidian vault references as knowledge", () => {
    const result = classifier.classify("cari dari obsidian vault gue tentang project X")
    expect(result.type).toBe("knowledge")
  })

  it("classifies plain chat as chat type", () => {
    const result = classifier.classify("Hey, how are you today?")
    expect(result.type).toBe("chat")
  })

  it("classifies action verbs as action type", () => {
    const result = classifier.classify("open Chrome and navigate to google.com")
    expect(result.type).toBe("action")
  })

  it("returns confidence between 0 and 1", () => {
    const queries = [
      "hello",
      "search my files for React hooks",
      "buka chrome",
      "ada yang gue simpan soal golang",
    ]
    for (const q of queries) {
      const result = classifier.classify(q)
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    }
  })

  it("singleton is the same class instance", () => {
    expect(queryClassifier).toBeInstanceOf(QueryClassifier)
  })
})
