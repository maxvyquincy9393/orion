import { describe, expect, it, vi } from "vitest"

import { reflexionLoop, __reflexionTestUtils } from "../reflexion.js"

const { ACCEPT_THRESHOLD, MAX_TRIALS, REFLECTION_WINDOW } = __reflexionTestUtils

describe("core/reflexion", () => {
  it("exports expected constants", () => {
    expect(MAX_TRIALS).toBe(3)
    expect(ACCEPT_THRESHOLD).toBe(0.75)
    expect(REFLECTION_WINDOW).toBe(5)
  })

  it("accepts immediately when evaluator scores above threshold", async () => {
    const actor = vi.fn().mockResolvedValue("good answer")
    const evaluator = vi.fn().mockResolvedValue({
      score: 0.9,
      passed: true,
      reasoning: "Excellent",
    })

    const result = await reflexionLoop("test task", actor, { evaluator })

    expect(result.passed).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.output).toBe("good answer")
    expect(actor).toHaveBeenCalledTimes(1)
  })

  it("retries with reflection when evaluator rejects first attempt", async () => {
    let callCount = 0
    const actor = vi.fn().mockImplementation(async (prompt: string) => {
      callCount++
      if (callCount === 1) return "bad answer"
      // Second call should include reflection in prompt
      expect(prompt).toContain("[Self-Reflections")
      return "improved answer"
    })

    const evaluator = vi.fn()
      .mockResolvedValueOnce({ score: 0.3, passed: false, reasoning: "Too vague" })
      .mockResolvedValueOnce({ score: 0.9, passed: true, reasoning: "Good" })

    const result = await reflexionLoop("test task", actor, { evaluator })

    expect(result.passed).toBe(true)
    expect(result.attempts).toBe(2)
    expect(result.output).toBe("improved answer")
    expect(result.trials).toHaveLength(2)
    expect(result.trials[0].reflection).toBeTruthy()
  })

  it("returns best attempt when all trials fail", async () => {
    const actor = vi.fn()
      .mockResolvedValueOnce("attempt 1")
      .mockResolvedValueOnce("attempt 2")
      .mockResolvedValueOnce("attempt 3")

    const evaluator = vi.fn()
      .mockResolvedValueOnce({ score: 0.2, passed: false, reasoning: "Bad" })
      .mockResolvedValueOnce({ score: 0.5, passed: false, reasoning: "OK" })
      .mockResolvedValueOnce({ score: 0.4, passed: false, reasoning: "Meh" })

    const result = await reflexionLoop("test task", actor, {
      evaluator,
      maxTrials: 3,
    })

    expect(result.passed).toBe(false)
    expect(result.attempts).toBe(3)
    // Should return the highest-scored attempt (0.5)
    expect(result.output).toBe("attempt 2")
    expect(result.trials).toHaveLength(3)
  })

  it("respects custom maxTrials", async () => {
    const actor = vi.fn().mockResolvedValue("answer")
    const evaluator = vi.fn().mockResolvedValue({
      score: 0.2,
      passed: false,
      reasoning: "Nope",
    })

    const result = await reflexionLoop("test", actor, {
      evaluator,
      maxTrials: 1,
    })

    expect(result.attempts).toBe(1)
    expect(actor).toHaveBeenCalledTimes(1)
  })

  it("accumulates reflections across trials", async () => {
    const prompts: string[] = []
    const actor = vi.fn().mockImplementation(async (prompt: string) => {
      prompts.push(prompt)
      return "answer"
    })

    const evaluator = vi.fn()
      .mockResolvedValueOnce({ score: 0.2, passed: false, reasoning: "Bad" })
      .mockResolvedValueOnce({ score: 0.3, passed: false, reasoning: "Still bad" })
      .mockResolvedValueOnce({ score: 0.9, passed: true, reasoning: "Good" })

    await reflexionLoop("task", actor, { evaluator, maxTrials: 3 })

    // First attempt has no reflections
    expect(prompts[0]).not.toContain("Self-Reflections")
    // Second attempt should have 1 reflection
    expect(prompts[1]).toContain("Self-Reflections")
    // Third attempt should have 2 reflections
    expect(prompts[2]).toContain("Self-Reflections")
  })

  it("reflectionMemory contains joined reflections", async () => {
    const actor = vi.fn().mockResolvedValue("answer")
    const evaluator = vi.fn()
      .mockResolvedValueOnce({ score: 0.2, passed: false, reasoning: "Issue A" })
      .mockResolvedValueOnce({ score: 0.9, passed: true, reasoning: "Fixed" })

    const result = await reflexionLoop("task", actor, { evaluator })

    expect(result.reflectionMemory.length).toBeGreaterThan(0)
  })
})
