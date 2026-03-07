/**
 * @file os-agent-index.test.ts
 * @description Tests for OSAgent orchestrator — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - MemGPT (arXiv:2310.08560) — OS-level lifecycle: CREATED→RUNNING→DEGRADED→DEAD
 *   - OSWorld (arXiv:2404.07972) — Subsystem composition + delegation
 *   - CodeAct (arXiv:2402.01030) — Graceful error isolation in agent pipelines
 *
 * COVERAGE TARGET: ≥80%
 *
 * MOCK STRATEGY:
 *   - All 6 subsystem modules are vi.mock()'d so OSAgent uses fake instances.
 *   - Per-test overrides use MockXxx.prototype.initialize methods.
 *
 * TEST GROUPS:
 *   1. [Lifecycle] — constructor, initialize, shutdown
 *   2. [Resilience] — partial failure via Promise.allSettled
 *   3. [Delegation] — execute() dispatches to correct subsystem
 *   4. [Integration] — VisionCortex.setGUIAgent + perception snapshot
 *   5. [Config] — disabled subsystems respected
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { createMockOSAgentConfig } from "./test-helpers.js"

// ── Mock all subsystem modules ────────────────────────────────────────────────
// Order matters: mock before importing the module under test.

const mockInitialize = vi.fn().mockResolvedValue(undefined)
const mockShutdown = vi.fn().mockResolvedValue(undefined)
const mockStartMonitoring = vi.fn()
const mockStopMonitoring = vi.fn()
const mockSetGUIAgent = vi.fn()
const mockStartLoop = vi.fn().mockResolvedValue(undefined)
const mockStopLoop = vi.fn().mockResolvedValue(undefined)
const mockGetSnapshot = vi.fn().mockResolvedValue({ timestamp: Date.now(), system: {}, activeContext: {} })
const mockSummarize = vi.fn().mockReturnValue("context summary")
const mockExecuteGUI = vi.fn().mockResolvedValue({ success: true, data: "gui result" })
const mockExecuteCommand = vi.fn().mockResolvedValue({ success: true, data: { stdout: "output" } })
const mockSpeak = vi.fn().mockResolvedValue({ success: true })
const mockIoTExecute = vi.fn().mockResolvedValue({ success: true })
const mockCaptureAndAnalyze = vi.fn().mockResolvedValue({ success: true, data: {} })
const mockListWindows = vi.fn().mockResolvedValue([])

const systemState = { cpuUsage: 10, ramUsage: 50, diskUsage: 30, topProcesses: [], networkConnected: true, idleTimeSeconds: 0 }

vi.mock("../system-monitor.js", () => ({
  SystemMonitor: vi.fn().mockImplementation(function () {
    return {
    initialize: mockInitialize,
    shutdown: mockShutdown,
    startMonitoring: mockStartMonitoring,
    stopMonitoring: mockStopMonitoring,
    get state() { return systemState },
    executeCommand: mockExecuteCommand,
    isInitialized: true,
    }
  }),
}))

vi.mock("../gui-agent.js", () => ({
  GUIAgent: vi.fn().mockImplementation(function () {
    return {
    initialize: mockInitialize,
    shutdown: mockShutdown,
    execute: mockExecuteGUI,
    listWindows: mockListWindows,
    isInitialized: true,
    }
  }),
}))

vi.mock("../vision-cortex.js", () => ({
  VisionCortex: vi.fn().mockImplementation(function () {
    return {
    initialize: mockInitialize,
    shutdown: mockShutdown,
    setGUIAgent: mockSetGUIAgent,
    captureAndAnalyze: mockCaptureAndAnalyze,
    isInitialized: true,
    }
  }),
}))

vi.mock("../voice-io.js", () => ({
  VoiceIO: vi.fn().mockImplementation(function () {
    return {
    initialize: mockInitialize,
    shutdown: mockShutdown,
    speak: mockSpeak,
    isSpeaking: false,
    wakeWordDetected: false,
    audioLevel: 0,
    lastTranscript: undefined,
    isInitialized: true,
    }
  }),
}))

vi.mock("../iot-bridge.js", () => ({
  IoTBridge: vi.fn().mockImplementation(function () {
    return {
    initialize: mockInitialize,
    shutdown: mockShutdown,
    execute: mockIoTExecute,
    getStates: vi.fn().mockResolvedValue({ connectedDevices: 0, devices: [] }),
    parseNaturalLanguage: vi.fn().mockReturnValue([]),
    isInitialized: true,
    }
  }),
}))

vi.mock("../perception-fusion.js", () => ({
  PerceptionFusion: vi.fn().mockImplementation(function () {
    return {
    startLoop: mockStartLoop,
    stopLoop: mockStopLoop,
    getSnapshot: mockGetSnapshot,
    summarize: mockSummarize,
    }
  }),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { OSAgent } from "../index.js"
import { GUIAgent } from "../gui-agent.js"
import { VisionCortex } from "../vision-cortex.js"
import { SystemMonitor } from "../system-monitor.js"
import { VoiceIO } from "../voice-io.js"
import { IoTBridge } from "../iot-bridge.js"
import { PerceptionFusion } from "../perception-fusion.js"

const MockGUIAgent = vi.mocked(GUIAgent)
const MockVisionCortex = vi.mocked(VisionCortex)
const MockSystemMonitor = vi.mocked(SystemMonitor)
const MockVoiceIO = vi.mocked(VoiceIO)
const MockIoTBridge = vi.mocked(IoTBridge)
const MockPerceptionFusion = vi.mocked(PerceptionFusion)

// ── Test suite ────────────────────────────────────────────────────────────────

describe("OSAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-apply default implementations after reset
    mockInitialize.mockResolvedValue(undefined)
    mockShutdown.mockResolvedValue(undefined)
    mockStartLoop.mockResolvedValue(undefined)
    mockStopLoop.mockResolvedValue(undefined)
    mockGetSnapshot.mockResolvedValue({ timestamp: Date.now(), system: systemState, activeContext: {} })
    mockSummarize.mockReturnValue("context summary")
    mockExecuteGUI.mockResolvedValue({ success: true, data: "gui result" })
    mockExecuteCommand.mockResolvedValue({ success: true, data: { stdout: "output" } })
    mockSpeak.mockResolvedValue({ success: true })
    mockIoTExecute.mockResolvedValue({ success: true })
    mockCaptureAndAnalyze.mockResolvedValue({ success: true, data: {} })
    mockListWindows.mockResolvedValue([])
    mockSetGUIAgent.mockImplementation(function () {})
    mockStartMonitoring.mockImplementation(function () {})
    mockStopMonitoring.mockImplementation(function () {})

    // Re-mock constructors
    MockGUIAgent.mockImplementation(function () {
      return {
        initialize: mockInitialize, shutdown: mockShutdown,
        execute: mockExecuteGUI, listWindows: mockListWindows, isInitialized: true,
      } as any
    })

    MockVisionCortex.mockImplementation(function () {
      return {
        initialize: mockInitialize, shutdown: mockShutdown,
        setGUIAgent: mockSetGUIAgent, captureAndAnalyze: mockCaptureAndAnalyze, isInitialized: true,
      } as any
    })

    MockSystemMonitor.mockImplementation(function () {
      return {
        initialize: mockInitialize, shutdown: mockShutdown,
        startMonitoring: mockStartMonitoring, stopMonitoring: mockStopMonitoring,
        get state() { return systemState }, executeCommand: mockExecuteCommand, isInitialized: true,
      } as any
    })

    MockVoiceIO.mockImplementation(function () {
      return {
        initialize: mockInitialize, shutdown: mockShutdown, speak: mockSpeak,
        isSpeaking: false, wakeWordDetected: false, audioLevel: 0, lastTranscript: undefined, isInitialized: true,
      } as any
    })

    MockIoTBridge.mockImplementation(function () {
      return {
        initialize: mockInitialize, shutdown: mockShutdown, execute: mockIoTExecute,
        getStates: vi.fn().mockResolvedValue({ connectedDevices: 0, devices: [] }),
        parseNaturalLanguage: vi.fn().mockReturnValue([]), isInitialized: true,
      } as any
    })

    MockPerceptionFusion.mockImplementation(function () {
      return {
        startLoop: mockStartLoop, stopLoop: mockStopLoop,
        getSnapshot: mockGetSnapshot, summarize: mockSummarize,
      } as any
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ── [Lifecycle] ───────────────────────────────────────────────────────────

  /**
   * @paper MemGPT 2310.08560 — OS lifecycle: CREATED → RUNNING
   */
  describe("[Lifecycle]", () => {
    it("constructor creates instances of all 6 subsystems", () => {
      const config = createMockOSAgentConfig()
      new OSAgent(config)

      expect(MockSystemMonitor).toHaveBeenCalledOnce()
      expect(MockGUIAgent).toHaveBeenCalledOnce()
      expect(MockVisionCortex).toHaveBeenCalledOnce()
      expect(MockVoiceIO).toHaveBeenCalledOnce()
      expect(MockIoTBridge).toHaveBeenCalledOnce()
      expect(MockPerceptionFusion).toHaveBeenCalledOnce()
    })

    it("initialize() calls initialize() on all 5 subsystems", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)

      await agent.initialize()

      // 5 subsystems × 1 initialize call each
      expect(mockInitialize).toHaveBeenCalledTimes(5)
    })

    it("shutdown() calls shutdown/stopLoop on all subsystems", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      await agent.shutdown()

      expect(mockStopLoop).toHaveBeenCalledOnce()
      expect(mockShutdown).toHaveBeenCalledTimes(5) // all 5 subsystems
    })
  })

  // ── [Resilience] ─────────────────────────────────────────────────────────

  /**
   * @paper MemGPT 2310.08560 — Graceful degradation: one subsystem failure ≠ total crash
   * Promise.allSettled ensures all subsystems attempt init regardless of individual failures.
   */
  describe("[Resilience]", () => {
    it("partial initialization failure does not throw (Promise.allSettled)", async () => {
      // Make GUIAgent.initialize() reject
      MockGUIAgent.mockImplementationOnce(function () {
        return {
          initialize: vi.fn().mockRejectedValue(new Error("GPU not found")),
          shutdown: mockShutdown,
          execute: mockExecuteGUI,
          listWindows: mockListWindows,
          isInitialized: false,
        } as any
      })

      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)

      // MUST NOT throw even though one subsystem failed
      await expect(agent.initialize()).resolves.not.toThrow()
    })

    it("one subsystem shutdown failure does not prevent others from shutting down", async () => {
      // Make VoiceIO.shutdown() reject
      MockVoiceIO.mockImplementationOnce(function () {
        return {
          initialize: mockInitialize,
          shutdown: vi.fn().mockRejectedValue(new Error("Audio device busy")),
          speak: mockSpeak,
          isSpeaking: false, wakeWordDetected: false, audioLevel: 0, lastTranscript: undefined,
          isInitialized: true,
        } as any
      })

      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      // MUST NOT throw even though one shutdown fails
      await expect(agent.shutdown()).resolves.not.toThrow()
    })
  })

  // ── [Delegation] ─────────────────────────────────────────────────────────

  /**
   * @paper CodeAct ICML 2024 — execute() routes each action type to the correct subsystem
   */
  describe("[Delegation]", () => {
    it("execute('gui') delegates to gui.execute()", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      const result = await agent.execute({
        type: "gui",
        payload: { action: "click", coordinates: { x: 100, y: 100 } },
      })

      expect(mockExecuteGUI).toHaveBeenCalledWith(
        expect.objectContaining({ action: "click" }),
      )
      expect(result.success).toBe(true)
    })

    it("execute('shell') delegates to system.executeCommand()", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      const result = await agent.execute({ type: "shell", payload: { command: "echo hello" } })

      expect(mockExecuteCommand).toHaveBeenCalledWith("echo hello", undefined)
      expect(result.success).toBe(true)
    })

    it("execute('voice') delegates to voice.speak()", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      await agent.execute({ type: "voice", payload: { text: "hello world" } })

      expect(mockSpeak).toHaveBeenCalledWith("hello world", undefined)
    })

    it("execute('iot') delegates to iot.execute()", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      await agent.execute({
        type: "iot",
        payload: { target: "home_assistant", domain: "light", service: "turn_on", entityId: "light.bedroom" },
      })

      expect(mockIoTExecute).toHaveBeenCalled()
    })

    it("execute('screenshot') delegates to vision.captureAndAnalyze()", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      await agent.execute({ type: "screenshot" })

      expect(mockCaptureAndAnalyze).toHaveBeenCalledOnce()
    })
  })

  // ── [Integration] ─────────────────────────────────────────────────────────

  /**
   * @paper OSWorld 2404.07972 — Subsystem composition: VisionCortex delegates screenshot to GUIAgent
   */
  describe("[Integration]", () => {
    it("constructor calls vision.setGUIAgent(gui) to avoid duplicate screenshots", () => {
      const config = createMockOSAgentConfig()
      new OSAgent(config)

      // VisionCortex should receive the GUIAgent instance
      expect(mockSetGUIAgent).toHaveBeenCalledOnce()
    })

    it("getContextSnapshot() delegates to perception.getSnapshot()", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)
      await agent.initialize()

      await agent.getContextSnapshot()

      expect(mockGetSnapshot).toHaveBeenCalledOnce()
    })

    it("startPerceptionLoop() throws if called before initialize()", async () => {
      const config = createMockOSAgentConfig()
      const agent = new OSAgent(config)

      // Not initialized → must throw
      await expect(agent.startPerceptionLoop()).rejects.toThrow()
    })
  })
})
