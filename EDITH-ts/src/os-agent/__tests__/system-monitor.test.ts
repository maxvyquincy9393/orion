/**
 * @file system-monitor.test.ts
 * @description Tests for SystemMonitor — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - MemGPT (arXiv:2310.08560) — Resource monitoring as L1 context input
 *     CPU/RAM/disk feed into PerceptionFusion snapshot injected into LLM context.
 *
 * COVERAGE TARGET: ≥85%
 *
 * MOCK STRATEGY:
 *   - node:os: mocked so CPU/memory reads return deterministic values
 *   - execa: mocked so PowerShell/ping/ps commands return test data
 *
 * TEST GROUPS:
 *   1. [Initialization] — lifecycle + disabled state
 *   2. [CPU] — two-sample delta formula validation
 *   3. [Memory] — RAM usage from os.totalmem / os.freemem
 *   4. [Disk] — Windows PowerShell and Unix df parsing
 *   5. [Network] — Test-Connection / ping detection
 *   6. [Processes] — top process list via Get-Process
 *   7. [Clipboard] — Get-Clipboard reading
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { SystemMonitor } from "../system-monitor.js"
import { createMockSystemConfig } from "./test-helpers.js"

// ── Mock declarations (hoisted by vitest before imports) ──────────────────────

vi.mock("execa", () => ({ execa: vi.fn() }))

vi.mock("node:os", () => ({
  default: {
    cpus: vi.fn(),
    totalmem: vi.fn(),
    freemem: vi.fn(),
    tmpdir: () => "/tmp",
    platform: () => "win32",
  },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { execa } from "execa"
import os from "node:os"

const mockExeca = vi.mocked(execa)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a CPU sample array for mocking os.cpus().
 * idle = idle time, totalCombined = total CPU ticks for that sample.
 * This lets us manufacture specific delta values.
 */
function buildCpuSample(idle: number, totalCombined: number): ReturnType<typeof os.cpus> {
  const nonIdle = totalCombined - idle
  return [
    {
      model: "Intel Core i7",
      speed: 2400,
      times: { user: nonIdle, nice: 0, sys: 0, idle, irq: 0 },
    },
  ] as ReturnType<typeof os.cpus>
}

/**
 * Default execa mock: answers different script patterns for each subsystem.
 * Windows-only since process.platform = "win32" during tests.
 */
function setupDefaultExecaMock(): void {
  mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
    const script = Array.isArray(args) ? (args[1] ?? "") : ""
    if (typeof script === "string") {
      if (script.includes("Test-Connection")) return { stdout: "True", stderr: "", exitCode: 0 } as any
      if (script.includes("Win32_Battery")) return { stdout: "", stderr: "", exitCode: 0 } as any // no battery → null
      if (script.includes("Get-Process")) return { stdout: "Code\nnode\nchrome", stderr: "", exitCode: 0 } as any
      if (script.includes("Get-PSDrive")) return { stdout: "40", stderr: "", exitCode: 0 } as any
      if (script.includes("GetLastInputInfo")) return { stdout: "5", stderr: "", exitCode: 0 } as any
      if (script.includes("Get-Clipboard")) return { stdout: "", stderr: "", exitCode: 0 } as any
    }
    return { stdout: "", stderr: "", exitCode: 0 } as any
  })
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("SystemMonitor", () => {
  beforeEach(() => {
    vi.resetAllMocks()

    // Default CPU/RAM mocks
    vi.mocked(os.cpus).mockReturnValue(buildCpuSample(800, 1000))
    vi.mocked(os.totalmem).mockReturnValue(8 * 1024 * 1024 * 1024) // 8 GB
    vi.mocked(os.freemem).mockReturnValue(4 * 1024 * 1024 * 1024) // 4 GB free → 50% used

    setupDefaultExecaMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── [Initialization] ──────────────────────────────────────────────────────

  /** @paper MemGPT 2310.08560 — L1 context bootstrapped at startup */
  describe("[Initialization]", () => {
    it("initializes and populates RAM and network state", async () => {
      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)

      await monitor.initialize()

      // RAM: (8GB - 4GB) / 8GB * 100 = 50%
      expect(monitor.state.ramUsage).toBe(50)
      // Network: Test-Connection returns "True"
      expect(monitor.state.networkConnected).toBe(true)
    })

    it("skips all initialization and leaves state at defaults when disabled", async () => {
      const config = createMockSystemConfig({ enabled: false })
      const monitor = new SystemMonitor(config)

      await monitor.initialize()

      // No PowerShell calls should have been made
      expect(mockExeca).not.toHaveBeenCalled()
      // cpuUsage stays at initial default 0
      expect(monitor.state.cpuUsage).toBe(0)
    })
  })

  // ── [CPU] ────────────────────────────────────────────────────────────────

  /**
   * @paper MemGPT 2310.08560 — CPU usage as L1 resource metric
   * Two-sample delta: CPU% = (1 - idle_delta / total_delta) × 100
   */
  describe("[CPU]", () => {
    it("returns cpuUsage=0 on first sample because no delta baseline exists yet", async () => {
      // First call sets the baseline — no delta can be computed yet, must return 0
      vi.mocked(os.cpus).mockReturnValue(buildCpuSample(800, 1000))

      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      expect(monitor.state.cpuUsage).toBe(0)
    })

    it("measures CPU usage with two-sample delta: idle_delta=50 / total_delta=100 → 50%", async () => {
      vi.useFakeTimers()

      // Sample 1 (baseline):   idle=800, total=1000
      // Sample 2 (measured): idle=850, total=1100
      // idle_delta = 50, total_delta = 100
      // CPU% = (1 - 50/100) × 100 = 50%
      vi.mocked(os.cpus)
        .mockReturnValueOnce(buildCpuSample(800, 1000)) // initialize() call
        .mockReturnValueOnce(buildCpuSample(850, 1100)) // timer callback call

      const config = createMockSystemConfig({
        enabled: true,
        resourceCheckIntervalMs: 100,
      })
      const monitor = new SystemMonitor(config)

      await monitor.initialize() // first sample → cpuUsage = 0

      monitor.startMonitoring()
      await vi.advanceTimersByTimeAsync(150) // fire one tick
      monitor.stopMonitoring()

      expect(monitor.state.cpuUsage).toBe(50)

      vi.useRealTimers()
    })

    it("CPU percentage is always clamped between 0 and 100", async () => {
      vi.useFakeTimers()

      // Both samples: zero idle (100% busy)
      vi.mocked(os.cpus)
        .mockReturnValueOnce(buildCpuSample(0, 1000))
        .mockReturnValueOnce(buildCpuSample(0, 2000))

      const config = createMockSystemConfig({ enabled: true, resourceCheckIntervalMs: 100 })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()
      monitor.startMonitoring()
      await vi.advanceTimersByTimeAsync(150)
      monitor.stopMonitoring()

      expect(monitor.state.cpuUsage).toBeGreaterThanOrEqual(0)
      expect(monitor.state.cpuUsage).toBeLessThanOrEqual(100)

      vi.useRealTimers()
    })
  })

  // ── [Memory] ─────────────────────────────────────────────────────────────

  /** @paper MemGPT 2310.08560 — RAM as L1 context: triggers context eviction warnings */
  describe("[Memory]", () => {
    it("calculates RAM usage percentage from os.totalmem and os.freemem", async () => {
      // 6 GB used out of 8 GB = 75%
      vi.mocked(os.totalmem).mockReturnValue(8 * 1024 * 1024 * 1024)
      vi.mocked(os.freemem).mockReturnValue(2 * 1024 * 1024 * 1024)

      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      expect(monitor.state.ramUsage).toBe(75)
    })
  })

  // ── [Disk] ───────────────────────────────────────────────────────────────

  /** @paper OSWorld 2404.07972 — Disk state is part of OS environment context O */
  describe("[Disk]", () => {
    it("parses disk usage percentage from PowerShell Get-PSDrive on Windows", async () => {
      mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
        const script = Array.isArray(args) ? (args[1] ?? "") : ""
        if (script.includes("Get-PSDrive")) return { stdout: "58", stderr: "", exitCode: 0 } as any
        if (script.includes("Win32_Battery")) return { stdout: "", stderr: "", exitCode: 0 } as any
        if (script.includes("Test-Connection")) return { stdout: "True", stderr: "", exitCode: 0 } as any
        return { stdout: "", stderr: "", exitCode: 0 } as any
      })

      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      expect(monitor.state.diskUsage).toBe(58)
    })

    it("parses disk usage percentage from 'df' output on Unix", async () => {
      // Temporarily switch to linux platform
      const originalPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "linux", configurable: true })

      // df -h / output contains "40%" somewhere
      mockExeca.mockResolvedValue({
        stdout: "/dev/sda1 50G 20G 30G 40% /",
        stderr: "",
        exitCode: 0,
      } as any)

      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      expect(monitor.state.diskUsage).toBe(40)

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
    })
  })

  // ── [Network] ────────────────────────────────────────────────────────────

  /** @paper OSWorld 2404.07972 — Agent must be network-aware for web tasks */
  describe("[Network]", () => {
    it("detects network connectivity via PowerShell Test-Connection (stdout: 'True')", async () => {
      mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
        const script = Array.isArray(args) ? (args[1] ?? "") : ""
        if (script.includes("Test-Connection")) return { stdout: "True", stderr: "", exitCode: 0 } as any
        if (script.includes("Win32_Battery")) return { stdout: "", stderr: "", exitCode: 0 } as any
        return { stdout: "", stderr: "", exitCode: 0 } as any
      })

      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      expect(monitor.state.networkConnected).toBe(true)
    })

    it("reports network as disconnected when Test-Connection throws", async () => {
      mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
        const script = Array.isArray(args) ? (args[1] ?? "") : ""
        if (script.includes("Test-Connection")) throw new Error("PING: transmit failed")
        if (script.includes("Win32_Battery")) return { stdout: "", stderr: "", exitCode: 0 } as any
        return { stdout: "", stderr: "", exitCode: 0 } as any
      })

      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      expect(monitor.state.networkConnected).toBe(false)
    })
  })

  // ── [Processes] ──────────────────────────────────────────────────────────

  /** @paper OSWorld 2404.07972 — Application state via running process list */
  describe("[Processes]", () => {
    it("parses returning process names from Get-Process ForEach output", async () => {
      mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
        const script = Array.isArray(args) ? (args[1] ?? "") : ""
        if (script.includes("Get-Process")) return { stdout: "Code\nnode\nchrome", stderr: "", exitCode: 0 } as any
        if (script.includes("Win32_Battery")) return { stdout: "", stderr: "", exitCode: 0 } as any
        if (script.includes("Test-Connection")) return { stdout: "True", stderr: "", exitCode: 0 } as any
        return { stdout: "", stderr: "", exitCode: 0 } as any
      })

      const config = createMockSystemConfig({ enabled: true })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      expect(monitor.state.topProcesses).toContain("Code")
      expect(monitor.state.topProcesses).toContain("node")
      expect(monitor.state.topProcesses).toContain("chrome")
    })
  })

  // ── [Clipboard] ──────────────────────────────────────────────────────────

  /** @paper MemGPT 2310.08560 — Clipboard as working context / recall storage */
  describe("[Clipboard]", () => {
    it("reads clipboard text via Get-Clipboard on Windows when watchClipboard=true", async () => {
      mockExeca.mockImplementation(async (_cmd: string, args?: string[]) => {
        const script = Array.isArray(args) ? (args[1] ?? "") : ""
        if (script.includes("Get-Clipboard")) return { stdout: "copied text sample", stderr: "", exitCode: 0 } as any
        if (script.includes("Win32_Battery")) return { stdout: "", stderr: "", exitCode: 0 } as any
        if (script.includes("Test-Connection")) return { stdout: "True", stderr: "", exitCode: 0 } as any
        return { stdout: "", stderr: "", exitCode: 0 } as any
      })

      const config = createMockSystemConfig({
        enabled: true,
        watchClipboard: true,
      })
      const monitor = new SystemMonitor(config)
      await monitor.initialize()

      // Clipboard preview is first 200 chars
      expect(monitor.state.clipboardPreview).toBe("copied text sample")
    })
  })
})
