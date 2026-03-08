/**
 * @file ollama.ts
 * @description Ollama LLM engine — local model inference via the Ollama REST API.
 *
 * ARCHITECTURE:
 *   Implements the Engine interface from engines/types.ts.
 *   Registered as 'ollama' in the orchestrator's DEFAULT_ENGINE_CANDIDATES list.
 *   Typically last in cloud priority chains (reasoning/code/fast) but FIRST for 'local' tasks.
 *
 *   In Phase 9 (offline mode), this engine becomes the primary LLM when cloud APIs are
 *   unreachable. The OfflineCoordinator signals the orchestrator to prioritize 'ollama'.
 *
 *   Model selection: uses the first available model from /api/tags if no model is specified.
 *   Recommended models: qwen2.5:3b (voice), qwen2.5:7b (quality), phi4-mini (code).
 *
 * @module engines/ollama
 */

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.ollama")

/** Shape of the Ollama /api/tags response. */
interface OllamaTagResponse {
  models?: Array<{ name?: string }>
}

/**
 * Convert GenerateOptions to the Ollama chat message format.
 */
function toMessages(options: GenerateOptions): Array<{ role: "user" | "assistant"; content: string }> {
  const messages = [...(options.context ?? [])]
  messages.push({ role: "user", content: options.prompt })
  return messages
}

/**
 * OllamaEngine — local LLM inference via Ollama's REST API.
 *
 * Requires Ollama to be running at OLLAMA_BASE_URL (default: http://localhost:11434).
 * Automatically discovers the first available model if no model is specified.
 */
export class OllamaEngine implements Engine {
  /** Unique engine identifier used by the orchestrator. */
  readonly name = "ollama"

  /** Provider label for logging and telemetry. */
  readonly provider = "ollama"

  /**
   * Returns the first available model name from Ollama's model list.
   * Returns null if no models are available or the API is unreachable.
   */
  private async getFirstModel(): Promise<string | null> {
    try {
      const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`)
      if (!response.ok) {
        return null
      }

      const payload = (await response.json()) as OllamaTagResponse
      const model = payload.models?.[0]?.name?.trim()
      return model && model.length > 0 ? model : null
    } catch (error) {
      log.error("getFirstModel failed", error)
      return null
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`)
      return response.status === 200
    } catch {
      return false
    }
  }

  async generate(options: GenerateOptions): Promise<string> {
    try {
      const model = options.model ?? (await this.getFirstModel())
      if (!model) {
        return ""
      }

      const response = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,
          system: options.systemPrompt?.trim() || undefined,
          messages: toMessages(options),
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
          },
        }),
      })

      if (!response.ok) {
        return ""
      }

      const payload = (await response.json()) as {
        message?: { content?: string }
      }

      return payload.message?.content ?? ""
    } catch (error) {
      log.error("generate failed", error)
      return ""
    }
  }
}

export const ollamaEngine = new OllamaEngine()
