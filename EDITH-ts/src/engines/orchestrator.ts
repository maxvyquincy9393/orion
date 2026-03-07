/**
 * Orchestrator - multi-provider LLM routing with adaptive selection and fallback.
 *
 * Routes each request to the most appropriate LLM engine based on:
 *   - task type priority order
 *   - engine availability
 *   - rolling engine performance (when ENGINE_STATS_ENABLED=true)
 *   - fallback attempts when an engine errors or returns an empty response
 *
 * Supported providers: Anthropic, OpenAI, Gemini, Groq, OpenRouter, Ollama
 *
 * After every successful generation, lastUsedEngine is updated. Callers (pipeline)
 * read this to record accurate telemetry. Never hardcode provider names in callers.
 *
 * @module engines/orchestrator
 */

import config from "../config.js"
import { createLogger } from "../logger.js"
import { anthropicEngine } from "./anthropic.js"
import { engineStats } from "./engine-stats.js"
import { geminiEngine } from "./gemini.js"
import { groqEngine } from "./groq.js"
import { ollamaEngine } from "./ollama.js"
import { openAIEngine } from "./openai.js"
import { openRouterEngine } from "./openrouter.js"
import { modelPreferences } from "./model-preferences.js"
import type { Engine, GenerateOptions, TaskType } from "./types.js"
import { observeEngineCall } from "../observability/metrics.js"
import { withSpan } from "../observability/tracing.js"

const log = createLogger("engines.orchestrator")
const ENGINE_TIMEOUT_MS = 30_000
const CIRCUIT_FAILURE_THRESHOLD = 5
const CIRCUIT_COOLDOWN_MS = 60_000
const ENGINE_RETRY_MAX_ATTEMPTS = 2
const ENGINE_RETRY_BASE_DELAY_MS = 1_000
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const ENGINE_COST_ESTIMATE_PER_1K: Record<string, number> = {
  groq: 0.1,
  ollama: 0.02,
  gemini: 0.18,
  openrouter: 0.25,
  openai: 0.4,
  anthropic: 0.55,
}

const DEFAULT_ENGINE_CANDIDATES: readonly Engine[] = [
  anthropicEngine,
  openAIEngine,
  geminiEngine,
  groqEngine,
  openRouterEngine,
  ollamaEngine,
]

const PRIORITY_MAP: Record<TaskType, readonly string[]> = {
  reasoning: ["gemini", "groq", "anthropic", "openai", "openrouter", "ollama"],
  code: ["groq", "gemini", "anthropic", "openai", "openrouter", "ollama"],
  fast: ["groq", "gemini", "openrouter", "ollama", "openai", "anthropic"],
  multimodal: ["gemini", "openai", "anthropic", "openrouter"],
  local: ["ollama"],
}

type LastUsedEngine = { provider: string; model: string }

interface GenerateAttemptFailure {
  engineName: string
  error: unknown
}

interface CircuitState {
  consecutiveFailures: number
  openUntil: number
}

export class Orchestrator {
  private readonly engines = new Map<string, Engine>()
  private readonly circuits = new Map<string, CircuitState>()
  private lastUsed: LastUsedEngine | null = null

  /**
   * Returns the provider and model used for the most recent generate() call.
   * Returns null if no generation has occurred yet.
   */
  getLastUsedEngine(): LastUsedEngine | null {
    return this.lastUsed
  }

  async init(): Promise<void> {
    this.engines.clear()

    for (const engine of DEFAULT_ENGINE_CANDIDATES) {
      await this.registerIfAvailable(engine)
    }
  }

  getAvailableEngines(): string[] {
    return [...this.engines.keys()]
  }

  /** Get all available engine instances for external access (e.g. model catalog). */
  getEngineMap(): ReadonlyMap<string, Engine> {
    return this.engines
  }

  route(task: TaskType): Engine {
    const engine = this.resolveStaticRoute(task)
    if (!engine) {
      throw this.createNoEngineError(task)
    }
    return engine
  }

  /**
   * Generate with user-specific model preferences applied.
   * Falls back to standard task-based routing if no preference is set.
   */
  async generateForUser(userId: string, task: TaskType, options: GenerateOptions): Promise<string> {
    const pref = modelPreferences.get(userId)

    if (pref?.engine) {
      const engine = this.engines.get(pref.engine)
      if (engine) {
        const overriddenOptions = pref.model
          ? { ...options, model: pref.model }
          : options

        log.info("using user model preference", {
          userId,
          engine: pref.engine,
          model: pref.model ?? "default",
        })

        // Try preferred engine first, fall back to normal routing on failure
        try {
          return await this.generateWithEngine(engine, task, overriddenOptions)
        } catch (error) {
          log.warn("preferred engine failed, falling back to auto", {
            userId,
            engine: pref.engine,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } else {
        log.warn("preferred engine not available", { userId, engine: pref.engine })
      }
    }

    return this.generate(task, options)
  }

  /** Generate with a specific engine (used by generateForUser). */
  private async generateWithEngine(engine: Engine, task: TaskType, options: GenerateOptions): Promise<string> {
    if (this.isCircuitOpen(engine.name)) {
      throw new Error(`Engine '${engine.name}' circuit is open`)
    }

    const startedAt = Date.now()
    try {
      const output = await withSpan("engine.call", {
        engine: engine.name,
        task,
        path: "preferred",
      }, async () => this.generateWithRetry(engine, options))
      const elapsedMs = Date.now() - startedAt

      if (output.trim().length === 0) {
        throw new Error(`Engine '${engine.name}' returned an empty response`)
      }

      this.markEngineSuccess(engine.name)
      engineStats.record(engine.name, elapsedMs, true)
      observeEngineCall(engine.name, task, true, elapsedMs)
      this.lastUsed = {
        provider: engine.provider,
        model: engine.defaultModel ?? options.model ?? "unknown",
      }

      log.info("task handled (user preference)", {
        task,
        engine: engine.name,
        latencyMs: elapsedMs,
      })

      return output
    } catch (error) {
      const elapsedMs = Date.now() - startedAt
      this.markEngineFailure(engine.name)
      engineStats.record(engine.name, elapsedMs, false)
      observeEngineCall(engine.name, task, false, elapsedMs)
      throw error
    }
  }

  async generate(task: TaskType, options: GenerateOptions): Promise<string> {
    const overallStartedAt = Date.now()
    const attempts = this.buildGeneratePlan(task)
    const failures: GenerateAttemptFailure[] = []

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const engine = attempts[attemptIndex]
      const attemptStartedAt = Date.now()

      try {
        const output = await withSpan("engine.call", {
          engine: engine.name,
          task,
          attempt: attemptIndex + 1,
        }, async () => this.generateWithRetry(engine, options))
        const elapsedMs = Date.now() - attemptStartedAt

        if (output.trim().length === 0) {
          const error = new Error(`Engine '${engine.name}' returned an empty response`)
          throw error
        }

        this.markEngineSuccess(engine.name)
        engineStats.record(engine.name, elapsedMs, true)
        observeEngineCall(engine.name, task, true, elapsedMs)
        this.lastUsed = {
          provider: engine.provider,
          model: engine.defaultModel ?? options.model ?? "unknown",
        }

        log.info("task handled", {
          task,
          engine: engine.name,
          attempt: attemptIndex + 1,
          attempts: attempts.length,
          latencyMs: elapsedMs,
          totalLatencyMs: Date.now() - overallStartedAt,
          usedFallback: attemptIndex > 0,
          hasSystemPrompt: Boolean(options.systemPrompt?.trim()),
        })

        return output
      } catch (error) {
        const elapsedMs = Date.now() - attemptStartedAt
        this.markEngineFailure(engine.name)
        engineStats.record(engine.name, elapsedMs, false)
        observeEngineCall(engine.name, task, false, elapsedMs)
        failures.push({ engineName: engine.name, error })

        if (attemptIndex < attempts.length - 1) {
          const isEmptyResponseError = error instanceof Error
            && error.message.includes("returned an empty response")
          log.warn(isEmptyResponseError
            ? "engine returned empty output, trying fallback"
            : "engine generation failed, trying fallback", {
            task,
            engine: engine.name,
            attempt: attemptIndex + 1,
            attempts: attempts.length,
            latencyMs: elapsedMs,
            error,
          })
          continue
        }
      }
    }

    throw this.buildExhaustedGenerateError(task, failures)
  }

  private async registerIfAvailable(engine: Engine): Promise<void> {
    try {
      const available = await Promise.resolve(engine.isAvailable())
      if (available) {
        this.engines.set(engine.name, engine)
        log.info("engine ready", { engine: engine.name, provider: engine.provider })
        return
      }

      log.info("engine unavailable", {
        engine: engine.name,
        provider: engine.provider,
      })
    } catch (error) {
      log.warn("engine availability check failed", {
        engine: engine.name,
        error,
      })
    }
  }

  private getPriorityNames(task: TaskType): readonly string[] {
    return PRIORITY_MAP[task] ?? PRIORITY_MAP.reasoning
  }

  private getAvailablePriorityNames(task: TaskType): string[] {
    return this.getPriorityNames(task).filter((engineName) => this.engines.has(engineName))
  }

  private resolveStaticRoute(task: TaskType): Engine | null {
    for (const engineName of this.getPriorityNames(task)) {
      const engine = this.engines.get(engineName)
      if (engine) {
        return engine
      }
    }
    return null
  }

  private buildGeneratePlan(task: TaskType): Engine[] {
    const availableNames = this.getAvailablePriorityNames(task)
    if (availableNames.length === 0) {
      throw this.createNoEngineError(task)
    }

    const healthyCircuitNames = availableNames.filter((engineName) => !this.isCircuitOpen(engineName))
    const candidates = healthyCircuitNames.length > 0
      ? healthyCircuitNames
      : availableNames

    if (healthyCircuitNames.length === 0) {
      log.warn("all circuits open, forcing probe", { task, candidates: availableNames })
    }

    const orderedNames = config.ENGINE_STATS_ENABLED
      ? this.orderCandidatesWithAdaptiveStats(candidates, task)
      : candidates

    const engines = orderedNames
      .map((engineName) => this.engines.get(engineName))
      .filter((engine): engine is Engine => Boolean(engine))

    if (engines.length === 0) {
      throw this.createNoEngineError(task)
    }

    return engines
  }

  private orderCandidatesWithAdaptiveStats(availableNames: string[], task: TaskType): string[] {
    const ranked = engineStats.rankEngines(availableNames)
    if (!config.ORCHESTRATOR_COST_ROUTING_ENABLED || ranked.length <= 1) {
      return ranked
    }

    const maxRank = Math.max(1, ranked.length - 1)
    const rankIndex = new Map(ranked.map((name, index) => [name, index]))
    const maxCost = Math.max(
      ...ranked.map((name) => ENGINE_COST_ESTIMATE_PER_1K[name] ?? 1),
      1,
    )

    const costWeight = task === "fast" || task === "local" ? 0.7 : 0.3
    const qualityWeight = 1 - costWeight

    return [...ranked].sort((left, right) => {
      const leftRankNorm = (rankIndex.get(left) ?? maxRank) / maxRank
      const rightRankNorm = (rankIndex.get(right) ?? maxRank) / maxRank
      const leftCostNorm = (ENGINE_COST_ESTIMATE_PER_1K[left] ?? maxCost) / maxCost
      const rightCostNorm = (ENGINE_COST_ESTIMATE_PER_1K[right] ?? maxCost) / maxCost

      const leftScore = (leftRankNorm * qualityWeight) + (leftCostNorm * costWeight)
      const rightScore = (rightRankNorm * qualityWeight) + (rightCostNorm * costWeight)
      return leftScore - rightScore
    })
  }

  private async generateWithTimeout(engine: Engine, options: GenerateOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Engine '${engine.name}' timed out after ${ENGINE_TIMEOUT_MS}ms`))
      }, ENGINE_TIMEOUT_MS)

      void engine.generate(options)
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timeout))
    })
  }

  private async generateWithRetry(engine: Engine, options: GenerateOptions): Promise<string> {
    let attempt = 0

    while (attempt < ENGINE_RETRY_MAX_ATTEMPTS) {
      attempt += 1

      try {
        return await this.generateWithTimeout(engine, options)
      } catch (error) {
        const shouldRetry = attempt < ENGINE_RETRY_MAX_ATTEMPTS
          && this.isRetryableEngineError(error)

        if (!shouldRetry) {
          throw error
        }

        const backoffMs = ENGINE_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))
        log.warn("transient engine failure, retrying with backoff", {
          engine: engine.name,
          attempt,
          maxAttempts: ENGINE_RETRY_MAX_ATTEMPTS,
          backoffMs,
          error,
        })
        await this.sleep(backoffMs)
      }
    }

    throw new Error(`Engine '${engine.name}' failed after retry attempts`)
  }

  private isRetryableEngineError(error: unknown): boolean {
    const status = this.extractErrorStatus(error)
    if (status !== null) {
      return RETRYABLE_STATUS_CODES.has(status)
    }

    const message = this.extractErrorMessage(error).toLowerCase()
    return message.includes("rate limit")
      || message.includes("too many requests")
      || message.includes("service unavailable")
  }

  private extractErrorStatus(error: unknown): number | null {
    if (typeof error !== "object" || error === null || !("status" in error)) {
      return null
    }

    const status = (error as { status?: unknown }).status
    return typeof status === "number" ? status : null
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  private isCircuitOpen(engineName: string, now = Date.now()): boolean {
    const state = this.circuits.get(engineName)
    if (!state) {
      return false
    }
    return state.openUntil > now
  }

  private markEngineSuccess(engineName: string): void {
    this.circuits.delete(engineName)
  }

  private markEngineFailure(engineName: string, now = Date.now()): void {
    const previous = this.circuits.get(engineName) ?? {
      consecutiveFailures: 0,
      openUntil: 0,
    }

    const nextFailures = previous.consecutiveFailures + 1
    const nextState: CircuitState = {
      consecutiveFailures: nextFailures,
      openUntil: nextFailures >= CIRCUIT_FAILURE_THRESHOLD
        ? (now + CIRCUIT_COOLDOWN_MS)
        : previous.openUntil,
    }

    this.circuits.set(engineName, nextState)

    if (nextFailures === CIRCUIT_FAILURE_THRESHOLD) {
      log.warn("engine circuit opened", {
        engine: engineName,
        failures: nextFailures,
        cooldownMs: CIRCUIT_COOLDOWN_MS,
      })
    }
  }

  private createNoEngineError(task: TaskType): Error {
    return new Error(
      `No engine available for task '${task}'. Configure at least one provider and re-run setup.`,
    )
  }

  private buildExhaustedGenerateError(
    task: TaskType,
    failures: GenerateAttemptFailure[],
  ): Error {
    const failedEngineNames = failures.map((failure) => failure.engineName)
    const lastFailure = failures[failures.length - 1]
    const lastMessage = lastFailure?.error instanceof Error
      ? lastFailure.error.message
      : String(lastFailure?.error ?? "unknown error")

    const error = new Error(
      `All engines failed for task '${task}' (${failedEngineNames.join(", ")}). Last error: ${lastMessage}`,
    )
      ; (error as Error & { cause?: unknown }).cause = lastFailure?.error
    return error
  }
}

export const orchestrator = new Orchestrator()
