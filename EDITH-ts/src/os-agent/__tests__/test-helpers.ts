/**
 * @file test-helpers.ts
 * @description Shared test infrastructure for the EDITH OS-Agent test suite.
 *
 * Provides:
 *   - Config factories (safe defaults, fully override-able)
 *   - Buffer fixtures (FAKE_PNG, FAKE_MP3, SPEECH_FRAME, SILENCE_FRAME)
 *   - Mock builders (execa, fetch helpers)
 *   - State factories (SystemState, IoTState)
 *
 * All config factories default to SAFE values:
 *   - voice.enabled = false   → no Python subprocess
 *   - iot.enabled = false     → no HA network calls
 *   - gui.requireConfirmation = false → no confirmation gate in unit tests
 */

import { vi } from "vitest"
import type {
  GUIConfig,
  IoTConfig,
  IoTState,
  OSAgentConfig,
  SystemConfig,
  SystemState,
  VisionConfig,
  VoiceIOConfig,
} from "../types.js"

// ── Buffer Fixtures ────────────────────────────────────────────────────────────

/**
 * Minimal valid 1×1 PNG (68 bytes, base64-encoded).
 * Screenshot capture tests return this instead of real screen data.
 * Source: standard PNG magic bytes + minimal IDAT chunk.
 */
export const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

/**
 * Minimal valid MP3 frame header (4 bytes).
 * Frame sync: 0xFFE0 = MPEG Audio Layer 3.
 * TTS output tests use this as the "audio buffer" from EdgeEngine.generate().
 */
export const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00])

/**
 * Speech audio frame (320 bytes, first byte = 0xFF = speech marker).
 * Simulates VAD True Positive (TPR = 1.0) per Silero VAD paper.
 * Any frame starting with 0xFF is treated as containing speech.
 */
export const SPEECH_FRAME = (() => {
  const buf = Buffer.alloc(320, 0x80)
  buf[0] = 0xff
  return buf
})()

/**
 * Silence audio frame (320 bytes, all 0x00).
 * Simulates VAD True Negative (FPR = 0.0) per Silero VAD paper.
 * Zero signal = no speech energy present.
 */
export const SILENCE_FRAME = Buffer.alloc(320, 0x00)

// ── Config Factories ───────────────────────────────────────────────────────────

/** Create a GUIConfig with safe defaults that can be partially overridden. */
export function createMockGUIConfig(overrides: Partial<GUIConfig> = {}): GUIConfig {
  return {
    enabled: true,
    backend: "native",
    screenshotMethod: "native",
    requireConfirmation: false,
    maxActionsPerMinute: 60,
    ...overrides,
  }
}

/** Create a VisionConfig with safe defaults. */
export function createMockVisionConfig(overrides: Partial<VisionConfig> = {}): VisionConfig {
  return {
    enabled: true,
    ocrEngine: "tesseract",
    elementDetection: "accessibility",
    multimodalEngine: "gemini",
    monitorIntervalMs: 5_000,
    ...overrides,
  }
}

/**
 * Create a VoiceIOConfig with voice DISABLED by default.
 * This prevents Python subprocess spawning in unit tests.
 */
export function createMockVoiceConfig(overrides: Partial<VoiceIOConfig> = {}): VoiceIOConfig {
  return {
    enabled: false,
    mode: "push-to-talk",
    wakeWord: "hey-edith",
    wakeWordEngine: "openwakeword",
    sttEngine: "auto",
    vadEngine: "silero",
    fullDuplex: false,
    language: "auto",
    ...overrides,
  }
}

/** Create a SystemConfig with safe, fast defaults. */
export function createMockSystemConfig(overrides: Partial<SystemConfig> = {}): SystemConfig {
  return {
    enabled: true,
    watchPaths: [],
    watchClipboard: false,
    watchActiveWindow: false,
    resourceCheckIntervalMs: 60_000,
    cpuWarningThreshold: 90,
    ramWarningThreshold: 90,
    diskWarningThreshold: 90,
    ...overrides,
  }
}

/**
 * Create an IoTConfig with IoT DISABLED by default.
 * This prevents real Home Assistant network calls in unit tests.
 */
export function createMockIoTConfig(overrides: Partial<IoTConfig> = {}): IoTConfig {
  return {
    enabled: false,
    homeAssistantUrl: "http://homeassistant.test:8123",
    homeAssistantToken: "ha-test-long-lived-access-token",
    autoDiscover: false,
    ...overrides,
  }
}

/** Create a full OSAgentConfig with all safe defaults. */
export function createMockOSAgentConfig(overrides: Partial<OSAgentConfig> = {}): OSAgentConfig {
  return {
    gui: createMockGUIConfig(overrides.gui as Partial<GUIConfig>),
    vision: createMockVisionConfig(overrides.vision as Partial<VisionConfig>),
    voice: createMockVoiceConfig(overrides.voice as Partial<VoiceIOConfig>),
    system: createMockSystemConfig(overrides.system as Partial<SystemConfig>),
    iot: createMockIoTConfig(overrides.iot as Partial<IoTConfig>),
    perceptionIntervalMs: 1_000,
  }
}

// ── Mock Builders ──────────────────────────────────────────────────────────────

/**
 * Create a vi.fn() resolving to { stdout, stderr: "", exitCode: 0 }.
 * Simulates a successful execa() call.
 */
export function mockExecaSuccess(stdout = ""): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ stdout, stderr: "", exitCode: 0 })
}

/**
 * Create a vi.fn() rejecting with Error(message).
 * Simulates a failed execa() call (non-zero exit, command not found, etc.).
 */
export function mockExecaFail(message: string): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(new Error(message))
}

/**
 * Create a vi.fn() that resolves like a successful fetch() response.
 * Simulates Home Assistant or any REST API returning 200 OK.
 */
export function mockFetchOk(data: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(data),
  })
}

/**
 * Create a vi.fn() that resolves like a failed fetch() response.
 * Simulates 401 Unauthorized, 500 Internal Server Error, etc.
 */
export function mockFetchFail(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    json: () => Promise.resolve({ message: `HTTP error ${status}` }),
  })
}

// ── State Factories ────────────────────────────────────────────────────────────

/**
 * Create a realistic SystemState snapshot for tests.
 * Values chosen to be within normal operating range (no threshold warnings).
 */
export function createMockSystemState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    cpuUsage: 25,
    ramUsage: 60,
    diskUsage: 40,
    topProcesses: ["Code.exe", "node.exe", "chrome.exe"],
    networkConnected: true,
    idleTimeSeconds: 5,
    batteryLevel: 80,
    isCharging: false,
    clipboardPreview: undefined,
    ...overrides,
  }
}

/**
 * Create an IoTState with 3 example smart home devices:
 * bedroom light (on), living room climate, front door lock.
 */
export function createMockIoTState(overrides: Partial<IoTState> = {}): IoTState {
  return {
    connectedDevices: 3,
    devices: [
      { entityId: "light.bedroom", friendlyName: "Bedroom Light", state: "on", domain: "light" },
      { entityId: "climate.living_room", friendlyName: "Living Room AC", state: "cool", domain: "climate" },
      { entityId: "lock.front_door", friendlyName: "Front Door Lock", state: "locked", domain: "lock" },
    ],
    ...overrides,
  }
}
