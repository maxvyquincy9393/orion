import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.openai")

function buildPrompt(options: GenerateOptions): string {
  const contextText = (options.context ?? [])
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")

  if (!contextText) {
    return options.prompt
  }

  return `${contextText}\nuser: ${options.prompt}`
}

export class OpenAIEngine implements Engine {
  readonly name = "openai"
  readonly provider = "openai"
  private readonly defaultModel = "gpt-4o"

  isAvailable(): boolean {
    return config.OPENAI_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const result = await generateText({
        model: openai(options.model ?? this.defaultModel),
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

export const openAIEngine = new OpenAIEngine()
