import { anthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.anthropic")

function buildPrompt(options: GenerateOptions): string {
  const contextText = (options.context ?? [])
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")

  if (!contextText) {
    return options.prompt
  }

  return `${contextText}\nuser: ${options.prompt}`
}

export class AnthropicEngine implements Engine {
  readonly name = "anthropic"
  readonly provider = "anthropic"
  private readonly defaultModel = "claude-opus-4-6"

  isAvailable(): boolean {
    return config.ANTHROPIC_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const result = await generateText({
        model: anthropic(options.model ?? this.defaultModel),
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

export const anthropicEngine = new AnthropicEngine()
