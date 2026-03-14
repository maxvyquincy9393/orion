/**
 * @file adaptive-router.ts
 * @description Tracks engine performance metrics and dynamically reorders routing priorities.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by engines/orchestrator.ts after each generate() call to record metrics.
 *   Periodically recalculates optimal routing order per TaskType using EMA of success rate,
 *   latency, and user satisfaction signals.
 *
 *   The static PRIORITY_MAP in orchestrator.ts always routes the same way. This module tracks
 *   actual engine performance and dynamically reorders priorities. It is strictly additive:
 *   the static PRIORITY_MAP remains the fallback when insufficient samples have been collected.
 *
 *   Composite scoring formula:
 *     score = 0.5 * successRate + 0.3 * (1 - normalizedLatency) + 0.2 * satisfaction
 *
 *   All metrics use Exponential Moving Averages (EMA) to weight recent observations more
 *   heavily while still accounting for historical performance.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"
import type { TaskType } from "./types.js"

const log = createLogger("engines.adaptive-router")

// ── Configuration constants ─────────────────────────────────────────────────

/**
 * Smoothing factor for Exponential Moving Average.
 * Higher values give more weight to recent observations.
 * 0.15 balances responsiveness with stability (~13 effective observations).
 */
const EMA_ALPHA = 0.15

/**
 * Minimum number of recorded observations per engine+taskType pair before
 * the adaptive router is allowed to override the static PRIORITY_MAP ordering.
 * Below this threshold, the static order is used as-is.
 */
const MIN_SAMPLES = 20

/**
 * Maximum latency (ms) used to normalize latency into a [0, 1] range.
 * Latencies above this value are clamped to 1.0 (worst).
 */
const MAX_LATENCY_MS = 30_000

/** Weight for success rate in the composite score. */
const WEIGHT_SUCCESS = 0.5

/** Weight for normalized latency (inverted: lower latency = higher score) in the composite score. */
const WEIGHT_LATENCY = 0.3

/** Weight for user satisfaction in the composite score. */
const WEIGHT_SATISFACTION = 0.2

/** Default file path for persisting adaptive router state across restarts. */
const STATE_FILE_PATH = path.resolve(".edith", "engines", "adaptive-router-state.json")

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Performance metrics tracked per engine+taskType pair.
 * All rate/score values are in [0, 1] range.
 */
export interface EngineTaskMetrics {
  /** EMA of success rate (1 = always successful, 0 = always failing). */
  successRate: number
  /** EMA of response latency in milliseconds. */
  avgLatencyMs: number
  /** EMA of user satisfaction (from MemRL feedback signals, default 0.5). */
  satisfactionScore: number
  /** Total number of observations recorded. */
  sampleCount: number
}

/** Composite key for the metrics map: "engineName:taskType". */
type MetricsKey = string

/** Diagnostic snapshot of all tracked metrics. */
export interface AdaptiveRouterStats {
  /** All tracked metrics keyed by "engineName:taskType". */
  metrics: Record<string, EngineTaskMetrics>
  /** The minimum sample threshold before adaptive routing activates. */
  minSamples: number
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a composite key for the metrics map.
 * @param engineName - Name of the engine (e.g. "groq", "anthropic").
 * @param taskType   - The task type (e.g. "reasoning", "fast").
 * @returns Composite key string.
 */
function buildKey(engineName: string, taskType: TaskType): MetricsKey {
  return `${engineName}:${taskType}`
}

/**
 * Update an EMA value with a new observation.
 * @param current - Current EMA value.
 * @param observed - New observation.
 * @param alpha   - Smoothing factor.
 * @returns Updated EMA value.
 */
function updateEma(current: number, observed: number, alpha: number): number {
  return alpha * observed + (1 - alpha) * current
}

/**
 * Normalize a latency value to a [0, 1] range.
 * @param latencyMs - Raw latency in milliseconds.
 * @returns Normalized value where 0 = instant, 1 = MAX_LATENCY_MS or above.
 */
function normalizeLatency(latencyMs: number): number {
  return Math.min(latencyMs / MAX_LATENCY_MS, 1.0)
}

/**
 * Compute the composite routing score for an engine+taskType pair.
 * Higher score = better candidate.
 *
 * @param metrics - The tracked metrics for this pair.
 * @returns Composite score in [0, 1] range.
 */
function computeCompositeScore(metrics: EngineTaskMetrics): number {
  const latencyComponent = 1 - normalizeLatency(metrics.avgLatencyMs)
  return (
    WEIGHT_SUCCESS * metrics.successRate +
    WEIGHT_LATENCY * latencyComponent +
    WEIGHT_SATISFACTION * metrics.satisfactionScore
  )
}

// ── AdaptiveRouter class ────────────────────────────────────────────────────

/**
 * Tracks per-engine, per-taskType performance metrics using EMA and provides
 * dynamically reordered engine priority lists based on composite scoring.
 *
 * The router is strictly additive: when insufficient samples exist for a given
 * engine+taskType pair, the static PRIORITY_MAP order from orchestrator.ts is
 * preserved. Only after MIN_SAMPLES observations does the adaptive order take
 * effect.
 */
class AdaptiveRouter {
  /** Performance metrics indexed by "engineName:taskType". */
  private readonly metrics = new Map<MetricsKey, EngineTaskMetrics>()

  /**
   * Record a generation metric for an engine+taskType pair.
   * Updates the EMA for success rate, latency, and optionally satisfaction.
   *
   * @param engineName   - Name of the engine that handled the request.
   * @param taskType     - The task type that was routed.
   * @param latencyMs    - Wall-clock latency of the generation in milliseconds.
   * @param success      - Whether the generation produced a valid, non-empty response.
   * @param satisfaction - Optional user satisfaction signal from MemRL (0 to 1). Omit to leave unchanged.
   */
  recordMetric(
    engineName: string,
    taskType: TaskType,
    latencyMs: number,
    success: boolean,
    satisfaction?: number,
  ): void {
    const key = buildKey(engineName, taskType)
    const existing = this.metrics.get(key)

    if (!existing) {
      // First observation: initialize with raw values.
      const initialMetrics: EngineTaskMetrics = {
        successRate: success ? 1.0 : 0.0,
        avgLatencyMs: latencyMs,
        satisfactionScore: satisfaction ?? 0.5,
        sampleCount: 1,
      }
      this.metrics.set(key, initialMetrics)

      log.debug("adaptive router: first metric recorded", {
        engine: engineName,
        taskType,
        latencyMs,
        success,
      })
      return
    }

    // Update EMAs with new observation.
    existing.successRate = updateEma(existing.successRate, success ? 1.0 : 0.0, EMA_ALPHA)
    existing.avgLatencyMs = updateEma(existing.avgLatencyMs, latencyMs, EMA_ALPHA)

    if (satisfaction !== undefined) {
      existing.satisfactionScore = updateEma(existing.satisfactionScore, satisfaction, EMA_ALPHA)
    }

    existing.sampleCount += 1

    log.debug("adaptive router: metric updated", {
      engine: engineName,
      taskType,
      sampleCount: existing.sampleCount,
      successRate: existing.successRate.toFixed(3),
      avgLatencyMs: Math.round(existing.avgLatencyMs),
      satisfactionScore: existing.satisfactionScore.toFixed(3),
    })
  }

  /**
   * Return the optimal engine ordering for a given task type, sorted by composite score.
   *
   * Only engines that have accumulated at least MIN_SAMPLES observations are ranked
   * adaptively. Engines below the threshold are excluded from the adaptive ordering;
   * callers should fall back to the static PRIORITY_MAP for those.
   *
   * @param taskType       - The task type to optimize for.
   * @param candidateNames - Engine names to consider (typically from PRIORITY_MAP).
   * @returns Engine names sorted best-first by composite score. May be empty if no
   *          engine has reached MIN_SAMPLES for this taskType.
   */
  getOptimalOrder(taskType: TaskType, candidateNames: readonly string[]): string[] {
    const scored: Array<{ name: string; score: number }> = []

    for (const name of candidateNames) {
      const key = buildKey(name, taskType)
      const m = this.metrics.get(key)

      if (!m || m.sampleCount < MIN_SAMPLES) {
        continue
      }

      scored.push({ name, score: computeCompositeScore(m) })
    }

    if (scored.length === 0) {
      return []
    }

    // Sort descending by composite score (highest = best).
    scored.sort((a, b) => b.score - a.score)

    log.debug("adaptive order computed", {
      taskType,
      order: scored.map((s) => `${s.name}(${s.score.toFixed(3)})`).join(", "),
    })

    return scored.map((s) => s.name)
  }

  /**
   * Check whether the adaptive router has enough data to override static routing
   * for at least one engine in the given candidate list.
   *
   * @param taskType       - The task type to check.
   * @param candidateNames - Engine names to check.
   * @returns True if at least one engine has >= MIN_SAMPLES observations.
   */
  hasAdaptiveData(taskType: TaskType, candidateNames: readonly string[]): boolean {
    for (const name of candidateNames) {
      const key = buildKey(name, taskType)
      const m = this.metrics.get(key)
      if (m && m.sampleCount >= MIN_SAMPLES) {
        return true
      }
    }
    return false
  }

  /**
   * Return the current metrics for a specific engine+taskType pair.
   * Returns null if no metrics have been recorded for this pair.
   *
   * @param engineName - Name of the engine.
   * @param taskType   - The task type.
   * @returns Metrics snapshot or null.
   */
  getMetrics(engineName: string, taskType: TaskType): EngineTaskMetrics | null {
    return this.metrics.get(buildKey(engineName, taskType)) ?? null
  }

  /**
   * Return a diagnostic snapshot of all tracked metrics.
   * Intended for health checks, debugging endpoints, and tests.
   *
   * @returns AdaptiveRouterStats with all metrics and the min-samples threshold.
   */
  getStats(): AdaptiveRouterStats {
    const metricsRecord: Record<string, EngineTaskMetrics> = {}

    for (const [key, value] of this.metrics) {
      metricsRecord[key] = { ...value }
    }

    return {
      metrics: metricsRecord,
      minSamples: MIN_SAMPLES,
    }
  }

  /**
   * Clear all tracked metrics. Intended for testing only.
   */
  reset(): void {
    this.metrics.clear()
    log.debug("adaptive router reset")
  }

  /**
   * Serialize the in-memory metrics map to a JSON file at `.edith/engines/adaptive-router-state.json`.
   * Creates parent directories if they do not exist.
   * Intended to be called on graceful shutdown so metrics survive restarts.
   */
  async saveState(): Promise<void> {
    try {
      const serializable: Record<string, EngineTaskMetrics> = {}
      for (const [key, value] of this.metrics) {
        serializable[key] = { ...value }
      }

      await mkdir(path.dirname(STATE_FILE_PATH), { recursive: true })
      await writeFile(STATE_FILE_PATH, JSON.stringify(serializable, null, 2), "utf-8")
      log.info("adaptive router state saved", { entries: this.metrics.size, path: STATE_FILE_PATH })
    } catch (err) {
      log.warn("failed to save adaptive router state", {
        path: STATE_FILE_PATH,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Restore the metrics map from the persisted JSON state file.
   * Gracefully degrades: if the file is missing, empty, or corrupt the router
   * continues with an empty metrics map and logs a warning.
   * Intended to be called once during startup before any generate() calls.
   */
  async loadState(): Promise<void> {
    try {
      const raw = await readFile(STATE_FILE_PATH, "utf-8")
      const parsed: unknown = JSON.parse(raw)

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        log.warn("adaptive router state file has invalid root type, starting fresh", { path: STATE_FILE_PATH })
        return
      }

      let restored = 0
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!this.isValidMetrics(value)) {
          log.debug("skipping invalid metrics entry during load", { key })
          continue
        }
        this.metrics.set(key, value as EngineTaskMetrics)
        restored += 1
      }

      log.info("adaptive router state loaded", { restored, path: STATE_FILE_PATH })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ENOENT") {
        log.info("no adaptive router state file found, starting fresh", { path: STATE_FILE_PATH })
        return
      }
      log.warn("failed to load adaptive router state, starting fresh", {
        path: STATE_FILE_PATH,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Validates that an unknown value conforms to the EngineTaskMetrics shape.
   * @param value - Value to check.
   * @returns True if value has the required numeric fields.
   */
  private isValidMetrics(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false
    }
    const record = value as Record<string, unknown>
    return (
      typeof record.successRate === "number" &&
      typeof record.avgLatencyMs === "number" &&
      typeof record.satisfactionScore === "number" &&
      typeof record.sampleCount === "number"
    )
  }
}

/** Singleton adaptive router instance. */
export const adaptiveRouter = new AdaptiveRouter()
