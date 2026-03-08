/**
 * @file model-preferences.ts
 * @description Model catalog and per-user engine/model preference store.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - ENGINE_MODEL_CATALOG is read by onboard.ts, doctor.ts, and main.ts for display.
 *   - ModelPreferencesStore is consumed by orchestrator.ts for per-user model overrides.
 *   - ModelInfo provides context window and capability metadata for routing decisions.
 */

/** Metadata about a specific model's capabilities. */
export interface ModelInfo {
  /** Model identifier string used in API calls. */
  id: string
  /** Human-readable display name. */
  displayName: string
  /** Context window size in tokens. */
  contextWindow: number
  /** Capability tags for routing decisions. */
  capabilities: ReadonlyArray<"reasoning" | "code" | "fast" | "multimodal" | "local" | "vision">
}

/** An engine entry in the model catalog. */
export interface EngineModelCatalogEntry {
  displayName: string
  models: string[]
  /** Detailed model info (keyed by model id). */
  modelInfo?: Record<string, ModelInfo>
}

export const ENGINE_MODEL_CATALOG: Record<string, EngineModelCatalogEntry> = {
  anthropic: {
    displayName: "Anthropic",
    models: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-sonnet-4-5-20250514",
      "claude-haiku-3-5-20241022",
    ],
    modelInfo: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        displayName: "Claude Sonnet 4",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "claude-opus-4-20250514": {
        id: "claude-opus-4-20250514",
        displayName: "Claude Opus 4",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "claude-sonnet-4-5-20250514": {
        id: "claude-sonnet-4-5-20250514",
        displayName: "Claude Sonnet 4.5",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "claude-haiku-3-5-20241022": {
        id: "claude-haiku-3-5-20241022",
        displayName: "Claude Haiku 3.5",
        contextWindow: 200_000,
        capabilities: ["fast", "code", "multimodal"],
      },
    },
  },
  openai: {
    displayName: "OpenAI",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o3",
      "o3-mini",
      "o4-mini",
    ],
    modelInfo: {
      "gpt-4o": {
        id: "gpt-4o",
        displayName: "GPT-4o",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        displayName: "GPT-4o Mini",
        contextWindow: 128_000,
        capabilities: ["fast", "code"],
      },
      "gpt-4.1": {
        id: "gpt-4.1",
        displayName: "GPT-4.1",
        contextWindow: 1_000_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "gpt-4.1-mini": {
        id: "gpt-4.1-mini",
        displayName: "GPT-4.1 Mini",
        contextWindow: 1_000_000,
        capabilities: ["fast", "code", "multimodal"],
      },
      "gpt-4.1-nano": {
        id: "gpt-4.1-nano",
        displayName: "GPT-4.1 Nano",
        contextWindow: 1_000_000,
        capabilities: ["fast"],
      },
      "o3": {
        id: "o3",
        displayName: "o3",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code"],
      },
      "o3-mini": {
        id: "o3-mini",
        displayName: "o3 Mini",
        contextWindow: 200_000,
        capabilities: ["reasoning", "fast"],
      },
      "o4-mini": {
        id: "o4-mini",
        displayName: "o4 Mini",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "fast"],
      },
    },
  },
  gemini: {
    displayName: "Google Gemini",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-pro",
    ],
    modelInfo: {
      "gemini-2.5-pro": {
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        contextWindow: 1_000_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "gemini-2.5-flash": {
        id: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        contextWindow: 1_000_000,
        capabilities: ["fast", "code", "multimodal", "vision"],
      },
      "gemini-2.0-flash": {
        id: "gemini-2.0-flash",
        displayName: "Gemini 2.0 Flash",
        contextWindow: 1_000_000,
        capabilities: ["fast", "code", "multimodal"],
      },
      "gemini-2.0-flash-lite": {
        id: "gemini-2.0-flash-lite",
        displayName: "Gemini 2.0 Flash Lite",
        contextWindow: 1_000_000,
        capabilities: ["fast"],
      },
      "gemini-1.5-pro": {
        id: "gemini-1.5-pro",
        displayName: "Gemini 1.5 Pro",
        contextWindow: 2_000_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
    },
  },
  groq: {
    displayName: "Groq",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "llama-4-scout-17b-16e-instruct",
      "llama-4-maverick-17b-128e-instruct",
      "deepseek-r1-distill-llama-70b",
      "qwen-qwq-32b",
      "mistral-saba-24b",
      "gemma2-9b-it",
    ],
    modelInfo: {
      "llama-3.3-70b-versatile": {
        id: "llama-3.3-70b-versatile",
        displayName: "Llama 3.3 70B",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "llama-3.1-8b-instant": {
        id: "llama-3.1-8b-instant",
        displayName: "Llama 3.1 8B",
        contextWindow: 128_000,
        capabilities: ["fast"],
      },
      "llama-4-scout-17b-16e-instruct": {
        id: "llama-4-scout-17b-16e-instruct",
        displayName: "Llama 4 Scout",
        contextWindow: 512_000,
        capabilities: ["reasoning", "code", "multimodal"],
      },
      "llama-4-maverick-17b-128e-instruct": {
        id: "llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick",
        contextWindow: 512_000,
        capabilities: ["reasoning", "code", "multimodal"],
      },
      "deepseek-r1-distill-llama-70b": {
        id: "deepseek-r1-distill-llama-70b",
        displayName: "DeepSeek R1 Distill 70B",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "qwen-qwq-32b": {
        id: "qwen-qwq-32b",
        displayName: "Qwen QwQ 32B",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "mistral-saba-24b": {
        id: "mistral-saba-24b",
        displayName: "Mistral Saba 24B",
        contextWindow: 32_000,
        capabilities: ["fast", "code"],
      },
      "gemma2-9b-it": {
        id: "gemma2-9b-it",
        displayName: "Gemma 2 9B",
        contextWindow: 8_000,
        capabilities: ["fast"],
      },
    },
  },
  ollama: {
    displayName: "Ollama",
    models: [
      "llama3.2",
      "llama4-scout",
      "qwen2.5",
      "qwen3",
      "qwen2.5-coder",
      "phi4-mini",
      "deepseek-r1",
      "deepseek-v3",
      "gemma3",
      "mistral",
      "codellama",
      "command-r",
    ],
    modelInfo: {
      "llama3.2": {
        id: "llama3.2",
        displayName: "Llama 3.2",
        contextWindow: 128_000,
        capabilities: ["fast", "local"],
      },
      "llama4-scout": {
        id: "llama4-scout",
        displayName: "Llama 4 Scout",
        contextWindow: 512_000,
        capabilities: ["reasoning", "code", "local"],
      },
      "qwen2.5": {
        id: "qwen2.5",
        displayName: "Qwen 2.5",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code", "local"],
      },
      "qwen3": {
        id: "qwen3",
        displayName: "Qwen 3",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code", "local"],
      },
      "qwen2.5-coder": {
        id: "qwen2.5-coder",
        displayName: "Qwen 2.5 Coder",
        contextWindow: 128_000,
        capabilities: ["code", "local"],
      },
      "phi4-mini": {
        id: "phi4-mini",
        displayName: "Phi-4 Mini",
        contextWindow: 16_000,
        capabilities: ["fast", "local"],
      },
      "deepseek-r1": {
        id: "deepseek-r1",
        displayName: "DeepSeek R1",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code", "local"],
      },
      "deepseek-v3": {
        id: "deepseek-v3",
        displayName: "DeepSeek V3",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code", "local"],
      },
      "gemma3": {
        id: "gemma3",
        displayName: "Gemma 3",
        contextWindow: 128_000,
        capabilities: ["fast", "local"],
      },
      "mistral": {
        id: "mistral",
        displayName: "Mistral",
        contextWindow: 32_000,
        capabilities: ["fast", "code", "local"],
      },
      "codellama": {
        id: "codellama",
        displayName: "Code Llama",
        contextWindow: 16_000,
        capabilities: ["code", "local"],
      },
      "command-r": {
        id: "command-r",
        displayName: "Command R",
        contextWindow: 128_000,
        capabilities: ["reasoning", "local"],
      },
    },
  },
  openrouter: {
    displayName: "OpenRouter",
    models: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-haiku-3.5",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
      "openai/o3",
      "openai/o3-mini",
      "openai/o4-mini",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "google/gemini-2.0-flash",
      "meta-llama/llama-4-scout",
      "meta-llama/llama-4-maverick",
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-r1",
      "deepseek/deepseek-v3",
      "qwen/qwen3-235b",
      "qwen/qwen3-32b",
      "mistralai/mistral-large",
      "mistralai/mistral-saba-24b",
    ],
    modelInfo: {
      "anthropic/claude-sonnet-4": {
        id: "anthropic/claude-sonnet-4",
        displayName: "Claude Sonnet 4 (OR)",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "anthropic/claude-opus-4": {
        id: "anthropic/claude-opus-4",
        displayName: "Claude Opus 4 (OR)",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "anthropic/claude-sonnet-4.5": {
        id: "anthropic/claude-sonnet-4.5",
        displayName: "Claude Sonnet 4.5 (OR)",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "anthropic/claude-haiku-3.5": {
        id: "anthropic/claude-haiku-3.5",
        displayName: "Claude Haiku 3.5 (OR)",
        contextWindow: 200_000,
        capabilities: ["fast", "code", "multimodal"],
      },
      "openai/gpt-4o": {
        id: "openai/gpt-4o",
        displayName: "GPT-4o (OR)",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "openai/gpt-4o-mini": {
        id: "openai/gpt-4o-mini",
        displayName: "GPT-4o Mini (OR)",
        contextWindow: 128_000,
        capabilities: ["fast", "code"],
      },
      "openai/gpt-4.1": {
        id: "openai/gpt-4.1",
        displayName: "GPT-4.1 (OR)",
        contextWindow: 1_000_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "openai/gpt-4.1-mini": {
        id: "openai/gpt-4.1-mini",
        displayName: "GPT-4.1 Mini (OR)",
        contextWindow: 1_000_000,
        capabilities: ["fast", "code", "multimodal"],
      },
      "openai/gpt-4.1-nano": {
        id: "openai/gpt-4.1-nano",
        displayName: "GPT-4.1 Nano (OR)",
        contextWindow: 1_000_000,
        capabilities: ["fast"],
      },
      "openai/o3": {
        id: "openai/o3",
        displayName: "o3 (OR)",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code"],
      },
      "openai/o3-mini": {
        id: "openai/o3-mini",
        displayName: "o3 Mini (OR)",
        contextWindow: 200_000,
        capabilities: ["reasoning", "fast"],
      },
      "openai/o4-mini": {
        id: "openai/o4-mini",
        displayName: "o4 Mini (OR)",
        contextWindow: 200_000,
        capabilities: ["reasoning", "code", "fast"],
      },
      "google/gemini-2.5-pro": {
        id: "google/gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro (OR)",
        contextWindow: 1_000_000,
        capabilities: ["reasoning", "code", "multimodal", "vision"],
      },
      "google/gemini-2.5-flash": {
        id: "google/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash (OR)",
        contextWindow: 1_000_000,
        capabilities: ["fast", "code", "multimodal"],
      },
      "google/gemini-2.0-flash": {
        id: "google/gemini-2.0-flash",
        displayName: "Gemini 2.0 Flash (OR)",
        contextWindow: 1_000_000,
        capabilities: ["fast", "code", "multimodal"],
      },
      "meta-llama/llama-4-scout": {
        id: "meta-llama/llama-4-scout",
        displayName: "Llama 4 Scout (OR)",
        contextWindow: 512_000,
        capabilities: ["reasoning", "code", "multimodal"],
      },
      "meta-llama/llama-4-maverick": {
        id: "meta-llama/llama-4-maverick",
        displayName: "Llama 4 Maverick (OR)",
        contextWindow: 512_000,
        capabilities: ["reasoning", "code", "multimodal"],
      },
      "meta-llama/llama-3.3-70b-instruct": {
        id: "meta-llama/llama-3.3-70b-instruct",
        displayName: "Llama 3.3 70B (OR)",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "deepseek/deepseek-r1": {
        id: "deepseek/deepseek-r1",
        displayName: "DeepSeek R1 (OR)",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "deepseek/deepseek-v3": {
        id: "deepseek/deepseek-v3",
        displayName: "DeepSeek V3 (OR)",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "qwen/qwen3-235b": {
        id: "qwen/qwen3-235b",
        displayName: "Qwen 3 235B (OR)",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "qwen/qwen3-32b": {
        id: "qwen/qwen3-32b",
        displayName: "Qwen 3 32B (OR)",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code", "fast"],
      },
      "mistralai/mistral-large": {
        id: "mistralai/mistral-large",
        displayName: "Mistral Large (OR)",
        contextWindow: 128_000,
        capabilities: ["reasoning", "code"],
      },
      "mistralai/mistral-saba-24b": {
        id: "mistralai/mistral-saba-24b",
        displayName: "Mistral Saba 24B (OR)",
        contextWindow: 32_000,
        capabilities: ["fast", "code"],
      },
    },
  },
}

/** Per-user engine/model preference. */
export interface ModelPreference {
  engine: string
  model?: string
}

/**
 * In-memory store for per-user model preferences.
 * Consumed by orchestrator.ts for routing overrides.
 */
class ModelPreferencesStore {
  private readonly preferences = new Map<string, ModelPreference>()

  /** Get the preference for a user, or null if not set. */
  get(userId: string): ModelPreference | null {
    return this.preferences.get(userId) ?? null
  }

  /** Set only the engine preference for a user. */
  setEngine(userId: string, engine: string): ModelPreference {
    const next = { engine }
    this.preferences.set(userId, next)
    return next
  }

  /** Set engine and model preference for a user. */
  setModel(userId: string, engine: string, model: string): ModelPreference {
    const next = { engine, model }
    this.preferences.set(userId, next)
    return next
  }

  /** Remove all preferences for a user. */
  reset(userId: string): void {
    this.preferences.delete(userId)
  }
}

export const modelPreferences = new ModelPreferencesStore()
