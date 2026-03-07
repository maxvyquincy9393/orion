import { describe, expect, it, vi } from "vitest"

import { __pipelineTestUtils, PipelineAbortError } from "../message-pipeline.js"

describe("message-pipeline helpers", () => {
  it("classifies task type with pragmatic routing heuristics", () => {
    expect(__pipelineTestUtils.classifyTaskType("Please refactor this TypeScript function")).toBe("code")
    expect(__pipelineTestUtils.classifyTaskType("Analyze this image and explain it")).toBe("multimodal")
    expect(__pipelineTestUtils.classifyTaskType("Use local ollama model")).toBe("local")
    expect(__pipelineTestUtils.classifyTaskType("why does this keep happening in production")).toBe("reasoning")
    expect(__pipelineTestUtils.classifyTaskType("status?")).toBe("fast")
  })

  it("emits pseudo-stream chunks in deterministic order", async () => {
    const chunks: string[] = []
    await __pipelineTestUtils.emitPseudoStream("x".repeat(350), async (chunk) => {
      chunks.push(chunk)
    })

    expect(chunks.length).toBe(3)
    expect(chunks.join("")).toBe("x".repeat(350))
  })

  it("stops pseudo-streaming when abort signal is raised", async () => {
    const controller = new AbortController()
    let calls = 0

    await expect(__pipelineTestUtils.emitPseudoStream(
      "x".repeat(400),
      async () => {
        calls += 1
        if (calls === 1) {
          controller.abort("cancel now")
        }
      },
      controller.signal,
    )).rejects.toBeInstanceOf(PipelineAbortError)
  })
})

