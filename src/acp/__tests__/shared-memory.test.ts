/**
 * @file shared-memory.test.ts
 * @description Unit tests for SharedTaskMemory (Phase 11 Atom 0).
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  SharedTaskMemory,
  getOrCreateSession,
  clearSession,
  getActiveSessionCount,
} from "../shared-memory.js"

describe("SharedTaskMemory", () => {
  let memory: SharedTaskMemory

  beforeEach(() => {
    memory = new SharedTaskMemory("test-session")
  })

  describe("write / readFor", () => {
    it("shared entries are readable by any agent", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "finding 1", category: "finding", visibility: "shared" })

      const forAnalyst = memory.readFor("analyst")
      expect(forAnalyst).toHaveLength(1)
      expect(forAnalyst[0]!.content).toBe("finding 1")
    })

    it("private entries are NOT readable by other agents", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "private draft", category: "artifact", visibility: "private" })

      const forAnalyst = memory.readFor("analyst")
      expect(forAnalyst).toHaveLength(0)
    })

    it("private entries ARE readable by the writing agent", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "private draft", category: "artifact", visibility: "private" })

      const forResearcher = memory.readFor("researcher")
      expect(forResearcher).toHaveLength(1)
    })

    it("mixed visibility: agent reads shared + own private", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "shared finding", category: "finding", visibility: "shared" })
      memory.write({ agentType: "researcher", nodeId: "n1", content: "private note", category: "artifact", visibility: "private" })
      memory.write({ agentType: "coder", nodeId: "n2", content: "coder private", category: "artifact", visibility: "private" })

      const forResearcher = memory.readFor("researcher")
      expect(forResearcher).toHaveLength(2) // shared + own private
      expect(forResearcher.map((e) => e.content)).toContain("shared finding")
      expect(forResearcher.map((e) => e.content)).toContain("private note")
      expect(forResearcher.map((e) => e.content)).not.toContain("coder private")
    })
  })

  describe("readShared", () => {
    it("returns only shared entries", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "shared", category: "finding", visibility: "shared" })
      memory.write({ agentType: "analyst", nodeId: "n2", content: "private", category: "artifact", visibility: "private" })

      expect(memory.readShared()).toHaveLength(1)
      expect(memory.readShared()[0]!.visibility).toBe("shared")
    })
  })

  describe("buildContextFor", () => {
    it("returns empty string when no entries", () => {
      expect(memory.buildContextFor("researcher")).toBe("")
    })

    it("includes header and entries", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "some finding", category: "finding", visibility: "shared" })
      const ctx = memory.buildContextFor("analyst")
      expect(ctx).toContain("[Shared Task Context]")
      expect(ctx).toContain("some finding")
    })

    it("respects maxChars truncation", () => {
      const longContent = "A".repeat(2000)
      memory.write({ agentType: "researcher", nodeId: "n1", content: longContent, category: "finding", visibility: "shared" })
      memory.write({ agentType: "researcher", nodeId: "n2", content: longContent, category: "finding", visibility: "shared" })

      const ctx = memory.buildContextFor("analyst", 500)
      expect(ctx.length).toBeLessThanOrEqual(500 + 50) // small tolerance for header
    })
  })

  describe("buildSynthesisContext", () => {
    it("groups entries by category", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "research output", category: "finding", visibility: "shared" })
      memory.write({ agentType: "writer", nodeId: "n2", content: "final draft", category: "artifact", visibility: "shared" })

      const ctx = memory.buildSynthesisContext()
      expect(ctx).toContain("FINDING")
      expect(ctx).toContain("ARTIFACT")
    })
  })

  describe("clear", () => {
    it("removes all entries", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "data", category: "finding", visibility: "shared" })
      memory.clear()
      expect(memory.readAll()).toHaveLength(0)
    })
  })

  describe("stats", () => {
    it("returns accurate counts", () => {
      memory.write({ agentType: "researcher", nodeId: "n1", content: "finding", category: "finding", visibility: "shared" })
      memory.write({ agentType: "analyst", nodeId: "n2", content: "error", category: "error", visibility: "private" })

      const stats = memory.stats()
      expect(stats.total).toBe(2)
      expect(stats.shared).toBe(1)
      expect(stats.private).toBe(1)
      expect(stats.byCategory.finding).toBe(1)
      expect(stats.byCategory.error).toBe(1)
    })
  })
})

describe("session management", () => {
  it("getOrCreateSession creates a new session", () => {
    const id = `test-${Date.now()}`
    const session = getOrCreateSession(id)
    expect(session).toBeInstanceOf(SharedTaskMemory)
    expect(session.sessionId).toBe(id)
    clearSession(id)
  })

  it("getOrCreateSession returns existing session", () => {
    const id = `test-${Date.now()}`
    const s1 = getOrCreateSession(id)
    const s2 = getOrCreateSession(id)
    expect(s1).toBe(s2)
    clearSession(id)
  })

  it("clearSession removes the session from registry", () => {
    const id = `test-${Date.now()}`
    const before = getActiveSessionCount()
    getOrCreateSession(id)
    expect(getActiveSessionCount()).toBe(before + 1)
    clearSession(id)
    expect(getActiveSessionCount()).toBe(before)
  })
})
