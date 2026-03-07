import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import config from "../../config.js"
import { engineStats } from "../engine-stats.js"
import { Orchestrator } from "../orchestrator.js"
import type { Engine, GenerateOptions } from "../types.js"

type EngineBehavior = (options: GenerateOptions) => Promise<string>

function makeEngine(name: string, behavior: EngineBehavior): Engine {
  return {
    name,
    provider: `${name}-provider`,
    defaultModel: `${name}-model`,
    isAvailable: () => true,
    generate: behavior,
  }
}

function installEngines(orchestrator: Orchestrator, engines: Engine[]): void {
  const engineMap = (orchestrator as unknown as { engines: Map<string, Engine> }).engines
  engineMap.clear()
  for (const engine of engines) {
    engineMap.set(engine.name, engine)
  }
}

describe("Orchestrator", () => {
  let originalEngineStatsEnabled: boolean
  let originalCostRoutingEnabled: boolean

  beforeEach(() => {
    originalEngineStatsEnabled = config.ENGINE_STATS_ENABLED
    originalCostRoutingEnabled = config.ORCHESTRATOR_COST_ROUTING_ENABLED
    config.ENGINE_STATS_ENABLED = false
    config.ORCHESTRATOR_COST_ROUTING_ENABLED = false
    engineStats.reset()
  })

  afterEach(() => {
    config.ENGINE_STATS_ENABLED = originalEngineStatsEnabled
    config.ORCHESTRATOR_COST_ROUTING_ENABLED = originalCostRoutingEnabled
    engineStats.reset()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("routes to OpenRouter when it is the only available reasoning engine", () => {
    const orchestrator = new Orchestrator()
    const openRouter = makeEngine("openrouter", async () => "ok")
    installEngines(orchestrator, [openRouter])

    const selected = orchestrator.route("reasoning")

    expect(selected.name).toBe("openrouter")
  })

  it("falls back to the next engine when the first engine throws", async () => {
    const orchestrator = new Orchestrator()
    const groq = makeEngine("groq", async () => {
      throw new Error("groq unavailable")
    })
    const openRouter = makeEngine("openrouter", async () => "fallback response")
    installEngines(orchestrator, [groq, openRouter])

    const output = await orchestrator.generate("reasoning", { prompt: "hello" })

    expect(output).toBe("fallback response")
    expect(orchestrator.getLastUsedEngine()).toEqual({
      provider: "openrouter-provider",
      model: "openrouter-model",
    })
  })

  it("falls back when an engine returns an empty response", async () => {
    const orchestrator = new Orchestrator()
    const groq = makeEngine("groq", async () => "   ")
    const openRouter = makeEngine("openrouter", async () => "recovered")
    installEngines(orchestrator, [groq, openRouter])

    const output = await orchestrator.generate("reasoning", { prompt: "hello" })

    expect(output).toBe("recovered")
    const groqMetrics = engineStats.getMetrics("groq")
    const openRouterMetrics = engineStats.getMetrics("openrouter")
    expect(groqMetrics.callCount).toBe(1)
    expect(groqMetrics.errorRate).toBe(1)
    expect(openRouterMetrics.callCount).toBe(1)
    expect(openRouterMetrics.errorRate).toBe(0)
  })

  it("retries once with backoff on transient 429 before succeeding", async () => {
    vi.useFakeTimers()

    const orchestrator = new Orchestrator()
    let groqCalls = 0
    const groq = makeEngine("groq", async () => {
      groqCalls += 1
      if (groqCalls === 1) {
        const error = Object.assign(new Error("rate limit"), { status: 429 })
        throw error
      }
      return "recovered after retry"
    })

    installEngines(orchestrator, [groq])

    const runPromise = orchestrator.generate("reasoning", { prompt: "hello" })
    await vi.runAllTimersAsync()
    await expect(runPromise).resolves.toBe("recovered after retry")
    expect(groqCalls).toBe(2)
  })

  it("opens circuit after repeated failures and skips unhealthy engine", async () => {
    const orchestrator = new Orchestrator()
    let groqCalls = 0
    let fallbackCalls = 0

    const groq = makeEngine("groq", async () => {
      groqCalls += 1
      throw new Error("groq unavailable")
    })
    const openRouter = makeEngine("openrouter", async () => {
      fallbackCalls += 1
      return "fallback response"
    })

    installEngines(orchestrator, [groq, openRouter])

    for (let i = 0; i < 5; i += 1) {
      const output = await orchestrator.generate("reasoning", { prompt: "hello" })
      expect(output).toBe("fallback response")
    }

    // Circuit should now be open for groq; next call should skip it.
    const output = await orchestrator.generate("reasoning", { prompt: "hello" })
    expect(output).toBe("fallback response")
    expect(groqCalls).toBe(5)
    expect(fallbackCalls).toBe(6)
  })

  it("allows engine probe again after cooldown and closes on success", async () => {
    const orchestrator = new Orchestrator()
    let groqCalls = 0
    let fallbackCalls = 0
    let now = 0
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now)

    const groq = makeEngine("groq", async () => {
      groqCalls += 1
      if (groqCalls <= 5) {
        throw new Error("temporary outage")
      }
      return "recovered"
    })
    const openRouter = makeEngine("openrouter", async () => {
      fallbackCalls += 1
      return "fallback"
    })

    installEngines(orchestrator, [groq, openRouter])

    for (let i = 0; i < 5; i += 1) {
      const output = await orchestrator.generate("reasoning", { prompt: "hello" })
      expect(output).toBe("fallback")
    }

    // Still in cooldown; groq should remain skipped.
    now = 30_000
    expect(await orchestrator.generate("reasoning", { prompt: "hello" })).toBe("fallback")
    expect(groqCalls).toBe(5)

    // Cooldown expired; groq should be probed and recover.
    now = 61_000
    expect(await orchestrator.generate("reasoning", { prompt: "hello" })).toBe("recovered")
    expect(groqCalls).toBe(6)

    // Circuit should be closed now; groq continues serving.
    now = 62_000
    expect(await orchestrator.generate("reasoning", { prompt: "hello" })).toBe("recovered")
    expect(groqCalls).toBe(7)

    expect(fallbackCalls).toBe(6)
    nowSpy.mockRestore()
  })

  it("prefers cheaper engines for fast tasks when cost routing is enabled", async () => {
    config.ENGINE_STATS_ENABLED = true
    config.ORCHESTRATOR_COST_ROUTING_ENABLED = true

    const orchestrator = new Orchestrator()
    const anthropic = makeEngine("anthropic", async () => "anthropic response")
    const groq = makeEngine("groq", async () => "groq response")
    installEngines(orchestrator, [anthropic, groq])

    vi.spyOn(engineStats, "rankEngines").mockReturnValue(["anthropic", "groq"])

    const output = await orchestrator.generate("fast", { prompt: "quick summary" })
    expect(output).toBe("groq response")
  })
})
