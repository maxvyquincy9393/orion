/**
 * @file engines/perplexity.ts — Perplexity AI engine adapter
 *
 * Sonar models with real-time web search built-in — no extra skill needed.
 * Every response can include live information from the internet.
 * OpenAI-compatible API.
 *
 * API key stored in edith.json → env.PERPLEXITY_API_KEY → auto-injected at startup.
 */

import OpenAI from "openai"
import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.perplexity")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []
  if (options.systemPrompt?.trim()) messages.push({ role: "system", content: options.systemPrompt.trim() })
  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class PerplexityEngine implements Engine {
  readonly name = "perplexity"
  readonly provider = "perplexity"
  readonly defaultModel = "sonar"

  isAvailable(): boolean {
    return (config as any).PERPLEXITY_API_KEY?.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) return ""
    try {
      const client = new OpenAI({
        apiKey: (config as any).PERPLEXITY_API_KEY,
        baseURL: "https://api.perplexity.ai",
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

export const perplexityEngine = new PerplexityEngine()
