/**
 * @file circuit-breaker.ts
 * @description Circuit breaker for channel send operations. Prevents cascading
 *   failures when a channel API is temporarily unavailable.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - ChannelManager.send() wraps each channel send through execute().
 *   - States: closed (normal) → open (3 consecutive failures, 60s cooldown) → half-open (single probe).
 *
 * PATTERN REFERENCE:
 *   - Standard circuit breaker pattern (Michael Nygard, "Release It!")
 */

import { createLogger } from "../logger.js"
import { edithMetrics } from "../observability/metrics.js"

const log = createLogger("channels.circuit-breaker")

/** Circuit breaker state. */
type CircuitState = "closed" | "open" | "half-open"

/** Configuration thresholds. */
interface CircuitBreakerThresholds {
  /** Consecutive failures before opening the circuit. */
  failures: number
  /** Cooldown in ms before transitioning from open → half-open. */
  cooldownMs: number
}

/** Per-channel circuit state. */
interface ChannelCircuit {
  state: CircuitState
  consecutiveFailures: number
  lastFailureAt: number
  openedAt: number | null
}

/** Default thresholds. */
const DEFAULT_THRESHOLDS: CircuitBreakerThresholds = {
  failures: 3,
  cooldownMs: 60_000,
}

/**
 * Circuit breaker that wraps channel send operations.
 * After `thresholds.failures` consecutive failures the circuit opens,
 * rejecting all calls for `thresholds.cooldownMs`. After cooldown it
 * transitions to half-open, allowing a single probe call.
 */
export class ChannelCircuitBreaker {
  private circuits = new Map<string, ChannelCircuit>()

  constructor(private thresholds: CircuitBreakerThresholds = DEFAULT_THRESHOLDS) {}

  /**
   * Execute `fn` through the circuit breaker for `channelId`.
   * @throws Error if the circuit is open (caller should handle gracefully).
   */
  async execute<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
    const circuit = this.getOrCreate(channelId)

    if (circuit.state === "open") {
      const elapsed = Date.now() - (circuit.openedAt ?? 0)
      if (elapsed < this.thresholds.cooldownMs) {
        throw new Error(`Circuit open for channel '${channelId}' — retry after ${this.thresholds.cooldownMs - elapsed}ms`)
      }
      // Transition to half-open
      circuit.state = "half-open"
      log.info("circuit half-open, probing", { channelId })
    }

    try {
      const result = await fn()
      this.onSuccess(channelId, circuit)
      return result
    } catch (err) {
      this.onFailure(channelId, circuit)
      throw err
    }
  }

  /** Get the current circuit state for a channel. */
  getState(channelId: string): CircuitState {
    return this.circuits.get(channelId)?.state ?? "closed"
  }

  /** Manually reset a channel's circuit to closed. */
  reset(channelId: string): void {
    this.circuits.delete(channelId)
    log.info("circuit manually reset", { channelId })
  }

  private getOrCreate(channelId: string): ChannelCircuit {
    let circuit = this.circuits.get(channelId)
    if (!circuit) {
      circuit = {
        state: "closed",
        consecutiveFailures: 0,
        lastFailureAt: 0,
        openedAt: null,
      }
      this.circuits.set(channelId, circuit)
    }
    return circuit
  }

  private onSuccess(channelId: string, circuit: ChannelCircuit): void {
    const prevState = circuit.state
    if (prevState === "half-open") {
      log.info("circuit closed after successful probe", { channelId })
    }
    circuit.state = "closed"
    circuit.consecutiveFailures = 0
    circuit.openedAt = null
    if (prevState === "half-open" || prevState === "open") {
      edithMetrics.circuitBreakerTransitions.inc({ channel: channelId, from: prevState, to: "closed" })
    }
  }

  private onFailure(channelId: string, circuit: ChannelCircuit): void {
    circuit.consecutiveFailures++
    circuit.lastFailureAt = Date.now()

    if (circuit.state === "half-open") {
      const prevState = circuit.state
      circuit.state = "open"
      circuit.openedAt = Date.now()
      log.warn("circuit re-opened after half-open probe failure", { channelId })
      edithMetrics.circuitBreakerOpenTotal.inc({ channel: channelId })
      edithMetrics.circuitBreakerTransitions.inc({ channel: channelId, from: prevState, to: "open" })
      return
    }

    if (circuit.consecutiveFailures >= this.thresholds.failures) {
      const prevState = circuit.state
      circuit.state = "open"
      circuit.openedAt = Date.now()
      log.warn("circuit opened", {
        channelId,
        failures: circuit.consecutiveFailures,
        cooldownMs: this.thresholds.cooldownMs,
      })
      edithMetrics.circuitBreakerOpenTotal.inc({ channel: channelId })
      edithMetrics.circuitBreakerTransitions.inc({ channel: channelId, from: prevState, to: "open" })
    }
  }
}

export const channelCircuitBreaker = new ChannelCircuitBreaker()
