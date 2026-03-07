/**
 * @file engines/together.ts — Together AI engine adapter
 *
 * 200+ open-source models (Llama, DeepSeek, Qwen, Mixtral, etc.) via one API key.
 * OpenAI-compatible. Great for accessing open models without self-hosting.
 *
 * API key stored in edith.json → env.TOGETHER_API_KEY → auto-injected at startup.
 */

import OpenAI from "openai"
import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.together")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []
  if (options.systemPrompt?.trim()) messages.push({ role: "system", content: options.systemPrompt.trim() })
  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class TogetherEngine implements Engine {
  readonly name = "together"
  readonly provider = "together"
  readonly defaultModel = "meta-llama/Llama-3.3-70B-Instruct-Turbo"

  isAvailable(): boolean {
    return (config as any).TOGETHER_API_KEY?.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) return ""
    try {
      const client = new OpenAI({
        apiKey: (config as any).TOGETHER_API_KEY,
        baseURL: "https://api.together.xyz/v1",
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

export const togetherEngine = new TogetherEngine()
