/**
 * model-preferences.ts — Per-user model/engine selection preferences.
 *
 * Stores user preferences in-memory with optional persistence to Prisma.
 * Users can set:
 *   - Preferred engine (e.g. "gemini", "groq", "anthropic")
 *   - Specific model override (e.g. "gemini-2.0-flash", "gpt-4o-mini")
 *   - Task type priority override
 *
 * @module engines/model-preferences
 */

import { createLogger } from "../logger.js"

const log = createLogger("engines.model-preferences")

export interface UserModelPreference {
    /** Preferred engine name (e.g. "gemini", "groq") — null means auto */
    engine: string | null
    /** Specific model identifier (e.g. "gemini-2.0-flash") — null means engine default */
    model: string | null
    /** When this preference was last set */
    updatedAt: number
}

/** Available models per engine, shown to user in /models command */
export const ENGINE_MODEL_CATALOG: Record<string, { displayName: string; models: string[] }> = {
    gemini: {
        displayName: "Google Gemini",
        models: [
            "gemini-2.0-flash",
            "gemini-2.5-flash-preview-05-20",
            "gemini-2.5-pro-preview-05-06",
            "gemini-1.5-flash",
        ],
    },
    openai: {
        displayName: "OpenAI",
        models: [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4.1-nano",
            "o4-mini",
        ],
    },
    anthropic: {
        displayName: "Anthropic",
        models: [
            "claude-sonnet-4-20250514",
            "claude-haiku-4-20250514",
            "claude-3-5-haiku-20241022",
        ],
    },
    groq: {
        displayName: "Groq (Fast)",
        models: [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
            "gemma2-9b-it",
        ],
    },
    openrouter: {
        displayName: "OpenRouter",
        models: [
            "anthropic/claude-sonnet-4",
            "google/gemini-2.0-flash-001",
            "meta-llama/llama-3.3-70b-instruct",
        ],
    },
    ollama: {
        displayName: "Ollama (Local)",
        models: ["llama3.2", "mistral", "codellama", "phi3"],
    },
}

class ModelPreferences {
    private readonly preferences = new Map<string, UserModelPreference>()

    /** Get the model preference for a user. Returns null if not set (auto mode). */
    get(userId: string): UserModelPreference | null {
        return this.preferences.get(userId) ?? null
    }

    /** Set the user's preferred engine (e.g. "gemini"). Set to null for auto. */
    setEngine(userId: string, engine: string | null): UserModelPreference {
        const pref = this.getOrCreate(userId)
        pref.engine = engine
        pref.model = null // reset model when engine changes
        pref.updatedAt = Date.now()
        this.preferences.set(userId, pref)
        log.info("user engine preference updated", { userId, engine })
        return pref
    }

    /** Set a specific model override (e.g. "gpt-4o-mini"). */
    setModel(userId: string, engine: string, model: string): UserModelPreference {
        const pref = this.getOrCreate(userId)
        pref.engine = engine
        pref.model = model
        pref.updatedAt = Date.now()
        this.preferences.set(userId, pref)
        log.info("user model preference updated", { userId, engine, model })
        return pref
    }

    /** Clear all preferences (back to auto). */
    reset(userId: string): void {
        this.preferences.delete(userId)
        log.info("user preferences reset to auto", { userId })
    }

    /** Get all users with active preferences. */
    listActive(): Array<{ userId: string; preference: UserModelPreference }> {
        return Array.from(this.preferences.entries()).map(([userId, preference]) => ({
            userId,
            preference,
        }))
    }

    /** Resolve engine name from a model string. Returns null if unknown. */
    resolveEngineFromModel(modelName: string): string | null {
        const lower = modelName.toLowerCase()

        for (const [engineName, catalog] of Object.entries(ENGINE_MODEL_CATALOG)) {
            for (const m of catalog.models) {
                if (m.toLowerCase() === lower || lower.startsWith(m.toLowerCase().split("-")[0])) {
                    return engineName
                }
            }
        }

        // Heuristic matching
        if (lower.startsWith("gemini") || lower.startsWith("palm")) return "gemini"
        if (lower.startsWith("gpt") || lower.startsWith("o1") || lower.startsWith("o3") || lower.startsWith("o4")) return "openai"
        if (lower.startsWith("claude")) return "anthropic"
        if (lower.startsWith("llama") || lower.startsWith("mixtral") || lower.startsWith("gemma")) return "groq"
        if (lower.includes("/")) return "openrouter"

        return null
    }

    private getOrCreate(userId: string): UserModelPreference {
        return this.preferences.get(userId) ?? {
            engine: null,
            model: null,
            updatedAt: Date.now(),
        }
    }
}

export const modelPreferences = new ModelPreferences()
