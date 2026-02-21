import OpenAI from "openai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.openai")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []

  if (options.systemPrompt?.trim()) {
    messages.push({ role: "system", content: options.systemPrompt.trim() })
  }

  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class OpenAIEngine implements Engine {
  readonly name = "openai"
  readonly provider = "openai"
  readonly defaultModel = "gpt-4o"

  isAvailable(): boolean {
    return config.OPENAI_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const client = new OpenAI({ apiKey: config.OPENAI_API_KEY })
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

export const openAIEngine = new OpenAIEngine()
