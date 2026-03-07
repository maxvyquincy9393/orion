/**
 * @file engines/openai.ts — OpenAI engine adapter
 *
 * Handles both text-only and multimodal (vision) generation via the OpenAI SDK.
 * When GenerateOptions.images is present, images are included as image_url content
 * parts using the data URI format (data:image/png;base64,...).
 *
 * OpenAI is FALLBACK 1 for vision tasks in EDITH because:
 *   - More expensive than Gemini Flash for equivalent vision tasks
 *   - GPT-4o has strong grounding accuracy (evaluated in ScreenSpot benchmark)
 *   - Used only when Gemini fails or is unavailable
 *
 * Paper basis:
 *   ScreenSpot benchmark: GPT-4o evaluated as strong vision baseline
 *   OSWorld (arXiv:2404.07972): fallback chain design
 *   GPT-4V System Card: image_url format with data URI encoding
 *
 * @module engines/openai
 */

import OpenAI from "openai"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions, ImagePayload } from "./types.js"

const log = createLogger("engines.openai")

// ── Message builder helpers ────────────────────────────────────────────────────

/**
 * Build the final messages array for a text-only OpenAI request.
 * System prompt → conversation history → final user message.
 */
function buildTextMessages(
  options: GenerateOptions,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = []

  if (options.systemPrompt?.trim()) {
    messages.push({ role: "system", content: options.systemPrompt.trim() })
  }

  messages.push(...(options.context ?? []))
  messages.push({ role: "user", content: options.prompt })
  return messages
}

/**
 * Build a multimodal content array for an OpenAI vision request.
 *
 * OpenAI vision format (GPT-4V System Card):
 *   { type: "image_url", image_url: { url: "data:image/png;base64,<data>" } }
 *
 * We encode images as data URIs to avoid hosting requirements.
 * Text comes first — OpenAI processes content parts in order.
 */
function buildVisionContent(
  prompt: string,
  images: ImagePayload[],
): Array<{ type: string; [key: string]: unknown }> {
  return [
    { type: "text", text: prompt },
    ...images.map((img) => ({
      type: "image_url",
      // Data URI format: "data:<mimeType>;base64,<data>"
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    })),
  ]
}

// ── Engine implementation ──────────────────────────────────────────────────────

export class OpenAIEngine implements Engine {
  readonly name = "openai"
  readonly provider = "openai"
  readonly defaultModel = "gpt-4o"

  isAvailable(): boolean {
    return config.OPENAI_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const client = new OpenAI({ apiKey: config.OPENAI_API_KEY })

      // ── Multimodal path (Phase 3 Vision) ──────────────────────────────────
      // When images are provided, we send a vision message using the
      // image_url content part format specified in the GPT-4V System Card.
      // System prompt is still applied as a separate system message.
      if (options.images && options.images.length > 0) {
        const messages: OpenAI.ChatCompletionMessageParam[] = []

        if (options.systemPrompt?.trim()) {
          messages.push({ role: "system", content: options.systemPrompt.trim() })
        }

        // Vision message with interleaved text + image parts
        messages.push({
          role: "user",
          content: buildVisionContent(options.prompt, options.images) as OpenAI.ChatCompletionContentPart[],
        })

        log.debug("generating with vision payload", {
          imageCount: options.images.length,
          mimeTypes: options.images.map((i) => i.mimeType),
        })

        const response = await client.chat.completions.create({
          model: options.model ?? this.defaultModel,
          messages,
          max_tokens: options.maxTokens,
        })

        return response.choices[0]?.message?.content ?? ""
      }

      // ── Text-only path (existing behavior, unchanged) ─────────────────────
      const response = await client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        messages: buildTextMessages(options),
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

export const openAIEngine = new OpenAIEngine()
