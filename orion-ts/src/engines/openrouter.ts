import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.openrouter")

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  headers: {
    "HTTP-Referer": "https://github.com/orion",
  },
  apiKey: config.OPENROUTER_API_KEY,
})

function buildPrompt(options: GenerateOptions): string {
  const contextText = (options.context ?? [])
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")

  if (!contextText) {
    return options.prompt
  }

  return `${contextText}\nuser: ${options.prompt}`
}

export class OpenRouterEngine implements Engine {
  readonly name = "openrouter"
  readonly provider = "openrouter"
  private readonly defaultModel = "openrouter/auto"

  isAvailable(): boolean {
    return config.OPENROUTER_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const result = await generateText({
        model: openrouter(options.model ?? this.defaultModel),
        prompt: buildPrompt(options),
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      })
      return result.text
    } catch (error) {
      log.error("generate failed", error)
      return ""
    }
  }
}

export const openRouterEngine = new OpenRouterEngine()
