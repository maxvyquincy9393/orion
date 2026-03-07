import { describe, expect, it } from "vitest"

import { HybridRetriever, __hybridRetrieverTestUtils } from "../hybrid-retriever.js"

describe("HybridRetriever helpers", () => {
  it("builds FTS queries from punctuation-heavy input without parser-hostile tokens", () => {
    const query = __hybridRetrieverTestUtils.buildFTSQuery(`"foo,bar" C++ error: disk/full ??? a io`)

    expect(query).toBe("foo* bar* error* disk* full* io*")
  })

  it("preserves meaningful short technical tokens and deduplicates them", () => {
    const query = __hybridRetrieverTestUtils.buildFTSQuery("Go js TS go  io bug ts")

    expect(query).toBe("go* js* ts* io* bug*")
  })

  it("normalizes invalid config values and keeps topK >= finalLimit", () => {
    const config = __hybridRetrieverTestUtils.normalizeHybridConfig({
      topK: 1,
      finalLimit: 99,
      ftsWeight: 0,
      vectorWeight: Number.NaN,
      scoreThreshold: 5,
      rrfK: -10,
    })

    expect(config.finalLimit).toBe(50)
    expect(config.topK).toBeGreaterThanOrEqual(config.finalLimit)
    expect(config.ftsWeight).toBeGreaterThan(0)
    expect(config.vectorWeight).toBeGreaterThan(0)
    expect(config.scoreThreshold).toBe(1)
    expect(config.rrfK).toBe(1)
  })

  it("applies normalized config in constructor and setConfig", () => {
    const retriever = new HybridRetriever({ ftsWeight: 0, finalLimit: 999 })
    retriever.setConfig({ vectorWeight: -1, topK: 2 })

    const config = retriever.getConfig()
    expect(config.finalLimit).toBe(50)
    expect(config.ftsWeight).toBeGreaterThan(0)
    expect(config.vectorWeight).toBeGreaterThan(0)
    expect(config.topK).toBeGreaterThanOrEqual(config.finalLimit)
  })

  it("exposes the short-token allowlist for test visibility", () => {
    expect(__hybridRetrieverTestUtils.SHORT_TECHNICAL_TOKENS.has("go")).toBe(true)
    expect(__hybridRetrieverTestUtils.SHORT_TECHNICAL_TOKENS.has("js")).toBe(true)
  })

  it("uses weighted standard RRF formula", () => {
    const score = __hybridRetrieverTestUtils.computeWeightedRRFScore(1, 0.6, 60)
    expect(score).toBeCloseTo(0.6 * (1 / 61))
  })

  it("scores lexical overlap for lightweight reranking", () => {
    const overlap = __hybridRetrieverTestUtils.computeOverlapScore(
      "optimize database query",
      "query optimization for database indexes",
    )

    expect(overlap).toBeGreaterThan(0)
    expect(overlap).toBeLessThanOrEqual(1)
  })
})
