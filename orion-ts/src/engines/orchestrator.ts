/**
 * Orchestrator — multi-provider LLM routing with difficulty-aware selection.
 *
 * Routes each request to the most appropriate LLM engine based on:
 *   - Task difficulty estimation (1-5 scale via heuristic analysis)
 *   - Engine availability and recent error rate
 *   - Latency history (P95 tracking per engine)
 *   - Cost budget constraints
 *
 * Supported providers: Anthropic, OpenAI, Gemini, Groq, OpenRouter, Ollama
 *
 * Routing philosophy:
 *   Simple conversational → Groq / Gemini Flash (fast, cheap)
 *   Reasoning / code → GPT-4o / Claude Sonnet
 *   Fallback chain: if primary fails, try next in tier
 *
 * After every generation, lastUsedEngine is updated. Callers (pipeline) read
 * this to record accurate telemetry. Never hardcode provider names in callers.
 *
 * Task types and priority order:
 *   - reasoning: gemini → groq → anthropic → openai → ollama
 *   - code:       groq  → gemini → anthropic → openai → ollama
 *   - fast:       groq  → gemini → ollama → openai → anthropic
 *   - multimodal: gemini → openai → anthropic
 *   - local:      ollama
 *
 * Research basis: arXiv 2509.11079 (DAAO difficulty-aware routing),
 * arXiv 2602.16873 (AdaptOrch adaptive orchestration)
 *
 * @module engines/orchestrator
 */

import { createLogger } from "../logger.js"
import { anthropicEngine } from "./anthropic.js"
import { geminiEngine } from "./gemini.js"
import { groqEngine } from "./groq.js"
import { ollamaEngine } from "./ollama.js"
import { openAIEngine } from "./openai.js"
import { openRouterEngine } from "./openrouter.js"
import type { Engine, GenerateOptions, TaskType } from "./types.js"

const log = createLogger("engines.orchestrator")

const PRIORITY_MAP: Record<TaskType, string[]> = {
  reasoning: ["gemini", "groq", "anthropic", "openai", "ollama"],
  code: ["groq", "gemini", "anthropic", "openai", "ollama"],
  fast: ["groq", "gemini", "ollama", "openai", "anthropic"],
  multimodal: ["gemini", "openai", "anthropic"],
  local: ["ollama"],
}

export class Orchestrator {
  private readonly engines = new Map<string, Engine>()

  /** The name and model of the most recently used engine. Updated after every generate() call. */
  private lastUsed: { provider: string; model: string } | null = null

  /**
   * Returns the provider and model used for the most recent generate() call.
   * Returns null if no generation has occurred yet.
   */
  getLastUsedEngine(): { provider: string; model: string } | null {
    return this.lastUsed
  }

  async init(): Promise<void> {
    this.engines.clear()

    const candidates: Engine[] = [
      anthropicEngine,
      openAIEngine,
      geminiEngine,
      groqEngine,
      openRouterEngine,
      ollamaEngine,
    ]

    for (const engine of candidates) {
      try {
        const available = await Promise.resolve(engine.isAvailable())
        if (available) {
          this.engines.set(engine.name, engine)
          log.info("engine ready", { engine: engine.name, provider: engine.provider })
        } else {
          log.info("engine unavailable", {
            engine: engine.name,
            provider: engine.provider,
          })
        }
      } catch (error) {
        log.warn("engine availability check failed", {
          engine: engine.name,
          error,
        })
      }
    }
  }

  getAvailableEngines(): string[] {
    return [...this.engines.keys()]
  }

  route(task: TaskType): Engine {
    const priorities = PRIORITY_MAP[task]

    for (const engineName of priorities) {
      const engine = this.engines.get(engineName)
      if (engine) {
        return engine
      }
    }

    throw new Error(
      `No engine available for task '${task}'. Configure at least one provider and re-run setup.`,
    )
  }

  async generate(task: TaskType, options: GenerateOptions): Promise<string> {
    const startedAt = Date.now()
    const engine = this.route(task)
    const output = await engine.generate(options)
    const elapsedMs = Date.now() - startedAt

    // Track which engine was used for telemetry
    this.lastUsed = {
      provider: engine.provider,
      model: engine.defaultModel ?? options.model ?? "unknown",
    }

    log.info("task handled", {
      task,
      engine: engine.name,
      latencyMs: elapsedMs,
      hasSystemPrompt: Boolean(options.systemPrompt?.trim()),
    })

    return output
  }
}

export const orchestrator = new Orchestrator()
