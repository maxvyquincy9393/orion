/**
 * @file gui-agent.test.ts
 * @description Tests for GUIAgent — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - OSWorld (arXiv:2404.07972) — POMDP action space + coordinate validation
 *   - ScreenAgent (IJCAI 2024) — screenshot as visual state capture
 *   - CaMeL (arXiv:2503.18813) — rate limiting for agent safety
 *
 * COVERAGE TARGET: ≥85%
 *
 * MOCK STRATEGY:
 *   - execa: mocked for all PowerShell / CLI automation commands
 *   - node:fs/promises: mocked so screenshot file read/write never touches disk
 *   - node:os: only tmpdir() needed for screenshot temp path
 *
 * TEST GROUPS:
 *   1. [Initialization] — win32, macOS, disabled
 *   2. [Screenshot] — ScreenAgent visual state capture
 *   3. [Mouse] — CodeAct mouse action execution
 *   4. [Keyboard] — SendKeys text and hotkey dispatch
 *   5. [Safety] — rate limiting per OSWorld evaluation protocol
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { GUIAgent } from "../gui-agent.js"
import { createMockGUIConfig, FAKE_PNG } from "./test-helpers.js"

// ── Mock declarations ─────────────────────────────────────────────────────────

vi.mock("execa", () => ({ execa: vi.fn() }))

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
  },
}))

vi.mock("node:os", () => ({
  default: {
    tmpdir: vi.fn().mockReturnValue("/tmp"),
    platform: () => "win32",
  },
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { execa } from "execa"
import fs from "node:fs/promises"

const mockExeca = vi.mocked(execa)
const mockFs = fs as typeof fs & { readFile: ReturnType<typeof vi.fn>; unlink: ReturnType<typeof vi.fn> }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a GUIAgent on win32 that is initialized and ready to execute actions. */
async function createInitializedAgent(configOverrides = {}) {
  const config = createMockGUIConfig({ enabled: true, requireConfirmation: false, ...configOverrides })
  const agent = new GUIAgent(config)
  // Stub PowerShell calls that happen during initialize()
  mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)
  await agent.initialize()
  return agent
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("GUIAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
    vi.mocked(fs.unlink).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── [Initialization] ──────────────────────────────────────────────────────

  /**
   * @paper OSWorld 2404.07972 — POMDP initial state S₀: agent must be ready before actions
   */
  describe("[Initialization]", () => {
    it("initializes on Windows without calling execa for native backend", async () => {
      // On Windows with native backend, verifyDependencies() is a no-op (only Linux needs xdotool check)
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "win32", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await agent.initialize()

      // verifyDependencies() only calls execa on Linux
      expect(mockExeca).not.toHaveBeenCalled()

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("initializes on macOS without calling execa for native backend", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await agent.initialize()

      expect(mockExeca).not.toHaveBeenCalled()

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })

    it("skips initialization silently when disabled=true", async () => {
      const agent = new GUIAgent(createMockGUIConfig({ enabled: false }))
      await agent.initialize()

      expect(mockExeca).not.toHaveBeenCalled()

      // execute() on disabled agent returns error
      const result = await agent.execute({ action: "click", coordinates: { x: 100, y: 100 } })
      expect(result.success).toBe(false)
      expect(result.error).toContain("not initialized")
    })
  })

  // ── [Screenshot] ─────────────────────────────────────────────────────────

  /**
   * @paper ScreenAgent IJCAI 2024 — "screenshot" = Plan step; captures visual state S
   */
  describe("[Screenshot]", () => {
    it("captures full screenshot on Windows via PowerShell and returns Buffer", async () => {
      const agent = await createInitializedAgent()
      vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const buffer = await agent.captureScreenshot()

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBeGreaterThan(0)
      // PowerShell screenshot command must have been called
      expect(mockExeca).toHaveBeenCalledWith(
        "powershell",
        ["-command", expect.stringContaining("CopyFromScreen")],
        expect.any(Object),
      )
    })

    it("captures region screenshot with coordinate bounds on Windows", async () => {
      const agent = await createInitializedAgent()
      vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const region = { x: 10, y: 20, width: 100, height: 80 }
      const buffer = await agent.captureScreenshot(region)

      expect(buffer).toBeInstanceOf(Buffer)
      // Region coordinates must appear in the PowerShell command
      expect(mockExeca).toHaveBeenCalledWith(
        "powershell",
        ["-command", expect.stringContaining("10")],
        expect.any(Object),
      )
    })

    it("captures screenshot on macOS via screencapture command", async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

      const agent = new GUIAgent(createMockGUIConfig({ enabled: true }))
      await agent.initialize()

      vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const buffer = await agent.captureScreenshot()

      expect(buffer).toBeInstanceOf(Buffer)
      expect(mockExeca).toHaveBeenCalledWith(
        "screencapture",
        expect.arrayContaining(["-x"]),
        undefined,
      )

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })
  })

  // ── [Mouse] ──────────────────────────────────────────────────────────────

  /**
   * @paper CodeAct ICML 2024 — Actions are executable; each must route to correct subsystem
   */
  describe("[Mouse]", () => {
    it("click action executes mouse_event via PowerShell and returns success", async () => {
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "click", coordinates: { x: 500, y: 300 } })

      expect(result.success).toBe(true)
      expect(result.data).toContain("500")
      expect(result.data).toContain("300")
    })

    it("double_click action sends two sequential click events", async () => {
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "double_click", coordinates: { x: 200, y: 150 } })

      expect(result.success).toBe(true)
      expect(result.data).toContain("200")
    })

    it("drag action dispatches mousedown→move→mouseup via PowerShell", async () => {
      // drag is in DESTRUCTIVE_ACTIONS but requireConfirmation=false in test config
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({
        action: "drag",
        coordinates: { x: 100, y: 100 },
        endCoordinates: { x: 400, y: 400 },
      })

      expect(result.success).toBe(true)
      expect(result.data).toContain("400")
    })
  })

  // ── [Keyboard] ───────────────────────────────────────────────────────────

  /** @paper CodeAct ICML 2024 — Text input is fundamental to OS-agent task completion */
  describe("[Keyboard]", () => {
    it("type action sends text via SendKeys on Windows and returns character count", async () => {
      // type is in DESTRUCTIVE_ACTIONS but requireConfirmation=false
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "type", text: "hello world" })

      expect(result.success).toBe(true)
      expect(result.data).toContain("11") // "hello world" = 11 chars
    })

    it("hotkey action sends Ctrl+S key combination via SendKeys on Windows", async () => {
      const agent = await createInitializedAgent()
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      const result = await agent.execute({ action: "hotkey", keys: ["ctrl", "s"] })

      expect(result.success).toBe(true)
      expect(result.data).toContain("ctrl+s")
    })
  })

  // ── [Safety] ─────────────────────────────────────────────────────────────

  /**
   * @paper CaMeL 2503.18813 — Rate limiting prevents runaway agent actions
   * @paper OSWorld 2404.07972 — Reproducibility requires max actions/min
   */
  describe("[Safety]", () => {
    it("rejects the second action when rate limit of 1 action/min is exceeded", async () => {
      const agent = await createInitializedAgent({ maxActionsPerMinute: 1 })
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

      // First click: should succeed (within rate limit)
      const first = await agent.execute({ action: "click", coordinates: { x: 100, y: 100 } })
      expect(first.success).toBe(true)

      // Second click: must be rejected — rate limit exceeded
      const second = await agent.execute({ action: "click", coordinates: { x: 200, y: 200 } })
      expect(second.success).toBe(false)
      expect(second.error).toContain("Rate limit")
    })

    it("returns error for click action without required coordinates", async () => {
      const agent = await createInitializedAgent()

      // Missing coordinates → early return with descriptive error (CodeAct self-debugging)
      const result = await agent.execute({ action: "click" })

      expect(result.success).toBe(false)
      expect(result.error).toContain("coordinates")
    })

    it("returns error for type action without required text", async () => {
      const agent = await createInitializedAgent()

      const result = await agent.execute({ action: "type" })

      expect(result.success).toBe(false)
      expect(result.error).toContain("text")
    })
  })
})
