import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

import { engineStats } from "../engine-stats.js"

describe("engine-stats persistence", () => {
  let tmpDir: string
  let persistPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "edith-stats-"))
    persistPath = path.join(tmpDir, "engine-stats.json")
    engineStats.reset()
    engineStats.setPersistPath(persistPath)
  })

  afterEach(() => {
    engineStats.reset()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch { /* ignore cleanup errors */ }
  })

  it("saves stats to disk via saveToDisk()", () => {
    engineStats.record("openai", 200, true)
    engineStats.record("openai", 250, true)
    engineStats.record("anthropic", 300, false)

    engineStats.saveToDisk()

    expect(fs.existsSync(persistPath)).toBe(true)
    const raw = fs.readFileSync(persistPath, "utf-8")
    const data = JSON.parse(raw)
    expect(data.openai).toHaveLength(2)
    expect(data.anthropic).toHaveLength(1)
    expect(data.openai[0].latencyMs).toBe(200)
    expect(data.anthropic[0].success).toBe(false)
  })

  it("loads stats from disk on first access", () => {
    // Write a pre-existing stats file
    const existingData = {
      gemini: [
        { latencyMs: 150, success: true, timestamp: Date.now() - 1000 },
        { latencyMs: 180, success: true, timestamp: Date.now() },
      ],
    }
    fs.mkdirSync(path.dirname(persistPath), { recursive: true })
    fs.writeFileSync(persistPath, JSON.stringify(existingData), "utf-8")

    // Reset and re-configure so loadFromDisk is triggered
    engineStats.reset()
    engineStats.setPersistPath(persistPath)

    const metrics = engineStats.getMetrics("gemini")
    expect(metrics.callCount).toBe(2)
    expect(metrics.status).toBe("healthy")
    expect(metrics.p50LatencyMs).toBe(180)
  })

  it("tolerates missing stats file gracefully", () => {
    engineStats.reset()
    engineStats.setPersistPath(path.join(tmpDir, "nonexistent.json"))

    const metrics = engineStats.getMetrics("anything")
    expect(metrics.status).toBe("unknown")
    expect(metrics.callCount).toBe(0)
  })

  it("tolerates corrupt stats file gracefully", () => {
    fs.mkdirSync(path.dirname(persistPath), { recursive: true })
    fs.writeFileSync(persistPath, "not valid json{{{", "utf-8")

    engineStats.reset()
    engineStats.setPersistPath(persistPath)

    const metrics = engineStats.getMetrics("foo")
    expect(metrics.status).toBe("unknown")
  })

  it("validates call records on load (ignores malformed entries)", () => {
    const data = {
      valid: [
        { latencyMs: 100, success: true, timestamp: Date.now() },
      ],
      invalid: [
        { latencyMs: "not a number", success: true, timestamp: Date.now() },
        { success: true, timestamp: Date.now() }, // missing latencyMs
        { latencyMs: 100, success: "yes", timestamp: Date.now() }, // success not bool
      ],
    }
    fs.mkdirSync(path.dirname(persistPath), { recursive: true })
    fs.writeFileSync(persistPath, JSON.stringify(data), "utf-8")

    engineStats.reset()
    engineStats.setPersistPath(persistPath)

    expect(engineStats.getMetrics("valid").callCount).toBe(1)
    expect(engineStats.getMetrics("invalid").callCount).toBe(0)
  })

  it("round-trips data through save/load cycle", () => {
    engineStats.record("openai", 200, true)
    engineStats.record("openai", 250, false)
    engineStats.record("anthropic", 300, true)

    engineStats.saveToDisk()

    // Create a fresh load
    engineStats.reset()
    engineStats.setPersistPath(persistPath)

    const openaiMetrics = engineStats.getMetrics("openai")
    expect(openaiMetrics.callCount).toBe(2)
    expect(openaiMetrics.errorRate).toBeCloseTo(0.5)

    const anthropicMetrics = engineStats.getMetrics("anthropic")
    expect(anthropicMetrics.callCount).toBe(1)
    expect(anthropicMetrics.errorRate).toBe(0)
  })

  it("limits loaded records to WINDOW_SIZE", () => {
    const records = Array.from({ length: 50 }, (_, i) => ({
      latencyMs: 100 + i,
      success: true,
      timestamp: Date.now() - (50 - i) * 1000,
    }))
    const data = { overloaded: records }
    fs.mkdirSync(path.dirname(persistPath), { recursive: true })
    fs.writeFileSync(persistPath, JSON.stringify(data), "utf-8")

    engineStats.reset()
    engineStats.setPersistPath(persistPath)

    const metrics = engineStats.getMetrics("overloaded")
    expect(metrics.callCount).toBe(20) // WINDOW_SIZE
  })
})
