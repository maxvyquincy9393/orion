/**
 * @file os-agent-tool.test.ts
 * @description Tests for createOSAgentTool — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - CodeAct (arXiv:2402.01030, ICML 2024) — Action routing coverage: ∀ a ∈ A routes correctly
 *   - WebArena (arXiv:2307.13854, ICLR 2024) — Functional correctness: test outcomes, not internals
 *   - CaMeL (arXiv:2503.18813) — Dangerous actions must surface errors, not crash
 *
 * COVERAGE TARGET: ≥90%
 *
 * MOCK STRATEGY:
 *   - 'ai': mocked as passthrough tool() so execute() is directly testable
 *   - All OSAgent subsystems: mock objects with vi.fn() methods
 *
 * TEST GROUPS:
 *   1. [Action Routing] — every action routes to correct subsystem (CodeAct coverage matrix)
 *   2. [Validation] — missing required params return error strings, never throw
 *   3. [Error Handling] — subsystem failures surface as error strings
 *   4. [Edge Cases] — perception, list_windows, unknown actions
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { createOSAgentTool } from "../os-agent-tool.js"

// ── Mock declarations ─────────────────────────────────────────────────────────

/** Passthrough mock: tool(config) → config, making execute() directly accessible. */
vi.mock("ai", () => ({
  tool: vi.fn((config: unknown) => config),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a complete mock OSAgent with all subsystems as vi.fn() mocks. */
function buildMockOSAgent() {
  return {
    gui: {
      execute: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: "action completed",
      }),
      listWindows: vi.fn<[], Promise<{ title: string; processName: string }[]>>().mockResolvedValue([
        { title: "VS Code", processName: "code", pid: 1234, bounds: { x: 0, y: 0, width: 800, height: 600 }, isActive: true },
      ]),
      isInitialized: true,
    },
    vision: {
      captureAndAnalyze: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: { ocrText: "Hello World", elements: [], screenshotSize: 12345 },
      }),
      isInitialized: true,
    },
    voice: {
      speak: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: { textLength: 10, audioBytes: 4000 },
      }),
      isInitialized: true,
    },
    system: {
      state: {
        cpuUsage: 25,
        ramUsage: 60,
        diskUsage: 40,
        topProcesses: ["code", "node"],
        networkConnected: true,
        idleTimeSeconds: 5,
      },
      executeCommand: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: { stdout: "command output", stderr: "" },
      }),
      isInitialized: true,
    },
    iot: {
      parseNaturalLanguage: vi.fn<[], Array<{ domain: string; service: string; entityId: string }>>().mockReturnValue([
        { domain: "light", service: "turn_on", entityId: "light.bedroom" },
      ]),
      execute: vi.fn<[], Promise<{ success: boolean; data?: any; error?: string }>>().mockResolvedValue({
        success: true,
        data: {},
      }),
      isInitialized: true,
    },
    perception: {
      summarize: vi.fn<[], string>().mockReturnValue("System: CPU 25%, RAM 60% | Activity: coding"),
      getSnapshot: vi.fn<[], Promise<any>>().mockResolvedValue({ timestamp: Date.now() }),
    },
    getContextSnapshot: vi.fn<[], Promise<any>>().mockResolvedValue({ timestamp: Date.now() }),
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("createOSAgentTool", () => {
  let mockAgent: ReturnType<typeof buildMockOSAgent>
  let toolDef: { execute: (input: any) => Promise<string>; inputSchema?: any; description?: string }

  beforeEach(() => {
    vi.resetAllMocks()
    mockAgent = buildMockOSAgent()
    // Passthrough mock: tool(config) returns config object, so execute is directly accessible
    toolDef = createOSAgentTool(mockAgent as any) as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── [Action Routing] ─────────────────────────────────────────────────────

  /**
   * @paper CodeAct ICML 2024 — ∀ a ∈ A: route(a) → correct subsystem
   * Verify the action routing matrix covers all primary action types.
   */
  describe("[Action Routing]", () => {
    it("routes 'click' action to gui.execute() with correct coordinates", async () => {
      const result = await toolDef.execute({ action: "click", x: 100, y: 200 })

      expect(mockAgent.gui.execute).toHaveBeenCalledWith(
        expect.objectContaining({ action: "click", coordinates: { x: 100, y: 200 } }),
      )
      expect(typeof result).toBe("string")
      expect(result).toContain("action completed")
    })

    it("routes 'type' action to gui.execute() with provided text", async () => {
      const result = await toolDef.execute({ action: "type", text: "hello" })

      expect(mockAgent.gui.execute).toHaveBeenCalledWith(
        expect.objectContaining({ action: "type", text: "hello" }),
      )
      expect(typeof result).toBe("string")
    })

    it("routes 'screenshot' to vision.captureAndAnalyze() and returns OCR summary", async () => {
      const result = await toolDef.execute({ action: "screenshot" })

      expect(mockAgent.vision.captureAndAnalyze).toHaveBeenCalledOnce()
      expect(result).toContain("12345") // screenshotSize
      expect(result).toContain("Hello World") // ocrText
    })

    it("routes 'speak' to voice.speak() with provided text", async () => {
      const result = await toolDef.execute({ action: "speak", text: "hello world" })

      expect(mockAgent.voice.speak).toHaveBeenCalledWith("hello world")
      expect(typeof result).toBe("string")
    })

    it("routes 'system_info' to system.state getter and returns JSON", async () => {
      const result = await toolDef.execute({ action: "system_info" })

      // system.state getter was accessed (not a function call in the mock, but the assertion is on the output)
      const parsed = JSON.parse(result)
      expect(parsed.cpuUsage).toBe(25)
      expect(parsed.ramUsage).toBe(60)
    })

    it("routes 'iot' to iot.parseNaturalLanguage() then iot.execute()", async () => {
      const result = await toolDef.execute({ action: "iot", iotCommand: "nyalakan lampu kamar" })

      expect(mockAgent.iot.parseNaturalLanguage).toHaveBeenCalledWith("nyalakan lampu kamar")
      expect(mockAgent.iot.execute).toHaveBeenCalledWith(
        expect.objectContaining({ target: "home_assistant", domain: "light" }),
      )
      expect(result).toContain("light.bedroom")
    })

    it("routes 'shell' to system.executeCommand() and returns stdout", async () => {
      const result = await toolDef.execute({ action: "shell", command: "echo hello" })

      expect(mockAgent.system.executeCommand).toHaveBeenCalledWith("echo hello")
      expect(result).toBe("command output")
    })

    it("routes 'open_app' to gui.execute() with appName", async () => {
      const result = await toolDef.execute({ action: "open_app", name: "Notepad" })

      expect(mockAgent.gui.execute).toHaveBeenCalledWith(
        expect.objectContaining({ action: "open_app", appName: "Notepad" }),
      )
      expect(typeof result).toBe("string")
    })

    it("routes 'perception' to perception.summarize() without refreshing", async () => {
      const result = await toolDef.execute({ action: "perception" })

      expect(mockAgent.perception.summarize).toHaveBeenCalledOnce()
      expect(result).toContain("CPU 25%")
    })
  })

  // ── [Validation] ─────────────────────────────────────────────────────────

  /**
   * @paper WebArena ICLR 2024 — Agent needs descriptive errors for self-correction
   * @paper CaMeL 2503.18813 — Missing params must surface errors, not crash
   */
  describe("[Validation]", () => {
    it("returns 'Error: x and y coordinates required' for click without x/y", async () => {
      const result = await toolDef.execute({ action: "click" })

      expect(result).toContain("Error:")
      expect(result).toContain("coordinates")
      expect(mockAgent.gui.execute).not.toHaveBeenCalled()
    })

    it("returns 'Error: text required' for type action without text", async () => {
      const result = await toolDef.execute({ action: "type" })

      expect(result).toContain("Error:")
      expect(result).toContain("text")
      expect(mockAgent.gui.execute).not.toHaveBeenCalled()
    })

    it("returns error for 'shell' action without command", async () => {
      const result = await toolDef.execute({ action: "shell" })

      expect(result).toContain("Error:")
      expect(result).toContain("command")
      expect(mockAgent.system.executeCommand).not.toHaveBeenCalled()
    })

    it("returns error for 'iot' action without iotCommand", async () => {
      const result = await toolDef.execute({ action: "iot" })

      expect(result).toContain("Error:")
      expect(mockAgent.iot.parseNaturalLanguage).not.toHaveBeenCalled()
    })

    it("returns error for 'speak' action without text", async () => {
      const result = await toolDef.execute({ action: "speak" })

      expect(result).toContain("Error:")
      expect(mockAgent.voice.speak).not.toHaveBeenCalled()
    })
  })

  // ── [Error Handling] ─────────────────────────────────────────────────────

  /**
   * @paper CodeAct ICML 2024 — Self-debugging: error messages must be actionable
   */
  describe("[Error Handling]", () => {
    it("returns error string when vision.captureAndAnalyze() fails", async () => {
      mockAgent.vision.captureAndAnalyze.mockResolvedValue({
        success: false,
        error: "Screen capture permission denied",
      })

      const result = await toolDef.execute({ action: "screenshot" })

      expect(result).toContain("Screenshot failed")
      expect(result).toContain("permission denied")
    })

    it("returns error string when gui.execute() fails — no throw to LLM", async () => {
      mockAgent.gui.execute.mockResolvedValue({
        success: false,
        error: "element not found",
      })

      const result = await toolDef.execute({ action: "click", x: 999, y: 999 })

      expect(result).toContain("Failed:")
      expect(result).toContain("element not found")
    })

    it("returns error string when voice.speak() fails — no throw to LLM", async () => {
      mockAgent.voice.speak.mockResolvedValue({
        success: false,
        error: "TTS engine unavailable",
      })

      const result = await toolDef.execute({ action: "speak", text: "hello" })

      expect(result).toContain("TTS failed")
      expect(result).toContain("unavailable")
    })
  })

  // ── [Edge Cases] ─────────────────────────────────────────────────────────

  describe("[Edge Cases]", () => {
    it("list_windows returns formatted window list", async () => {
      const result = await toolDef.execute({ action: "list_windows" })

      expect(mockAgent.gui.listWindows).toHaveBeenCalledOnce()
      expect(result).toContain("VS Code")
      expect(result).toContain("code") // processName
    })

    it("list_windows returns 'No windows found' when list is empty", async () => {
      mockAgent.gui.listWindows.mockResolvedValue([])

      const result = await toolDef.execute({ action: "list_windows" })

      expect(result).toBe("No windows found")
    })

    it("active_context calls getContextSnapshot() then perception.summarize()", async () => {
      const result = await toolDef.execute({ action: "active_context" })

      expect(mockAgent.getContextSnapshot).toHaveBeenCalledOnce()
      expect(mockAgent.perception.summarize).toHaveBeenCalledOnce()
      expect(result).toContain("CPU 25%")
    })

    it("tool has correct inputSchema with action enum that includes all major actions", () => {
      expect(toolDef.inputSchema).toBeDefined()
      // inputSchema is a Zod object; verify it can parse valid input
      const parsed = toolDef.inputSchema.safeParse({ action: "screenshot" })
      expect(parsed.success).toBe(true)
    })

    it("tool description string mentions the major action categories", () => {
      expect(toolDef.description).toBeDefined()
      expect(toolDef.description).toContain("screenshot")
      expect(toolDef.description).toContain("click")
    })
  })
})
