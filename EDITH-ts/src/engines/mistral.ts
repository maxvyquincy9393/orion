/**
 * @file engines/mistral.ts — Mistral AI engine adapter
 *
 * Mistral Small/Large/Codestral via OpenAI-compatible API.
 * Open-weight models, Apache 2.0 license. Codestral is best-in-class for coding.
 *
 * API key stored in edith.json → env.MISTRAL_API_KEY → auto-injected at startup.
 */

import OpenAI from "openai"
import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.mistral")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []
  if (options.systemPrompt?.trim()) messages.push({ role: "system", content: options.systemPrompt.trim() })
  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class MistralEngine implements Engine {
  readonly name = "mistral"
  readonly provider = "mistral"
  readonly defaultModel = "mistral-small-latest"

  isAvailable(): boolean {
    return (config as any).MISTRAL_API_KEY?.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) return ""
    try {
      const client = new OpenAI({
        apiKey: (config as any).MISTRAL_API_KEY,
        baseURL: "https://api.mistral.ai/v1",
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
      throw error
    }
  }
}

export const mistralEngine = new MistralEngine()
