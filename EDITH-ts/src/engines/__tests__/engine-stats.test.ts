import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { engineStats } from "../engine-stats.js"

describe("engine-stats ranking", () => {
  beforeEach(() => {
    engineStats.reset()
  })

  afterEach(() => {
    engineStats.reset()
  })

  it("ranks healthy engines by lower p50 latency", () => {
    engineStats.record("slow", 600, true)
    engineStats.record("slow", 650, true)
    engineStats.record("fast", 120, true)
    engineStats.record("fast", 150, true)

    const ranked = engineStats.rankEngines(["slow", "fast", "unknown"])
    expect(ranked).toEqual(["fast", "slow", "unknown"])
  })

  it("prefers unknown engines over degraded engines", () => {
    engineStats.record("degraded", 300, false)
    engineStats.record("degraded", 320, false)
    engineStats.record("degraded", 340, false)

    const ranked = engineStats.rankEngines(["degraded", "unknown"])
    expect(ranked).toEqual(["unknown", "degraded"])
  })

  it("orders degraded engines by lower error rate then latency", () => {
    engineStats.record("degradedA", 200, false)
    engineStats.record("degradedA", 220, false)
    engineStats.record("degradedA", 240, false)

    engineStats.record("degradedB", 180, true)
    engineStats.record("degradedB", 180, false)
    engineStats.record("degradedB", 180, false)

    const ranked = engineStats.rankEngines(["degradedA", "degradedB"])
    expect(ranked).toEqual(["degradedB", "degradedA"])
    expect(engineStats.getBestEngine(["degradedA", "degradedB"])).toBe("degradedB")
  })
})
