import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText } from "ai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.gemini")
const google = createGoogleGenerativeAI({ apiKey: config.GEMINI_API_KEY })

function buildPrompt(options: GenerateOptions): string {
  const contextText = (options.context ?? [])
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")

  if (!contextText) {
    return options.prompt
  }

  return `${contextText}\nuser: ${options.prompt}`
}

export class GeminiEngine implements Engine {
  readonly name = "gemini"
  readonly provider = "google"
  private readonly defaultModel = "gemini-2.0-flash"

  isAvailable(): boolean {
    return config.GEMINI_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const result = await generateText({
        model: google(options.model ?? this.defaultModel),
        prompt: buildPrompt(options),
        maxOutputTokens: options.maxTokens,
        temperature: options.temperature,
      })
      return result.text
    } catch (error) {
      log.error("generate failed", error)
      return ""
    }
  }
}

export const geminiEngine = new GeminiEngine()
