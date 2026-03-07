/**
 * @file engines/anthropic.ts — Anthropic Claude engine adapter
 *
 * Handles both text-only and multimodal (vision) generation via the Anthropic SDK.
 * When GenerateOptions.images is present, images are included as base64 image
 * source blocks in the message content array.
 *
 * Anthropic is FALLBACK 2 for vision tasks in EDITH because:
 *   - Higher cost per call than Gemini Flash for vision
 *   - Strong text reasoning, adequate vision for fallback scenarios
 *   - Part of the OSWorld-recommended fallback chain
 *
 * Paper basis:
 *   OSWorld (arXiv:2404.07972): multi-provider resilience in fallback chain
 *   Anthropic API docs: image source format for base64 encoding
 *
 * @module engines/anthropic
 */

import Anthropic from "@anthropic-ai/sdk"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { Engine, GenerateOptions, ImagePayload } from "./types.js"

const log = createLogger("engines.anthropic")

// ── Message builder helpers ────────────────────────────────────────────────────

/**
 * Build a text-only messages array for an Anthropic request.
 * Anthropic does not use a system message in the messages array —
 * it goes in a separate `system` field at the top level.
 */
function buildTextMessages(
  options: GenerateOptions,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages = [...(options.context ?? [])]
  messages.push({ role: "user", content: options.prompt })
  return messages
}

/**
 * Build a multimodal content block array for an Anthropic vision request.
 *
 * Anthropic vision format:
 *   { type: "image", source: { type: "base64", media_type, data } }
 *   { type: "text", text: "Describe..." }
 *
 * IMPORTANT: Anthropic requires image blocks BEFORE text blocks in the
 * same content array (image-first ordering per Anthropic API spec).
 */
function buildVisionContent(
  prompt: string,
  images: ImagePayload[],
): Anthropic.Messages.ContentBlockParam[] {
  return [
    // Images first (Anthropic API requirement)
    ...images.map((img): Anthropic.Messages.ImageBlockParam => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.data,
      },
    })),
    // Text instruction follows the image(s)
    {
      type: "text",
      text: prompt,
    },
  ]
}

/** Extract system prompt string or return undefined if empty */
function extractSystemPrompt(options: GenerateOptions): string | undefined {
  const prompt = options.systemPrompt?.trim()
  return prompt && prompt.length > 0 ? prompt : undefined
}

// ── Engine implementation ──────────────────────────────────────────────────────

export class AnthropicEngine implements Engine {
  readonly name = "anthropic"
  readonly provider = "anthropic"
  readonly defaultModel = "claude-sonnet-4-20250514"

  isAvailable(): boolean {
    return config.ANTHROPIC_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) {
      return ""
    }

    try {
      const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

      // ── Multimodal path (Phase 3 Vision) ──────────────────────────────────
      // When images are provided, we build a content block array with
      // image blocks (base64 source) followed by the text instruction.
      // Anthropic requires image-before-text ordering in the content array.
      if (options.images && options.images.length > 0) {
        log.debug("generating with vision payload", {
          imageCount: options.images.length,
          mimeTypes: options.images.map((i) => i.mimeType),
        })

        const response = await client.messages.create({
          model: options.model ?? this.defaultModel,
          max_tokens: options.maxTokens ?? 4096,
          system: extractSystemPrompt(options),
          messages: [{
            role: "user",
            content: buildVisionContent(options.prompt, options.images),
          }],
        })

        const textBlock = response.content.find(
          (block: Anthropic.ContentBlock) => block.type === "text",
        )
        return textBlock?.type === "text" ? textBlock.text : ""
      }

      // ── Text-only path (existing behavior, unchanged) ─────────────────────
      const response = await client.messages.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 4096,
        system: extractSystemPrompt(options),
        messages: buildTextMessages(options),
      })

      const textBlock = response.content.find(
        (block: Anthropic.ContentBlock) => block.type === "text",
      )
      return textBlock?.type === "text" ? textBlock.text : ""
    } catch (error) {
      log.error("generate failed", error)
      throw error
    }
  }
}

export const anthropicEngine = new AnthropicEngine()
