import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { EpisodicMemory, __episodicTestUtils } from "../episodic.js"

const {
  computeRecency,
  computeTextRelevance,
  tokenize,
  MAX_EPISODES,
  RECENCY_HALF_LIFE_MS,
} = __episodicTestUtils

describe("memory/episodic", () => {
  describe("core operations", () => {
    it("records and retrieves episodes", () => {
      const mem = new EpisodicMemory()

      mem.record({
        userId: "u1",
        task: "deploy the application",
        approach: "used docker compose",
        toolsUsed: ["terminal", "docker"],
        outcome: "success",
        result: "App deployed successfully",
        lesson: "Always check .env before deploying",
        tags: ["deploy", "docker"],
      })

      expect(mem.size).toBe(1)

      const results = mem.retrieve({ userId: "u1", query: "deploy" })
      expect(results.length).toBe(1)
      expect(results[0].episode.outcome).toBe("success")
    })

    it("retrieves failure lessons for similar tasks", () => {
      const mem = new EpisodicMemory()

      mem.record({
        userId: "u1",
        task: "deploy to production",
        approach: "direct push",
        outcome: "failure",
        result: "Crashed at runtime",
        lesson: "Always run tests before deploying",
      })

      mem.record({
        userId: "u1",
        task: "deploy to staging",
        approach: "CI/CD pipeline",
        outcome: "success",
        result: "Deployed cleanly",
        lesson: "CI catches issues early",
      })

      const lessons = mem.getFailureLessons("u1", "deploy the new version")
      expect(lessons.length).toBe(1)
      expect(lessons[0]).toContain("Always run tests")
    })

    it("retrieves success patterns for similar tasks", () => {
      const mem = new EpisodicMemory()

      mem.record({
        userId: "u1",
        task: "optimize database query",
        approach: "Added index on frequently-queried column",
        outcome: "success",
        result: "Query time reduced from 2s to 50ms",
        lesson: "Check EXPLAIN output first",
      })

      const patterns = mem.getSuccessPatterns("u1", "database query is slow")
      expect(patterns.length).toBe(1)
      expect(patterns[0]).toContain("Added index")
    })

    it("filters by outcome type", () => {
      const mem = new EpisodicMemory()

      mem.record({ userId: "u1", task: "task A", approach: "a", outcome: "success", result: "ok", lesson: "l" })
      mem.record({ userId: "u1", task: "task B", approach: "b", outcome: "failure", result: "err", lesson: "l" })
      mem.record({ userId: "u1", task: "task C", approach: "c", outcome: "partial", result: "meh", lesson: "l" })

      const failures = mem.retrieve({ userId: "u1", outcome: "failure" })
      expect(failures.length).toBe(1)
      expect(failures[0].episode.task).toBe("task B")
    })

    it("filters by tags", () => {
      const mem = new EpisodicMemory()

      mem.record({ userId: "u1", task: "t1", approach: "a", outcome: "success", result: "r", lesson: "l", tags: ["python", "ml"] })
      mem.record({ userId: "u1", task: "t2", approach: "a", outcome: "success", result: "r", lesson: "l", tags: ["typescript"] })

      const results = mem.retrieve({ tags: ["ml"] })
      expect(results.length).toBe(1)
      expect(results[0].episode.task).toBe("t1")
    })

    it("generates context for LLM injection", () => {
      const mem = new EpisodicMemory()

      mem.record({
        userId: "u1",
        task: "fix login bug",
        approach: "Checked auth middleware",
        outcome: "success",
        result: "Fixed token validation",
        lesson: "Always check token expiry logic",
        tags: ["auth"],
      })

      const context = mem.toContext("u1", "authentication is broken")
      expect(context).toContain("[Episodic Memory")
      expect(context).toContain("fix login bug")
    })

    it("returns empty context when no relevant episodes", () => {
      const mem = new EpisodicMemory()
      const context = mem.toContext("u1", "something")
      expect(context).toBe("")
    })

    it("clears all episodes", () => {
      const mem = new EpisodicMemory()
      mem.record({ userId: "u1", task: "t", approach: "a", outcome: "success", result: "r", lesson: "l" })
      expect(mem.size).toBe(1)

      mem.clear()
      expect(mem.size).toBe(0)
    })

    it("persists episodes across restarts when persistence is enabled", () => {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edith-episodic-"))

      try {
        const first = new EpisodicMemory({ persist: true, stateDir })
        first.record({
          userId: "u1",
          task: "deploy payment service",
          approach: "blue-green",
          outcome: "success",
          result: "deployed",
          lesson: "run smoke test first",
          tags: ["deploy"],
        })

        const second = new EpisodicMemory({ persist: true, stateDir })
        const restored = second.retrieve({ userId: "u1", query: "payment deploy" })
        expect(restored).toHaveLength(1)
        expect(restored[0].episode.lesson).toContain("smoke test")
      } finally {
        fs.rmSync(stateDir, { recursive: true, force: true })
      }
    })
  })

  describe("importance scoring", () => {
    it("scores failures higher than successes (negativity bias)", () => {
      const mem = new EpisodicMemory()

      const fail = mem.record({ userId: "u1", task: "t", approach: "a", outcome: "failure", result: "r", lesson: "l" })
      const succ = mem.record({ userId: "u1", task: "t", approach: "a", outcome: "success", result: "r", lesson: "l" })

      expect(fail.importance).toBeGreaterThan(succ.importance)
    })

    it("scores high-stake tasks higher", () => {
      const mem = new EpisodicMemory()

      const normal = mem.record({ userId: "u1", task: "update readme", approach: "a", outcome: "success", result: "r", lesson: "l" })
      const critical = mem.record({ userId: "u1", task: "deploy to production", approach: "a", outcome: "success", result: "r", lesson: "l" })

      expect(critical.importance).toBeGreaterThan(normal.importance)
    })
  })

  describe("scoring utilities", () => {
    it("computeRecency returns 1.0 for just-accessed episodes", () => {
      const now = Date.now()
      const score = computeRecency(now, now)
      expect(score).toBeCloseTo(1.0, 5)
    })

    it("computeRecency returns ~0.5 after half-life period", () => {
      const now = Date.now()
      const score = computeRecency(now - RECENCY_HALF_LIFE_MS, now)
      expect(score).toBeCloseTo(0.5, 1)
    })

    it("computeRecency decays over time", () => {
      const now = Date.now()
      const recent = computeRecency(now - 1000, now)
      const old = computeRecency(now - RECENCY_HALF_LIFE_MS * 3, now)
      expect(recent).toBeGreaterThan(old)
    })

    it("computeTextRelevance returns higher score for matching text", () => {
      const episode = {
        task: "fix the database connection",
        approach: "checked connection string",
        lesson: "validate credentials first",
        tags: ["database", "connection"],
      }

      const high = computeTextRelevance("database connection error", episode as any)
      const low = computeTextRelevance("frontend styling issue", episode as any)

      expect(high).toBeGreaterThan(low)
    })

    it("tokenize produces lowercase tokens", () => {
      const tokens = tokenize("Hello World Test")
      expect(tokens).toEqual(["hello", "world", "test"])
    })

    it("tokenize filters short tokens", () => {
      const tokens = tokenize("I am a big developer")
      // "I", "am", "a" are <= 2 chars, should be filtered
      expect(tokens).toEqual(["big", "developer"])
    })
  })

  describe("eviction", () => {
    it("evicts low-importance episodes when exceeding MAX_EPISODES", () => {
      const mem = new EpisodicMemory()

      for (let i = 0; i < MAX_EPISODES + 10; i++) {
        mem.record({
          userId: "u1",
          task: `task ${i}`,
          approach: "a",
          outcome: "success",
          result: "r",
          lesson: "l",
        })
      }

      expect(mem.size).toBeLessThanOrEqual(MAX_EPISODES)
    })
  })
})
