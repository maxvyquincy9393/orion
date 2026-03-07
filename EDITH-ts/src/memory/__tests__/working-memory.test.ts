import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { WorkingMemory, __workingMemoryTestUtils } from "../working-memory.js"

const { MAX_ENTRIES, MAX_ENTRY_CHARS, MAX_CONTEXT_CHARS } = __workingMemoryTestUtils

describe("memory/working-memory", () => {
  it("exports expected constants", () => {
    expect(MAX_ENTRIES).toBe(50)
    expect(MAX_ENTRY_CHARS).toBe(1000)
    expect(MAX_CONTEXT_CHARS).toBe(8000)
  })

  it("stores and retrieves entries by type", () => {
    const wm = new WorkingMemory("test-task", "test goal")

    wm.think("I should check the API first")
    wm.observe("API returned 404")
    wm.hypothesize("The endpoint might be deprecated")
    wm.storeFact("API v2 is available at /v2/resource")

    expect(wm.getByType("thought")).toHaveLength(1)
    expect(wm.getByType("observation")).toHaveLength(1)
    expect(wm.getByType("hypothesis")).toHaveLength(1)
    expect(wm.getByType("fact")).toHaveLength(1)
    expect(wm.size).toBe(4)
  })

  it("retrieves top relevant entries sorted by relevance", () => {
    const wm = new WorkingMemory("task")

    wm.add("thought", "low relevance", 0.1)
    wm.add("fact", "high relevance", 0.9)
    wm.add("observation", "medium relevance", 0.5)

    const top = wm.getTopRelevant(2)
    expect(top).toHaveLength(2)
    expect(top[0].relevance).toBe(0.9)
    expect(top[1].relevance).toBe(0.5)
  })

  it("returns recent entries in order", () => {
    const wm = new WorkingMemory("task")

    wm.think("first")
    wm.think("second")
    wm.think("third")

    const recent = wm.getRecent(2)
    expect(recent).toHaveLength(2)
    expect(recent[0].content).toBe("second")
    expect(recent[1].content).toBe("third")
  })

  it("searches entries by content", () => {
    const wm = new WorkingMemory("task")

    wm.think("The database connection failed")
    wm.think("User authentication works fine")
    wm.observe("Connection timeout after 5000ms")

    const results = wm.search("connection")
    expect(results).toHaveLength(2)
  })

  it("updates current plan", () => {
    const wm = new WorkingMemory("task")

    wm.plan("Step 1: check DB. Step 2: fix query.")
    expect(wm.currentPlan).toContain("Step 1")
  })

  it("tracks confidence level", () => {
    const wm = new WorkingMemory("task")
    expect(wm.confidence).toBe(0.5) // default

    wm.setConfidence(0.9)
    expect(wm.confidence).toBe(0.9)

    // Clamp to bounds
    wm.setConfidence(1.5)
    expect(wm.confidence).toBe(1)

    wm.setConfidence(-0.5)
    expect(wm.confidence).toBe(0)
  })

  it("evicts oldest entries when exceeding MAX_ENTRIES", () => {
    const wm = new WorkingMemory("task")

    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      wm.think(`thought ${i}`)
    }

    expect(wm.size).toBe(MAX_ENTRIES)
  })

  it("truncates entry content to MAX_ENTRY_CHARS", () => {
    const wm = new WorkingMemory("task")
    const longContent = "x".repeat(MAX_ENTRY_CHARS + 100)

    const entry = wm.think(longContent)
    expect(entry.content.length).toBeLessThanOrEqual(MAX_ENTRY_CHARS)
  })

  it("generates structured context for LLM injection", () => {
    const wm = new WorkingMemory("task", "Find the bug")

    wm.plan("Check logs then trace the stack")
    wm.observe("Error in line 42 of parser.ts")
    wm.think("The parser might have a null check missing")

    const context = wm.toContext()
    expect(context).toContain("[Working Memory")
    expect(context).toContain("Find the bug")
    expect(context).toContain("Check logs")
  })

  it("returns empty context when no entries", () => {
    const wm = new WorkingMemory("task")
    expect(wm.toContext()).toBe("")
  })

  it("clears all state", () => {
    const wm = new WorkingMemory("task", "goal")
    wm.think("something")
    wm.setConfidence(0.9)
    wm.plan("a plan")

    wm.clear()
    expect(wm.size).toBe(0)
    expect(wm.currentGoal).toBe("")
    expect(wm.currentPlan).toBe("")
    expect(wm.confidence).toBe(0.5)
  })

  it("takes a snapshot for persistence", () => {
    const wm = new WorkingMemory("task-123", "goal")
    wm.think("a thought")
    wm.setConfidence(0.8)

    const snap = wm.snapshot()
    expect(snap.taskId).toBe("task-123")
    expect(snap.goal).toBe("goal")
    expect(snap.confidence).toBe(0.8)
    expect(snap.entries).toHaveLength(1)
  })

  it("persists state across restarts when persistence is enabled", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edith-working-"))

    try {
      const first = new WorkingMemory("task-persist", "stabilize release", {
        persist: true,
        stateDir,
      })
      first.think("check canary logs")
      first.plan("step1 validate logs")
      first.setConfidence(0.9)

      const second = new WorkingMemory("task-persist", undefined, {
        persist: true,
        stateDir,
      })

      expect(second.currentGoal).toBe("stabilize release")
      expect(second.currentPlan).toContain("validate logs")
      expect(second.confidence).toBe(0.9)
      expect(second.search("canary")).toHaveLength(1)
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
