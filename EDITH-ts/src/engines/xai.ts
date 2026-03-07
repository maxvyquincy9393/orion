/**
 * @file engines/xai.ts — xAI Grok engine adapter
 *
 * Grok 3 / Grok 3 Mini via OpenAI-compatible API.
 * 2M token context window on Grok 4.1 — largest context at lowest price ($0.20/1M).
 *
 * API key stored in edith.json → env.XAI_API_KEY → auto-injected at startup.
 */

import OpenAI from "openai"
import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.xai")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []
  if (options.systemPrompt?.trim()) messages.push({ role: "system", content: options.systemPrompt.trim() })
  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class XAIEngine implements Engine {
  readonly name = "xai"
  readonly provider = "xai"
  readonly defaultModel = "grok-3-mini"

  isAvailable(): boolean {
    return (config as any).XAI_API_KEY?.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) return ""
    try {
      const client = new OpenAI({
        apiKey: (config as any).XAI_API_KEY,
        baseURL: "https://api.x.ai/v1",
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

export const xaiEngine = new XAIEngine()
