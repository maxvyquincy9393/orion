import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.ollama")

interface OllamaTagResponse {
  models?: Array<{ name?: string }>
}

function toMessages(options: GenerateOptions): Array<{ role: "user" | "assistant"; content: string }> {
  const messages = [...(options.context ?? [])]
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class OllamaEngine implements Engine {
  readonly name = "ollama"
  readonly provider = "ollama"

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
