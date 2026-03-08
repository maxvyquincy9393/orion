/**
 * @file coordinator.ts
 * @description OfflineCoordinator — single source of truth for EDITH's connectivity state.
 *
 * ARCHITECTURE:
 *   Implements a three-state machine: ONLINE → DEGRADED → OFFLINE.
 *   No other module should check internet connectivity independently —
 *   all routing decisions (LLM, STT, TTS, Vision, Embeddings) must
 *   read state from this coordinator.
 *
 *   Event flow:
 *     OfflineCoordinator emits 'online' | 'degraded' | 'offline' events.
 *     Orchestrator + VoiceBridge listen and switch providers accordingly.
 *
 *   Health checks run in the background via startMonitoring():
 *     ONLINE:  every OFFLINE_HEALTH_CHECK_INTERVAL_MS (default: 30s)
 *     OFFLINE: every OFFLINE_HEALTH_CHECK_INTERVAL_OFFLINE_MS (default: 60s)
 *
 * PAPER BASIS:
 *   - AIOS (arXiv:2403.16971): service health monitoring for agent OS
 *   - MemGPT (arXiv:2310.08560): OS-level resource management analogies
 *   - CaMeL (arXiv:2503.18813): state-based security decisions
 *
 * @module offline/coordinator
 */

import EventEmitter from "node:events"

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("offline.coordinator")

/** Connectivity state values. */
export type ConnectivityState = "online" | "degraded" | "offline"

/** Service identifiers for per-service health tracking. */
export type ServiceName = "llm" | "stt" | "tts" | "embeddings" | "vision" | "internet"

/** Result of a single service health probe. */
export interface ServiceHealthResult {
  /** Whether the service is reachable. */
  available: boolean
  /** Latency in ms (null if unreachable). */
  latencyMs: number | null
  /** Optional error message. */
  error?: string
}

/** Snapshot of all service health values at a point in time. */
export interface ConnectivitySnapshot {
  /** Resolved overall state. */
  state: ConnectivityState
  /** Per-service availability. */
  services: Record<ServiceName, boolean>
  /** Timestamp of last health check. */
  lastCheckedAt: number
  /** How many consecutive health checks have produced this state. */
  stableFor: number
}

/** Health probe function signature. Returns availability within timeoutMs. */
type HealthProbe = (timeoutMs: number) => Promise<ServiceHealthResult>

/** Timeout for each service health probe. */
const PROBE_TIMEOUT_MS = 3_000

/** Number of services that must be down before transitioning to OFFLINE (vs DEGRADED). */
const OFFLINE_THRESHOLD_COUNT = 3

/**
 * OfflineCoordinator — monitors network/cloud service health and emits state transitions.
 *
 * Usage:
 *   1. `offlineCoordinator.startMonitoring()` once at startup.
 *   2. Read `.getState()` or listen to `'statechange'` events in routing code.
 *   3. `offlineCoordinator.stopMonitoring()` on shutdown.
 */
export class OfflineCoordinator extends EventEmitter {
  private state: ConnectivityState = "online"
  private readonly services = new Map<ServiceName, boolean>()
  private lastCheckedAt = 0
  private stableFor = 0
  private monitorTimer: ReturnType<typeof setTimeout> | null = null
  private readonly probes = new Map<ServiceName, HealthProbe>()

  constructor() {
    super()
    // Register default probes
    this.registerProbe("llm", (timeout) => this.probeLLM(timeout))
    this.registerProbe("internet", (timeout) => this.probeInternet(timeout))
  }

  /**
   * Register a custom health probe for a service.
   * Called by VoiceBridge, VisionCortex, etc. to inject their own checks.
   */
  registerProbe(service: ServiceName, probe: HealthProbe): void {
    this.probes.set(service, probe)
  }

  /** Returns the current connectivity state. */
  getState(): ConnectivityState {
    return this.state
  }

  /** Returns true if EDITH is fully online. */
  isOnline(): boolean {
    return this.state === "online"
  }

  /** Returns true if any cloud services are unavailable. */
  isDegraded(): boolean {
    return this.state === "degraded" || this.state === "offline"
  }

  /** Returns true if all cloud APIs are unavailable — local-only mode. */
  isOffline(): boolean {
    return this.state === "offline"
  }

  /**
   * Returns a snapshot of all service health values.
   */
  getSnapshot(): ConnectivitySnapshot {
    return {
      state: this.state,
      services: Object.fromEntries(this.services) as Record<ServiceName, boolean>,
      lastCheckedAt: this.lastCheckedAt,
      stableFor: this.stableFor,
    }
  }

  /**
   * Start background health monitoring.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  startMonitoring(): void {
    if (this.monitorTimer !== null) {
      return
    }

    log.info("connectivity monitoring started")
    void this.runHealthCheck()
  }

  /**
   * Stop background health monitoring (call on shutdown).
   */
  stopMonitoring(): void {
    if (this.monitorTimer !== null) {
      clearTimeout(this.monitorTimer)
      this.monitorTimer = null
      log.info("connectivity monitoring stopped")
    }
  }

  /**
   * Force an immediate health check and return the updated state.
   * Useful for on-demand checks (e.g. user asks "are you online?").
   */
  async checkNow(): Promise<ConnectivityState> {
    await this.runHealthCheck()
    return this.state
  }

  // ============================================================
  //  Internal: health check loop
  // ============================================================

  private async runHealthCheck(): Promise<void> {
    const results = await this.runAllProbes()
    const newState = this.resolveState(results)

    this.lastCheckedAt = Date.now()
    this.updateServiceMap(results)

    if (newState !== this.state) {
      const previous = this.state
      this.state = newState
      this.stableFor = 1
      log.info("connectivity state changed", { from: previous, to: newState })
      this.emit("statechange", newState, previous)
      this.emit(newState, previous)
    } else {
      this.stableFor += 1
    }

    // Schedule next check with interval based on current state.
    const intervalMs = this.state === "offline"
      ? config.OFFLINE_HEALTH_CHECK_INTERVAL_OFFLINE_MS
      : config.OFFLINE_HEALTH_CHECK_INTERVAL_MS

    this.monitorTimer = setTimeout(() => {
      this.monitorTimer = null
      void this.runHealthCheck()
    }, intervalMs)
  }

  private async runAllProbes(): Promise<Map<ServiceName, ServiceHealthResult>> {
    const results = new Map<ServiceName, ServiceHealthResult>()

    const probeEntries = [...this.probes.entries()]
    const settled = await Promise.allSettled(
      probeEntries.map(async ([name, probe]) => {
        const result = await probe(PROBE_TIMEOUT_MS)
        return { name, result }
      }),
    )

    for (const item of settled) {
      if (item.status === "fulfilled") {
        results.set(item.value.name, item.value.result)
      } else {
        const name = probeEntries[settled.indexOf(item)]?.[0]
        if (name) {
          results.set(name, { available: false, latencyMs: null, error: String(item.reason) })
        }
      }
    }

    return results
  }

  private resolveState(results: Map<ServiceName, ServiceHealthResult>): ConnectivityState {
    const internetResult = results.get("internet")
    if (internetResult && !internetResult.available) {
      return "offline"
    }

    const unavailableCount = [...results.values()].filter((r) => !r.available).length
    if (unavailableCount === 0) {
      return "online"
    }

    if (unavailableCount >= OFFLINE_THRESHOLD_COUNT) {
      return "offline"
    }

    return "degraded"
  }

  private updateServiceMap(results: Map<ServiceName, ServiceHealthResult>): void {
    for (const [name, result] of results) {
      this.services.set(name, result.available)
    }
  }

  // ============================================================
  //  Built-in probes
  // ============================================================

  private async probeLLM(timeoutMs: number): Promise<ServiceHealthResult> {
    // Probe the first configured cloud LLM endpoint.
    // We use Groq as primary (fast, cheap probe) with OpenAI fallback.
    const groqKey = config.GROQ_API_KEY?.trim()
    if (groqKey && groqKey.length > 0) {
      return this.probeUrl(
        "https://api.groq.com/openai/v1/models",
        { Authorization: `Bearer ${groqKey}` },
        timeoutMs,
      )
    }

    const openAiKey = config.OPENAI_API_KEY?.trim()
    if (openAiKey && openAiKey.length > 0) {
      return this.probeUrl(
        "https://api.openai.com/v1/models",
        { Authorization: `Bearer ${openAiKey}` },
        timeoutMs,
      )
    }

    // No cloud LLM keys configured — assume offline (local-only intent).
    return { available: false, latencyMs: null, error: "no cloud LLM keys configured" }
  }

  private async probeInternet(timeoutMs: number): Promise<ServiceHealthResult> {
    // Lightweight check: HEAD request to a reliable CDN.
    return this.probeUrl("https://1.1.1.1", {}, timeoutMs, "HEAD")
  }

  private async probeUrl(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    method: "GET" | "HEAD" = "GET",
  ): Promise<ServiceHealthResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()

    try {
      const response = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
      })

      const latencyMs = Date.now() - startedAt
      const available = response.ok || response.status === 401 // 401 = key invalid but reachable
      return { available, latencyMs }
    } catch (error) {
      return {
        available: false,
        latencyMs: null,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

/** Singleton instance — import this everywhere instead of creating new instances. */
export const offlineCoordinator = new OfflineCoordinator()
