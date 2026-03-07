/**
 * @file perception-fusion.test.ts
 * @description Tests for PerceptionFusion — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - MemGPT (arXiv:2310.08560) — Hierarchical context fusion → L1 context injection
 *     PerceptionFusion is the L1 context: always-fresh OS state injected into LLM.
 *   - OSWorld (arXiv:2404.07972) — Unified environment observation space O
 *     All sensor data fused into one PerceptionSnapshot.
 *
 * COVERAGE TARGET: ≥90%
 *
 * MOCK STRATEGY:
 *   - All 5 deps (gui, vision, voice, system, iot) are plain mock objects with vi.fn()
 *     methods. No class mocking needed — PerceptionFusion uses duck typing.
 *
 * TEST GROUPS:
 *   1. [Snapshot] — getSnapshot() returns complete PerceptionSnapshot
 *   2. [Activity Detection] — window title → userActivity inference
 *   3. [Summary] — summarize() returns LLM-injectable context string
 *   4. [Staleness] — isStale detection via timestamp comparison
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { PerceptionFusion } from "../perception-fusion.js"
import { createMockSystemState, createMockIoTState } from "./test-helpers.js"
import type { ScreenState } from "../types.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a mock ScreenState with a given window title and process. */
function buildScreenState(title: string, processName = "unknown"): ScreenState {
  return {
    activeWindowTitle: title,
    activeWindowProcess: processName,
    resolution: { width: 1920, height: 1080 },
  }
}

/** Build a standard mock deps object for PerceptionFusion. */
function buildMockDeps() {
  const systemState = createMockSystemState()
  return {
    gui: {
      captureScreenshot: vi.fn(),
    },
    vision: {
      getScreenState: vi.fn<[], Promise<ScreenState | null>>().mockResolvedValue(
        buildScreenState("Visual Studio Code - my-project"),
      ),
      captureAndAnalyze: vi.fn(),
    },
    voice: {
      isSpeaking: false,
      wakeWordDetected: false,
      audioLevel: 0,
      lastTranscript: undefined as string | undefined,
    },
    system: {
      state: systemState,
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
    },
    iot: {
      getStates: vi.fn<[], Promise<{ connectedDevices: number; devices: any[] }>>().mockResolvedValue(
        createMockIoTState(),
      ),
    },
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("PerceptionFusion", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── [Snapshot] ────────────────────────────────────────────────────────────

  /**
   * @paper MemGPT 2310.08560 — L1 context: snapshot merged from all subsystems
   * @paper OSWorld 2404.07972 — Observation space O = {screen, audio, system, iot}
   */
  describe("[Snapshot]", () => {
    it("getSnapshot() returns a complete PerceptionSnapshot from all modules", async () => {
      const deps = buildMockDeps()
      const fusion = new PerceptionFusion(deps as any)

      const snapshot = await fusion.getSnapshot()

      expect(snapshot).toBeDefined()
      expect(snapshot.timestamp).toBeGreaterThan(0)
      expect(snapshot.system).toBeDefined()
      expect(snapshot.system.cpuUsage).toBe(25)
      expect(snapshot.system.ramUsage).toBe(60)
    })

    it("snapshot includes screen state, audio state, and IoT devices", async () => {
      const deps = buildMockDeps()
      deps.iot.getStates.mockResolvedValue(createMockIoTState())
      const fusion = new PerceptionFusion(deps as any)

      const snapshot = await fusion.getSnapshot()

      // Screen state from vision.getScreenState()
      expect(snapshot.screen).toBeDefined()
      expect(snapshot.screen?.activeWindowTitle).toContain("Visual Studio Code")

      // Audio state from voice properties
      expect(snapshot.audio).toBeDefined()
      expect(snapshot.audio?.isSpeaking).toBe(false)

      // IoT state from iot.getStates()
      expect(snapshot.iot).toBeDefined()
      expect(snapshot.iot?.connectedDevices).toBe(3)
    })

    it("snapshot.audio.isSpeaking reflects voice.isSpeaking at capture time", async () => {
      const deps = buildMockDeps()
      ;(deps.voice as any).isSpeaking = true

      const fusion = new PerceptionFusion(deps as any)
      const snapshot = await fusion.getSnapshot()

      expect(snapshot.audio?.isSpeaking).toBe(true)
    })
  })

  // ── [Activity Detection] ─────────────────────────────────────────────────

  /**
   * @paper OSWorld 2404.07972 — Environment state includes user activity
   * Activity is inferred from active window title + process name.
   */
  describe("[Activity Detection]", () => {
    it("detects 'coding' activity from VS Code window title", async () => {
      const deps = buildMockDeps()
      deps.vision.getScreenState.mockResolvedValue(
        buildScreenState("my-file.ts - my-project - Visual Studio Code", "code"),
      )

      const fusion = new PerceptionFusion(deps as any)
      const snapshot = await fusion.getSnapshot()

      expect(snapshot.activeContext.userActivity).toBe("coding")
      expect(snapshot.activeContext.activityConfidence).toBeGreaterThan(0.5)
    })

    it("detects 'browsing' activity from Chrome window title", async () => {
      const deps = buildMockDeps()
      deps.vision.getScreenState.mockResolvedValue(
        buildScreenState("Google - Google Chrome", "chrome"),
      )

      const fusion = new PerceptionFusion(deps as any)
      const snapshot = await fusion.getSnapshot()

      expect(snapshot.activeContext.userActivity).toBe("browsing")
    })

    it("detects 'communicating' activity from Zoom window title", async () => {
      const deps = buildMockDeps()
      deps.vision.getScreenState.mockResolvedValue(
        buildScreenState("Zoom Meeting", "zoom"),
      )

      const fusion = new PerceptionFusion(deps as any)
      const snapshot = await fusion.getSnapshot()

      expect(snapshot.activeContext.userActivity).toBe("communicating")
    })

    it("returns 'unknown' activity for an unrecognized window title", async () => {
      const deps = buildMockDeps()
      deps.vision.getScreenState.mockResolvedValue(
        buildScreenState("Some Obscure App 3.0", "obscureapp"),
      )

      const fusion = new PerceptionFusion(deps as any)
      const snapshot = await fusion.getSnapshot()

      expect(snapshot.activeContext.userActivity).toBe("unknown")
    })

    it("detects 'idle' activity when user idle time exceeds 300 seconds", async () => {
      const deps = buildMockDeps()
      // Override system state with high idle time
      ;(deps.system as any).state = createMockSystemState({ idleTimeSeconds: 400 })

      const fusion = new PerceptionFusion(deps as any)
      const snapshot = await fusion.getSnapshot()

      expect(snapshot.activeContext.userActivity).toBe("idle")
      expect(snapshot.activeContext.activityConfidence).toBeGreaterThanOrEqual(0.9)
    })
  })

  // ── [Summary] ────────────────────────────────────────────────────────────

  /**
   * @paper MemGPT 2310.08560 — summarize() produces L1 context string for LLM injection
   * The summary should be one line, pipe-separated, injected into system prompt.
   */
  describe("[Summary]", () => {
    it("summarize() returns a single-line pipe-separated context string", async () => {
      const deps = buildMockDeps()
      deps.iot.getStates.mockResolvedValue(createMockIoTState())

      const fusion = new PerceptionFusion(deps as any)
      await fusion.getSnapshot() // populate lastSnapshot

      const summary = fusion.summarize()

      expect(typeof summary).toBe("string")
      expect(summary.length).toBeGreaterThan(0)
      // Should contain CPU and RAM values
      expect(summary).toContain("CPU")
      expect(summary).toContain("RAM")
    })

    it("summarize() returns 'No perception data available.' when no snapshot exists", () => {
      const deps = buildMockDeps()
      const fusion = new PerceptionFusion(deps as any)

      // No getSnapshot() call → lastSnapshot is null
      const summary = fusion.summarize()

      expect(summary).toBe("No perception data available.")
    })
  })

  // ── [Staleness] ──────────────────────────────────────────────────────────

  /**
   * @paper MemGPT 2310.08560 — isStale = Δt > τ_stale where τ_stale = 10_000ms
   * Stale snapshot triggers automatic refresh in getSnapshot().
   */
  describe("[Staleness]", () => {
    it("getSnapshot() automatically refreshes when last snapshot is older than 10 seconds", async () => {
      const deps = buildMockDeps()
      const fusion = new PerceptionFusion(deps as any)

      // Get initial snapshot
      await fusion.getSnapshot()

      // Advance Date.now() by 11 seconds (beyond STALE_THRESHOLD_MS = 10_000)
      const originalNow = Date.now
      const frozenNow = Date.now() + 11_000
      vi.spyOn(Date, "now").mockReturnValue(frozenNow)

      // Second getSnapshot() should trigger a refresh
      await fusion.getSnapshot()

      // vision.getScreenState should have been called at least twice (initial + refresh)
      expect(deps.vision.getScreenState).toHaveBeenCalledTimes(2)

      vi.spyOn(Date, "now").mockRestore()
    })
  })
})
