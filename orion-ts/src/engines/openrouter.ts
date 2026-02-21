import OpenAI from "openai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.openrouter")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []

  if (options.systemPrompt?.trim()) {
    messages.push({ role: "system", content: options.systemPrompt.trim() })
  }

  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class OpenRouterEngine implements Engine {
  readonly name = "openrouter"
  readonly provider = "openrouter"
  private readonly defaultModel = "anthropic/claude-3.5-sonnet"

  isAvailable(): boolean {
    return config.OPENROUTER_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const client = new OpenAI({
        apiKey: config.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      })

      const response = await client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        messages: toMessages(options),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      })

      return response.choices[0]?.message?.content ?? ""
    } catch (error) {
      log.error("generate failed", error)
      return ""
    }
  }
}

export const openRouterEngine = new OpenRouterEngine()
