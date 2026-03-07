/**
 * @file engines/types.ts — Engine interface contracts
 *
 * Defines the GenerateOptions interface used by ALL engine adapters.
 * Phase 3 adds optional `images` field for multimodal vision calls.
 * Every engine that supports vision reads this field; text-only engines ignore it.
 *
 * @module engines/types
 */

// ── Image payload for multimodal requests ─────────────────────────────────────
// Used by describeImage(), findElement(), and any LLM call that includes
// a screenshot or image alongside a text prompt.
//
// Paper basis:
//   - OmniParser V2 (arXiv:2408.00203): pure-vision UI parsing via VLM
//   - OSWorld (arXiv:2404.07972): provider-agnostic multimodal interface
//   - GPT-4V System Card: supported MIME types and size limits
export interface ImagePayload {
  /** Base64-encoded image data (no data URI prefix, just raw base64) */
  data: string
  /**
   * MIME type of the image.
   * Supported: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
   * Detected via magic bytes in validateAndResizeImage(), not file extension.
   */
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
}

// ── Text generation options ────────────────────────────────────────────────────
export interface GenerateOptions {
  /** The user's primary prompt / instruction */
  prompt: string

  /**
   * Conversation history (prior turns).
   * Each engine formats this differently but the data shape is shared.
   */
  context?: Array<{ role: "user" | "assistant"; content: string }>

  /** Optional system-level instruction prepended before the conversation */
  systemPrompt?: string

  /** Max tokens to generate (engine default if not specified) */
  maxTokens?: number

  /** Sampling temperature 0–2 (engine default if not specified) */
  temperature?: number

  /**
   * Override the model identifier used by this engine.
   * If omitted, each engine uses its own `defaultModel`.
   */
  model?: string

  /**
   * Optional AbortSignal for cancelling long-running generations.
   * Engines check this and throw DOMException("AbortError") when signalled.
   */
  signal?: AbortSignal

  /**
   * [Phase 3 — Vision] Optional image payloads for multimodal requests.
   *
   * When present, engines that support vision will include the image(s)
   * alongside the text prompt. Text-only engines (groq, ollama, openrouter)
   * silently ignore this field and fall back to text-only generation.
   *
   * Limit: max 1 image per call for grounding tasks (GPT-4V Card recommendation).
   * Size:  max 20MB, max 2048px edge (auto-enforced by validateAndResizeImage).
   *
   * Paper basis:
   *   OmniParser + OSWorld: pure-vision UI understanding
   *   GPT-4V Card: safe image submission limits
   */
  images?: ImagePayload[]
}

// ── Engine contract ────────────────────────────────────────────────────────────
export interface Engine {
  /** Unique lowercase name: "gemini" | "openai" | "anthropic" | "groq" | ... */
  readonly name: string

  /** Provider brand name for telemetry: "google" | "openai" | "anthropic" | ... */
  readonly provider: string

  /**
   * Default model string used when options.model is not specified.
   * Example: "gemini-2.0-flash", "gpt-4o", "claude-sonnet-4-20250514"
   */
  readonly defaultModel?: string

  /**
   * Returns true if this engine is configured and ready (API key present, etc.).
   * Called at startup to decide which engines to register in the orchestrator.
   */
  isAvailable(): boolean | Promise<boolean>

  /**
   * Generate a completion for the given options.
   * Throws on irrecoverable errors (the orchestrator handles fallback).
   * Returns empty string only for genuinely empty model responses.
   */
  generate(options: GenerateOptions): Promise<string>
}

// ── Task routing ───────────────────────────────────────────────────────────────
/** Task types used by the Orchestrator to select the best engine priority order */
export type TaskType = "reasoning" | "code" | "fast" | "multimodal" | "local"

export interface EngineRoute {
  task: TaskType
  /** Ordered list of engine names to try (first available wins) */
  priority: string[]
}
