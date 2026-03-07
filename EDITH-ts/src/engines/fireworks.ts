/**
 * @file engines/fireworks.ts — Fireworks AI engine adapter
 *
 * Fastest inference on the market via FireAttention — H100 FP8 optimized.
 * Up to 12x faster long-context inference vs vLLM. Best for "fast" task type.
 *
 * API key stored in edith.json → env.FIREWORKS_API_KEY → auto-injected at startup.
 */

import OpenAI from "openai"
import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.fireworks")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []
  if (options.systemPrompt?.trim()) messages.push({ role: "system", content: options.systemPrompt.trim() })
  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class FireworksEngine implements Engine {
  readonly name = "fireworks"
  readonly provider = "fireworks"
  readonly defaultModel = "accounts/fireworks/models/llama-v3p3-70b-instruct"

  isAvailable(): boolean {
    return (config as any).FIREWORKS_API_KEY?.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) return ""
    try {
      const client = new OpenAI({
        apiKey: (config as any).FIREWORKS_API_KEY,
        baseURL: "https://api.fireworks.ai/inference/v1",
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

export const fireworksEngine = new FireworksEngine()
