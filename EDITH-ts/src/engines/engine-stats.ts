/**
 * engine-stats.ts - Rolling performance tracker for LLM engines.
 *
 * Tracks per-engine latency (P50, P95) and error rate using a sliding window.
 * Used by orchestrator.ts for adaptive routing decisions.
 *
 * Persistence: stats are saved to `<DATA_DIR>/engine-stats.json` on each
 * `record()` call (debounced) and loaded on first access. This ensures
 * warm-start routing even after process restarts.
 */
import fs from "node:fs"
import path from "node:path"
import { createLogger } from "../logger.js"

const log = createLogger("engines.stats")

const PERSIST_DEBOUNCE_MS = 5_000

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
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private persistPath: string | null = null
  private loaded = false

  /**
   * Set the file path for stats persistence.
   * Resets the loaded flag so the next access triggers a fresh load from the new path.
   * Defaults to `logs/engine-stats.json` relative to CWD.
   */
  setPersistPath(filePath: string): void {
    this.persistPath = filePath
    this.loaded = false
  }

  private getDefaultPersistPath(): string {
    return path.resolve(process.cwd(), "logs", "engine-stats.json")
  }

  /**
   * Load previously saved stats from disk.
   * Called lazily on first `record()` or `getMetrics()` call.
   * Tolerates missing / corrupt files gracefully.
   */
  loadFromDisk(): void {
    if (this.loaded) {
      return
    }
    this.loaded = true

    const filePath = this.persistPath ?? this.getDefaultPersistPath()
    try {
      if (!fs.existsSync(filePath)) {
        return
      }
      const raw = fs.readFileSync(filePath, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, CallRecord[]>
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        log.warn("engine stats file has unexpected shape, ignoring", { filePath })
        return
      }

      let loadedCount = 0
      for (const [engineName, calls] of Object.entries(parsed)) {
        if (!Array.isArray(calls)) {
          continue
        }
        const validated = calls
          .filter((c) => typeof c.latencyMs === "number" && typeof c.success === "boolean" && typeof c.timestamp === "number")
          .slice(-WINDOW_SIZE)
        if (validated.length > 0) {
          this.records.set(engineName, validated)
          loadedCount += validated.length
        }
      }

      if (loadedCount > 0) {
        log.info("engine stats loaded from disk", { filePath, engines: this.records.size, records: loadedCount })
      }
    } catch (error) {
      log.warn("failed to load engine stats from disk", { filePath, error })
    }
  }

  /**
   * Debounced save to disk. Multiple rapid `record()` calls collapse into
   * a single write after PERSIST_DEBOUNCE_MS of quiescence.
   */
  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.saveToDisk()
    }, PERSIST_DEBOUNCE_MS)
  }

  saveToDisk(): void {
    const filePath = this.persistPath ?? this.getDefaultPersistPath()
    try {
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const data: Record<string, CallRecord[]> = {}
      for (const [name, calls] of this.records) {
        data[name] = calls
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
    } catch (error) {
      log.warn("failed to save engine stats to disk", { filePath, error })
    }
  }

  reset(engineName?: string): void {
    if (engineName) {
      this.records.delete(engineName)
      return
    }

    this.records.clear()
    // Mark as loaded so a fresh reset doesn't auto-reload stale disk data.
    this.loaded = true
  }

  record(engineName: string, latencyMs: number, success: boolean): void {
    this.loadFromDisk()

    if (!this.records.has(engineName)) {
      this.records.set(engineName, [])
    }

    const window = this.records.get(engineName)!
    window.push({ latencyMs, success, timestamp: Date.now() })

    if (window.length > WINDOW_SIZE) {
      window.splice(0, window.length - WINDOW_SIZE)
    }

    this.schedulePersist()
  }

  getMetrics(engineName: string): EngineMetrics {
    this.loadFromDisk()

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

    if (status === "degraded" && p50 < RECOVERY_LATENCY_P50_MS && errorRate < RECOVERY_ERROR_RATE) {
      status = "healthy"
    }

    return { p50LatencyMs: p50, p95LatencyMs: p95, errorRate, callCount: window.length, status }
  }

  /**
   * Rank engines from best to worst candidate.
   * Priority: healthy-with-data > unknown > degraded.
   */
  rankEngines(candidates: string[]): string[] {
    if (candidates.length === 0) {
      throw new Error("rankEngines: no candidates provided")
    }

    const ranked = candidates.map((name, index) => ({
      name,
      index,
      metrics: this.getMetrics(name),
    })).map((entry) => ({
      ...entry,
      bucket: this.getRankingBucket(entry.metrics),
    }))

    ranked.sort((a, b) => {
      if (a.bucket !== b.bucket) {
        return a.bucket - b.bucket
      }

      if (a.bucket === 0) {
        if (a.metrics.p50LatencyMs !== b.metrics.p50LatencyMs) {
          return a.metrics.p50LatencyMs - b.metrics.p50LatencyMs
        }
        if (a.metrics.errorRate !== b.metrics.errorRate) {
          return a.metrics.errorRate - b.metrics.errorRate
        }
        return a.index - b.index
      }

      if (a.bucket === 2) {
        if (a.metrics.errorRate !== b.metrics.errorRate) {
          return a.metrics.errorRate - b.metrics.errorRate
        }
        if (a.metrics.p50LatencyMs !== b.metrics.p50LatencyMs) {
          return a.metrics.p50LatencyMs - b.metrics.p50LatencyMs
        }
        return a.index - b.index
      }

      return a.index - b.index
    })

    const allDegraded = ranked.every((entry) => entry.bucket === 2)
    if (allDegraded) {
      log.warn("all engines degraded, using least-bad ranking", {
        firstEngine: ranked[0]?.name,
        firstErrorRate: ranked[0]?.metrics.errorRate,
      })
    }

    return ranked.map((entry) => entry.name)
  }

  /** Backward-compatible helper for legacy callers. */
  getBestEngine(candidates: string[]): string {
    return this.rankEngines(candidates)[0]
  }

  private getRankingBucket(metrics: EngineMetrics): number {
    if (metrics.status === "healthy" && metrics.callCount > 0) {
      return 0
    }

    if (metrics.status === "unknown") {
      return 1
    }

    return 2
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
