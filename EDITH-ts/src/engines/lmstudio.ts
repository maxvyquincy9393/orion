/**
 * @file engines/lmstudio.ts — LM Studio local engine adapter
 *
 * LM Studio is a GUI-based local LLM runner — user picks and downloads models
 * from HuggingFace via the UI. Exposes an OpenAI-compatible API on localhost.
 * Great alternative to Ollama for users who prefer a visual interface.
 *
 * No API key needed — just LM Studio running locally.
 * Base URL stored in edith.json → env.LM_STUDIO_BASE_URL → auto-injected at startup.
 * Default: http://localhost:1234
 */

import OpenAI from "openai"
import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.lmstudio")

function toMessages(options: GenerateOptions): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []
  if (options.systemPrompt?.trim()) messages.push({ role: "system", content: options.systemPrompt.trim() })
  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

export class LMStudioEngine implements Engine {
  readonly name = "lmstudio"
  readonly provider = "lmstudio"

  private get baseURL(): string {
    return (config as any).LM_STUDIO_BASE_URL?.trim() || "http://localhost:1234"
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/v1/models`)
      if (!res.ok) return false
      const data = await res.json() as { data?: unknown[] }
      return Array.isArray(data.data) && data.data.length > 0
    } catch {
      return false
    }
  }

  private async getFirstModel(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseURL}/v1/models`)
      if (!res.ok) return null
      const data = await res.json() as { data?: Array<{ id?: string }> }
      return data.data?.[0]?.id ?? null
    } catch {
      return null
    }
  }

  async generate(options: GenerateOptions): Promise<string> {
    try {
      const model = options.model ?? await this.getFirstModel()
      if (!model) throw new Error("No LM Studio model loaded")

      const client = new OpenAI({
        apiKey: "lm-studio", // LM Studio doesn't require a real key
        baseURL: `${this.baseURL}/v1`,
      })
      const response = await client.chat.completions.create({
        model,
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

export const lmStudioEngine = new LMStudioEngine()
