/**
 * engine-stats.ts — Rolling performance tracker for LLM engines.
 *
 * Tracks per-engine latency (P50, P95) and error rate using a sliding window.
 * Used by orchestrator.ts for adaptive routing decisions.
 *
 * Priority order: healthy (low latency) > healthy (unknown) > degraded
 * "unknown" is medium priority — better than degraded but needs data first.
 *
 * Refs: arXiv 2503.09876
 * @module engines/engine-stats
 */
import { createLogger } from "../logger.js"

const log = createLogger("engines.stats")

const WINDOW_SIZE = 20
const DEGRADED_LATENCY_P50_MS = 5_000
const DEGRADED_ERROR_RATE = 0.3
const RECOVERY_LATENCY_P50_MS = 2_500
const RECOVERY_ERROR_RATE = 0.1

export type EngineStatus = "healthy" | "degraded" | "unknown"

interface CallRecord {
  latencyMs: number
  success: boolean
  timestamp: number
}

export interface EngineMetrics {
  p50LatencyMs: number
  p95LatencyMs: number
  errorRate: number
  callCount: number
  status: EngineStatus
}

class EngineStatsTracker {
  private readonly records = new Map<string, CallRecord[]>()

  record(engineName: string, latencyMs: number, success: boolean): void {
    if (!this.records.has(engineName)) {
      this.records.set(engineName, [])
    }
    const window = this.records.get(engineName)!
    window.push({ latencyMs, success, timestamp: Date.now() })
    if (window.length > WINDOW_SIZE) {
      window.splice(0, window.length - WINDOW_SIZE)
    }
  }

  getMetrics(engineName: string): EngineMetrics {
    const window = this.records.get(engineName)
    if (!window || window.length === 0) {
      return { p50LatencyMs: 0, p95LatencyMs: 0, errorRate: 0, callCount: 0, status: "unknown" }
    }

    const latencies = window.map((r) => r.latencyMs).sort((a, b) => a - b)
    const errorCount = window.filter((r) => !r.success).length
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0
    const errorRate = errorCount / window.length

    let status: EngineStatus = "healthy"
    if (p50 > DEGRADED_LATENCY_P50_MS || errorRate > DEGRADED_ERROR_RATE) {
      status = "degraded"
    }
    // Recovery: must be below recovery thresholds to return to healthy
    if (status === "degraded" && p50 < RECOVERY_LATENCY_P50_MS && errorRate < RECOVERY_ERROR_RATE) {
      status = "healthy"
    }

    return { p50LatencyMs: p50, p95LatencyMs: p95, errorRate, callCount: window.length, status }
  }

  /**
   * Get healthiest engine from candidates.
   *
   * Priority: healthy (proven fast) > healthy (no data yet) > degraded (least bad)
   *
   * "unknown" is NOT automatically preferred — untested engines are medium priority.
   * We prefer engines with proven low latency over unproven ones.
   */
  getBestEngine(candidates: string[]): string {
    if (candidates.length === 0) {
      throw new Error("getBestEngine: no candidates provided")
    }

    const withMetrics = candidates.map((name) => ({
      name,
      metrics: this.getMetrics(name),
    }))

    // Separate into buckets
    const healthyWithData = withMetrics.filter(
      (e) => e.metrics.status === "healthy" && e.metrics.callCount > 0,
    )
    const healthyNoData = withMetrics.filter(
      (e) => e.metrics.status === "unknown",
    )
    const degraded = withMetrics.filter(
      (e) => e.metrics.status === "degraded",
    )

    // Prefer proven healthy engines by P50 latency
    if (healthyWithData.length > 0) {
      return healthyWithData.sort((a, b) => a.metrics.p50LatencyMs - b.metrics.p50LatencyMs)[0].name
    }

    // No proven healthy engines — try unproven ones (round-robin via first in list)
    if (healthyNoData.length > 0) {
      return healthyNoData[0].name
    }

    // All degraded — pick least-bad by error rate
    const sorted = degraded.sort((a, b) => a.metrics.errorRate - b.metrics.errorRate)
    log.warn("all engines degraded, using least-bad", {
      engine: sorted[0].name,
      errorRate: sorted[0].metrics.errorRate,
    })
    return sorted[0].name
  }

  logStatus(): void {
    for (const [name] of this.records) {
      const m = this.getMetrics(name)
      log.info("engine stats", {
        engine: name,
        p50: m.p50LatencyMs,
        p95: m.p95LatencyMs,
        errorRate: m.errorRate.toFixed(2),
        status: m.status,
        calls: m.callCount,
      })
    }
  }
}

export const engineStats = new EngineStatsTracker()
