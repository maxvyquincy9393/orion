import Anthropic from "@anthropic-ai/sdk"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.anthropic")

function toMessages(options: GenerateOptions): Array<{ role: "user" | "assistant"; content: string }> {
  const messages = [...(options.context ?? [])]
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class AnthropicEngine implements Engine {
  readonly name = "anthropic"
  readonly provider = "anthropic"
  private readonly defaultModel = "claude-3-5-sonnet-20241022"

  isAvailable(): boolean {
    return config.ANTHROPIC_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
      const response = await client.messages.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 4096,
        messages: toMessages(options),
      })

      const textBlock = response.content.find((block: Anthropic.ContentBlock) => block.type === "text")
      return textBlock?.type === "text" ? textBlock.text : ""
    } catch (error) {
      log.error("generate failed", error)
      return ""
    }
  }
}

export const anthropicEngine = new AnthropicEngine()
