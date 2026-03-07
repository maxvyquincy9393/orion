/**
 * @file iot-bridge.test.ts
 * @description Tests for IoTBridge — EDITH OS-Agent layer
 *
 * PAPER BASIS:
 *   - LLM-based Home Automation (arXiv 2024) — NL→service mapping
 *   - Synthetic Home benchmark — IoT state management evaluation
 *
 * COVERAGE TARGET: ≥85%
 *
 * MOCK STRATEGY:
 *   - global fetch: stubbed via vi.stubGlobal to intercept Home Assistant REST API calls
 *     without real network access.
 *
 * TEST GROUPS:
 *   1. [Initialization] — HA connection + token handling
 *   2. [HA Execute] — service call routing and error handling
 *   3. [Rate Limit] — 30s cache prevents HA API spam
 *   4. [NL Parsing] — Indonesian + English bilingual parsing (pure function)
 *   5. [States] — device state retrieval
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { IoTBridge } from "../iot-bridge.js"
import { createMockIoTConfig, mockFetchOk, mockFetchFail } from "./test-helpers.js"
import haEntities from "./fixtures/ha-entities.json"
import haServiceResponse from "./fixtures/ha-service-response.json"

// ── Test suite ────────────────────────────────────────────────────────────────

describe("IoTBridge", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    mockFetch = vi.fn()
    vi.stubGlobal("fetch", mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // ── [Initialization] ──────────────────────────────────────────────────────

  /** HA connection establishes device list on startup. */
  describe("[Initialization]", () => {
    it("connects to Home Assistant and fetches initial entities when autoDiscover=true", async () => {
      // Connection test (GET /api/) + entity fetch (GET /api/states)
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ message: "API running." }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(haEntities) })

      const config = createMockIoTConfig({ enabled: true, autoDiscover: true })
      const bridge = new IoTBridge(config)
      await bridge.initialize()

      // Bridge initialized — state retrieval should return discovered entities
      const state = await bridge.getStates()
      expect(state.connectedDevices).toBe(3)
      expect(state.devices[0].entityId).toBe("light.bedroom")
    })

    it("logs a warning but continues running when Home Assistant token is missing", async () => {
      const config = createMockIoTConfig({ enabled: true, homeAssistantToken: undefined })
      const bridge = new IoTBridge(config)

      // Should not throw even without token
      await expect(bridge.initialize()).resolves.not.toThrow()
      // fetch should NOT have been called (no token = skip connection attempt)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("skips all initialization when disabled", async () => {
      const config = createMockIoTConfig({ enabled: false })
      const bridge = new IoTBridge(config)

      await bridge.initialize()

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ── [HA Execute] ─────────────────────────────────────────────────────────

  /**
   * @paper LLM-based Home Automation 2024
   * Each NL command must map to a valid HA service POST call.
   */
  describe("[HA Execute]", () => {
    it("calls light/turn_on endpoint and returns success with response data", async () => {
      // Setup: connection OK, entities fetched, service call OK
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ message: "API running." }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(haServiceResponse) })

      const config = createMockIoTConfig({ enabled: true })
      const bridge = new IoTBridge(config)
      await bridge.initialize()

      const result = await bridge.execute({
        target: "home_assistant",
        domain: "light",
        service: "turn_on",
        entityId: "light.bedroom",
      })

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/services/light/turn_on"),
        expect.objectContaining({ method: "POST" }),
      )
    })

    it("returns success=false with error message on HA 401 Unauthorized", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ message: "API running." }) })
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized", json: () => Promise.resolve({}) })

      const config = createMockIoTConfig({ enabled: true })
      const bridge = new IoTBridge(config)
      await bridge.initialize()

      const result = await bridge.execute({
        target: "home_assistant",
        domain: "light",
        service: "turn_on",
        entityId: "light.bedroom",
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("401")
    })
  })

  // ── [Rate Limit] ─────────────────────────────────────────────────────────

  /**
   * @paper Synthetic Home benchmark — Rate limiting prevents HA API spam
   * HA_REFRESH_MIN_INTERVAL_MS = 30_000ms: second call within 30s uses cached data.
   */
  describe("[Rate Limit]", () => {
    it("caches entity states and respects 30-second refresh rate limit", async () => {
      // Connection test
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ message: "API running." }) })
        // autoDiscover is false, so no initial entity fetch
        // First getStates() → fetches entities
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(haEntities) })
      // Second getStates() within 30s → should NOT call fetch again

      const config = createMockIoTConfig({ enabled: true, autoDiscover: false })
      const bridge = new IoTBridge(config)
      await bridge.initialize()

      // First call: triggers /api/states fetch
      await bridge.getStates()
      // Second call: within rate limit window, should use cache
      await bridge.getStates()

      // /api/ (init) + /api/states (first getStates only) = 2 calls total
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ── [NL Parsing] ─────────────────────────────────────────────────────────

  /**
   * @paper LLM-based Home Automation 2024 — NL to HA service mapping
   * Pure function: no mock needed. Tests bilingual Indonesian + English commands.
   */
  describe("[NL Parsing]", () => {
    it("parses 'nyalakan lampu kamar' → {domain: light, service: turn_on, entityId: light.bedroom}", () => {
      const config = createMockIoTConfig({ enabled: false })
      const bridge = new IoTBridge(config)

      const result = bridge.parseNaturalLanguage("nyalakan lampu kamar")

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        domain: "light",
        service: "turn_on",
        entityId: expect.stringContaining("bedroom"),
      })
    })

    it("parses 'set suhu 24 derajat' → {domain: climate, service: set_temperature, data: {temperature: 24}}", () => {
      const config = createMockIoTConfig({ enabled: false })
      const bridge = new IoTBridge(config)

      const result = bridge.parseNaturalLanguage("set suhu 24 derajat")

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        domain: "climate",
        service: "set_temperature",
        data: { temperature: 24 },
      })
    })

    it("parses 'kunci pintu depan' → {domain: lock, service: lock}", () => {
      const config = createMockIoTConfig({ enabled: false })
      const bridge = new IoTBridge(config)

      const result = bridge.parseNaturalLanguage("kunci pintu depan")

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        domain: "lock",
        service: "lock",
      })
    })

    it("parses English 'turn on bedroom light' → {domain: light, service: turn_on}", () => {
      const config = createMockIoTConfig({ enabled: false })
      const bridge = new IoTBridge(config)

      const result = bridge.parseNaturalLanguage("turn on bedroom light")

      expect(result).toHaveLength(1)
      expect(result[0].domain).toBe("light")
      expect(result[0].service).toBe("turn_on")
    })

    it("returns empty array for unrecognized commands (no false positives)", () => {
      const config = createMockIoTConfig({ enabled: false })
      const bridge = new IoTBridge(config)

      const result = bridge.parseNaturalLanguage("what time is it")

      expect(result).toHaveLength(0)
    })
  })

  // ── [States] ─────────────────────────────────────────────────────────────

  /** @paper Synthetic Home benchmark — Device state retrieval */
  describe("[States]", () => {
    it("returns IoT device states with correct entityId and friendlyName", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ message: "API running." }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(haEntities) })

      const config = createMockIoTConfig({ enabled: true })
      const bridge = new IoTBridge(config)
      await bridge.initialize()

      const states = await bridge.getStates()

      expect(states.connectedDevices).toBe(3)
      const bedroomLight = states.devices.find((d) => d.entityId === "light.bedroom")
      expect(bedroomLight).toBeDefined()
      expect(bedroomLight?.friendlyName).toBe("Bedroom Light")
      expect(bedroomLight?.state).toBe("on")
    })

    it("returns empty device list when no HA URL is configured", async () => {
      const config = createMockIoTConfig({ enabled: false, homeAssistantUrl: undefined })
      const bridge = new IoTBridge(config)

      const states = await bridge.getStates()

      expect(states.connectedDevices).toBe(0)
      expect(states.devices).toHaveLength(0)
    })
  })
})
