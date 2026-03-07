/**
 * @file engines/gemini.ts — Google Gemini engine adapter
 *
 * Handles both text-only and multimodal (vision) generation via
 * the Google Generative AI SDK. When GenerateOptions.images is present,
 * the image is included as an inlineData part in the Gemini content payload.
 *
 * Gemini is the PRIMARY vision engine for EDITH because:
 *   - Best cost/quality ratio for vision tasks (OmniParser V2 evaluation)
 *   - Gemini 2.0 Flash is significantly cheaper than GPT-4o vision
 *   - Supports inlineData (base64) directly — no hosting required
 *
 * Paper basis:
 *   OmniParser V2 (Microsoft Research 2024): recommends Gemini Flash for vision
 *   OSWorld (arXiv:2404.07972): provider-agnostic multimodal routing
 *   GPT-4V Card: max 20MB image, supported MIME types
 *
 * @module engines/gemini
 */

import { GoogleGenerativeAI, type Part } from "@google/generative-ai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions } from "./types.js"

const log = createLogger("engines.gemini")

export class GeminiEngine implements Engine {
  readonly name = "gemini"
  readonly provider = "google"
  readonly defaultModel = "gemini-2.0-flash"

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

      // ── Multimodal path (Phase 3 Vision) ──────────────────────────────────
      // When images are provided, we use generateContent() with a parts array
      // instead of the chat API. This is required for inlineData support.
      //
      // Gemini inlineData format:
      //   { inlineData: { mimeType: "image/png", data: "<base64>" } }
      //
      // We include text first, then image(s) — Gemini processes in this order.
      if (options.images && options.images.length > 0) {
        const parts: Part[] = [
          // Text instruction comes first (Gemini best practice)
          { text: options.prompt },
          // Append each image as an inlineData part
          ...options.images.map((img) => ({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data,
            },
          })),
        ]

        log.debug("generating with vision payload", {
          imageCount: options.images.length,
          mimeTypes: options.images.map((i) => i.mimeType),
        })

        const result = await model.generateContent({ contents: [{ role: "user", parts }] })
        return result.response.text()
      }

      // ── Text-only path (existing behavior, unchanged) ─────────────────────
      const history = options.context?.map((msg) => ({
        role: msg.role === "user" ? "user" : "model" as const,
        parts: [{ text: msg.content }],
      })) ?? []

      const chat = model.startChat({ history })
      const result = await chat.sendMessage(options.prompt)
      return result.response.text()
    } catch (error) {
      log.error("generate failed", error)
      throw error
    }
  }
}

export const geminiEngine = new GeminiEngine()
