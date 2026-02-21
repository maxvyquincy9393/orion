import { GoogleGenerativeAI } from "@google/generative-ai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.gemini")

export class GeminiEngine implements Engine {
  readonly name = "gemini"
  readonly provider = "google"
  private readonly defaultModel = "gemini-1.5-pro"

  isAvailable(): boolean {
    return config.GEMINI_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: options.model ?? this.defaultModel,
        systemInstruction: options.systemPrompt?.trim() || undefined,
      })

      const history = options.context?.map((msg) => ({
        role: msg.role === "user" ? "user" : "model" as const,
        parts: [{ text: msg.content }],
      })) ?? []

      const chat = model.startChat({ history })
      const result = await chat.sendMessage(options.prompt)

      return result.response.text()
    } catch (error) {
      log.error("generate failed", error)
      return ""
    }
  }
}

export const geminiEngine = new GeminiEngine()
