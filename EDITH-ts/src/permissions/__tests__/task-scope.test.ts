import { describe, expect, it, beforeEach } from "vitest"

import {
  inferTaskType,
  getScopeForTask,
  isToolAllowed,
  applyTaskScope,
  type TaskScope,
} from "../task-scope.js"

// ─────────────────────────────────────────────────────────────────────────────
// inferTaskType
// ─────────────────────────────────────────────────────────────────────────────

describe("inferTaskType", () => {
  it("defaults to conversation for empty input", () => {
    expect(inferTaskType("")).toBe("conversation")
    expect(inferTaskType("  ")).toBe("conversation")
  })

  it("infers conversation for general chat", () => {
    expect(inferTaskType("How are you today?")).toBe("conversation")
    expect(inferTaskType("Tell me a joke")).toBe("conversation")
  })

  it("infers coding for programming-related messages", () => {
    expect(inferTaskType("Fix the bug in my TypeScript code")).toBe("coding")
    expect(inferTaskType("Refactor the module")).toBe("coding")
    expect(inferTaskType("Write a Python script")).toBe("coding")
    expect(inferTaskType("Run the build command")).toBe("coding")
    expect(inferTaskType("Run a terminal command")).toBe("coding")
  })

  it("infers research for investigation messages", () => {
    expect(inferTaskType("Research the latest AI papers")).toBe("research")
    expect(inferTaskType("Compare these two frameworks")).toBe("research")
    expect(inferTaskType("Search for information about quantum computing")).toBe("research")
  })

  it("infers system for admin/infrastructure messages", () => {
    expect(inferTaskType("Deploy the application to production")).toBe("system")
    expect(inferTaskType("Restart the daemon service")).toBe("system")
    expect(inferTaskType("Check the security policy")).toBe("system")
    expect(inferTaskType("Update the access control permissions")).toBe("system")
  })

  it("picks highest-priority match (system > coding > research)", () => {
    // "deploy" matches system; "code" matches coding
    expect(inferTaskType("Deploy my code")).toBe("system")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getScopeForTask
// ─────────────────────────────────────────────────────────────────────────────

describe("getScopeForTask", () => {
  it("returns correct scope for conversation", () => {
    const scope = getScopeForTask("conversation")
    expect(scope.taskType).toBe("conversation")
    expect(scope.requiresExplicitApproval).toBe(false)
    expect(scope.allowedTools).toContain("searchTool")
    expect(scope.allowedTools).not.toContain("terminalTool")
  })

  it("returns correct scope for coding", () => {
    const scope = getScopeForTask("coding")
    expect(scope.taskType).toBe("coding")
    expect(scope.allowedTools).toContain("terminalTool")
    expect(scope.allowedTools).toContain("fileWriteTool")
  })

  it("returns correct scope for system", () => {
    const scope = getScopeForTask("system")
    expect(scope.taskType).toBe("system")
    expect(scope.requiresExplicitApproval).toBe(true)
    expect(scope.allowedTools).toContain("calendarTool")
  })

  it("returns a copy (not a reference to internal state)", () => {
    const scope1 = getScopeForTask("conversation")
    const scope2 = getScopeForTask("conversation")
    scope1.allowedTools.push("customTool")
    expect(scope2.allowedTools).not.toContain("customTool")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isToolAllowed
// ─────────────────────────────────────────────────────────────────────────────

describe("isToolAllowed", () => {
  it("returns true for tools in the scope", () => {
    const scope = getScopeForTask("coding")
    expect(isToolAllowed(scope, "fileReadTool")).toBe(true)
    expect(isToolAllowed(scope, "terminalTool")).toBe(true)
  })

  it("returns false for tools not in the scope", () => {
    const scope = getScopeForTask("conversation")
    expect(isToolAllowed(scope, "terminalTool")).toBe(false)
    expect(isToolAllowed(scope, "fileWriteTool")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyTaskScope
// ─────────────────────────────────────────────────────────────────────────────

describe("applyTaskScope", () => {
  const allTools: Record<string, unknown> = {
    searchTool: { execute: () => "search" },
    memoryQueryTool: { execute: () => "memory" },
    fileReadTool: { execute: () => "read" },
    fileWriteTool: { execute: () => "write" },
    terminalTool: { execute: () => "terminal" },
    read_skill: { execute: () => "skill" },
  }

  it("filters tools based on conversation scope", () => {
    const scope = getScopeForTask("conversation")
    const result = applyTaskScope(allTools, scope)

    expect(result.approvalRequired).toBe(false)
    expect(Object.keys(result.tools)).toContain("searchTool")
    expect(Object.keys(result.tools)).not.toContain("terminalTool")
    expect(result.blockedTools).toContain("terminalTool")
    expect(result.blockedTools).toContain("fileWriteTool")
  })

  it("allows more tools for coding scope", () => {
    const scope = getScopeForTask("coding")
    const result = applyTaskScope(allTools, scope)

    expect(Object.keys(result.tools)).toContain("terminalTool")
    expect(Object.keys(result.tools)).toContain("fileWriteTool")
    expect(result.approvalRequired).toBe(false)
  })

  it("blocks all tools for system scope without approval", () => {
    const scope = getScopeForTask("system")
    const result = applyTaskScope(allTools, scope, { explicitApproval: false })

    expect(result.approvalRequired).toBe(true)
    expect(Object.keys(result.tools)).toHaveLength(0)
    expect(result.blockedTools).toHaveLength(Object.keys(allTools).length)
  })

  it("allows system scope tools with explicit approval", () => {
    const scope = getScopeForTask("system")
    const result = applyTaskScope(allTools, scope, { explicitApproval: true })

    expect(result.approvalRequired).toBe(false)
    expect(Object.keys(result.tools).length).toBeGreaterThan(0)
  })
})
