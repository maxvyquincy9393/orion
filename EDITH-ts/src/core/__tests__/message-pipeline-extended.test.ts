import { describe, expect, it } from "vitest"

import { __pipelineTestUtils, PipelineAbortError } from "../message-pipeline.js"

const { classifyTaskType, emitPseudoStream } = __pipelineTestUtils

describe("classifyTaskType comprehensive", () => {
  // Code detection
  it("detects code-related keywords", () => {
    expect(classifyTaskType("refactor the function")).toBe("code")
    expect(classifyTaskType("debug this error")).toBe("code")
    expect(classifyTaskType("write a TypeScript class")).toBe("code")
    expect(classifyTaskType("fix this JavaScript bug")).toBe("code")
  })

  // Multimodal detection
  it("detects multimodal-related keywords", () => {
    expect(classifyTaskType("analyze this image")).toBe("multimodal")
    expect(classifyTaskType("look at this photo")).toBe("multimodal")
  })

  // Local keywords
  it("detects local model keywords", () => {
    expect(classifyTaskType("use local ollama model")).toBe("local")
  })

  // Reasoning detection (complex queries)
  it("detects reasoning-level complexity", () => {
    expect(classifyTaskType("why does this keep happening in production")).toBe("reasoning")
    expect(classifyTaskType("explain the tradeoffs between these two approaches and compare their long-term implications")).toBe("reasoning")
  })

  // Fast path
  it("classifies simple queries as fast", () => {
    expect(classifyTaskType("hi")).toBe("fast")
    expect(classifyTaskType("status?")).toBe("fast")
    expect(classifyTaskType("thanks")).toBe("fast")
    expect(classifyTaskType("ok")).toBe("fast")
  })

  // Edge cases
  it("returns fast for empty input", () => {
    expect(classifyTaskType("")).toBe("fast")
    expect(classifyTaskType("   ")).toBe("fast")
  })
})

describe("emitPseudoStream comprehensive", () => {
  it("streams content in chunks", async () => {
    const chunks: string[] = []
    await emitPseudoStream("hello world this is a test", async (chunk) => {
      chunks.push(chunk)
    })

    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks.join("")).toBe("hello world this is a test")
  })

  it("handles empty content gracefully", async () => {
    const chunks: string[] = []
    await emitPseudoStream("", async (chunk) => {
      chunks.push(chunk)
    })
    expect(chunks).toHaveLength(0)
  })

  it("handles whitespace-only content gracefully", async () => {
    const chunks: string[] = []
    await emitPseudoStream("   ", async (chunk) => {
      chunks.push(chunk)
    })
    expect(chunks).toHaveLength(0)
  })

  it("provides correct chunk index and total count", async () => {
    const indices: number[] = []
    const totals: number[] = []

    await emitPseudoStream("x".repeat(350), async (_chunk, index, total) => {
      indices.push(index)
      totals.push(total)
    })

    // Verify indices are sequential starting from 0
    expect(indices).toEqual(indices.map((_, i) => i))
    // Verify totals are consistent
    expect(new Set(totals).size).toBe(1)
    expect(totals[0]).toBe(indices.length)
  })

  it("aborts mid-stream when signal is raised", async () => {
    const controller = new AbortController()
    let called = 0

    const promise = emitPseudoStream(
      "x".repeat(800),
      async () => {
        called += 1
        if (called === 2) {
          controller.abort("user cancelled")
        }
      },
      controller.signal,
    )

    await expect(promise).rejects.toBeInstanceOf(PipelineAbortError)
    expect(called).toBeGreaterThanOrEqual(2)
  })

  it("respects already-aborted signal", async () => {
    const controller = new AbortController()
    controller.abort("pre-aborted")

    await expect(
      emitPseudoStream("hello world", async () => {}, controller.signal),
    ).rejects.toBeInstanceOf(PipelineAbortError)
  })

  it("handles very long content without error", async () => {
    const chunks: string[] = []
    const longContent = "abcdefghij".repeat(1000) // 10k chars

    await emitPseudoStream(longContent, async (chunk) => {
      chunks.push(chunk)
    })

    expect(chunks.join("")).toBe(longContent)
    expect(chunks.length).toBeGreaterThan(1)
  })
})
