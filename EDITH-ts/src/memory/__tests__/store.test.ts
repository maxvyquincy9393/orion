import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import config from "../../config.js"
import { MemoryStore, __memoryStoreTestUtils } from "../store.js"

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA <= 0 || normB <= 0) {
    return 0
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

describe("MemoryStore", () => {
  let originalFetch: typeof globalThis.fetch
  let originalOpenAiKey: string

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalOpenAiKey = config.OPENAI_API_KEY
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    config.OPENAI_API_KEY = originalOpenAiKey
    vi.restoreAllMocks()
  })

  it("embed falls back to OpenAI when Ollama embedding is unavailable", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = "test-key"

    const openAiVector = new Array(768).fill(0.123)
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/embeddings")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: openAiVector }] }),
      } as Response
    }) as typeof globalThis.fetch

    const vector = await store.embed("hello")

    expect(vector).toHaveLength(768)
    expect(vector[0]).toBe(0.123)
  })

  it("drops stale pending feedback on consume", () => {
    const store = new MemoryStore()
    const nowSpy = vi.spyOn(Date, "now")

    nowSpy.mockReturnValue(1_000)
    store.registerPendingFeedback("u1", ["m1"], 0.5)

    nowSpy.mockReturnValue(31 * 60 * 1000 + 1_000)
    const consumed = store.consumePendingFeedback("u1")

    expect(consumed).toBeNull()
  })

  it("fallback embedding preserves lexical proximity better than unrelated text", () => {
    const anchor = __memoryStoreTestUtils.hashToVector("deploy app to production pipeline")
    const near = __memoryStoreTestUtils.hashToVector("deploy application to production pipeline")
    const far = __memoryStoreTestUtils.hashToVector("buy groceries and cook dinner tonight")

    expect(cosineSimilarity(anchor, near)).toBeGreaterThan(cosineSimilarity(anchor, far))
  })

  it("embed caches repeated text to avoid duplicate provider calls", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = ""

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as Response) as typeof globalThis.fetch

    const first = await store.embed("cache me")
    const second = await store.embed("cache me")

    expect(first).toEqual(second)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it("tracks hash fallback embedding usage as a metric counter", async () => {
    const store = new MemoryStore()
    config.OPENAI_API_KEY = ""

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as Response) as typeof globalThis.fetch

    expect(store.getFallbackEmbeddingCount()).toBe(0)
    await store.embed("fallback count one")
    await store.embed("fallback count two")
    await store.embed("fallback count one")

    expect(store.getFallbackEmbeddingCount()).toBe(2)
  })
})
