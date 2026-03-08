/**
 * @file user-preference.ts
 * @description UserPreferenceEngine — persistent per-user preference sliders with CIPHER-style
 *              inference from behavioral signals.
 *
 * ARCHITECTURE:
 *   Layer 1 (Operational): stored in UserPreference Prisma table, injected into every
 *   LLM call via PersonalityEngine → system-prompt-builder.ts.
 *
 *   Layer 2 (Episodic): profiler.ts already handles facts/opinions.
 *   This module handles the BEHAVIORAL dimension: formality, verbosity, humor, etc.
 *
 *   Signal flow:
 *     FeedbackStore.capture() → pendingSignals queue
 *     → inferenceCycle() (runs every PREFERENCE_INFERENCE_INTERVAL_MS)
 *     → updateSlider() → persisted to Prisma
 *     → PersonalityEngine reads snapshot → system prompt fragment updated
 *
 * PAPER BASIS:
 *   - CIPHER / PRELUDE (arXiv:2404.15269): preference inference from edit signals
 *   - PersonaMem (arXiv:2504.14225): temporal preference evolution with decay
 *   - PPP (arXiv:2511.02208): RPers reward dimension for explicit preference compliance
 *
 * @module memory/user-preference
 */

import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("memory.user-preference")

/** Preference slider names (subset of UserPreference model). */
export type PreferenceDimension = "formality" | "verbosity" | "humor" | "proactivity"

/** Tone preset options — controls EDITH's personality flavor. */
export type TonePreset = "jarvis" | "friday" | "cortana" | "hal" | "custom"

/**
 * A single CIPHER-inferred behavioral preference descriptor.
 * Stored as JSON in the `behavioralPrefs` column.
 */
export interface BehavioralPref {
  /** Short description of the preference, e.g. "Prefers bullet points over prose". */
  description: string
  /** Confidence 0–1. Low-confidence prefs are soft hints, high-confidence are hard constraints. */
  confidence: number
  /** Signal source: 'explicit' | 'edit' | 'barge-in' | 'implicit'. */
  source: "explicit" | "edit" | "barge-in" | "implicit"
  /** ISO timestamp of last update. */
  updatedAt: string
}

/**
 * Snapshot of a user's preference state at a point in time.
 * This is what PersonalityEngine receives to build the persona fragment.
 */
export interface PreferenceSnapshot {
  /** User ID. */
  userId: string
  /** Formality slider: 1 (casual) – 5 (formal). */
  formality: number
  /** Verbosity slider: 1 (brief) – 5 (detailed). */
  verbosity: number
  /** Humor slider: 0 (none) – 3 (frequent). */
  humor: number
  /** Proactivity slider: 1 (quiet) – 5 (very proactive). */
  proactivity: number
  /** Preferred response language. */
  language: string
  /** How to address the user (default: "Sir"). */
  titleWord: string
  /** Tone preset. */
  tonePreset: TonePreset
  /** CIPHER-inferred behavioral preferences. */
  behavioralPrefs: BehavioralPref[]
  /** Custom personality traits (string[]). */
  customTraits: string[]
  /** How confident the inference engine is (0–1). */
  inferenceConfidence: number
}

/** Minimum slider value (all sliders). */
const SLIDER_MIN = 1
/** Maximum slider for formality / verbosity / proactivity. */
const SLIDER_MAX_MAIN = 5
/** Maximum slider for humor. */
const SLIDER_MAX_HUMOR = 3

/**
 * Clamp a slider value to its valid range.
 */
function clampSlider(value: number, dimension: PreferenceDimension): number {
  const max = dimension === "humor" ? SLIDER_MAX_HUMOR : SLIDER_MAX_MAIN
  const clamped = Math.max(SLIDER_MIN, Math.min(max, value))
  return Math.round(clamped * 10) / 10 // 1 decimal place
}

/**
 * Build a default PreferenceSnapshot for a new user.
 */
function defaultSnapshot(userId: string): PreferenceSnapshot {
  return {
    userId,
    formality: 3,
    verbosity: 2,
    humor: 1,
    proactivity: 3,
    language: "auto",
    titleWord: config.DEFAULT_TITLE_WORD,
    tonePreset: config.DEFAULT_TONE_PRESET,
    behavioralPrefs: [],
    customTraits: [],
    inferenceConfidence: 0,
  }
}

/**
 * Safe JSON parse that returns a fallback on failure.
 */
function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) {
    return fallback
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as T
  }
  if (Array.isArray(raw)) {
    return raw as unknown as T
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
  return fallback
}

/**
 * UserPreferenceEngine manages per-user preference sliders and CIPHER-style
 * behavioral preference inference.
 *
 * Public API:
 *   - getSnapshot(userId): PreferenceSnapshot — read snapshot for injection into prompt
 *   - applySignal(userId, dimension, delta, confidence): queue a preference update
 *   - setCipher(userId, prefs): update CIPHER-inferred behavioral prefs
 *   - setSlider(userId, dimension, value): explicit slider override
 *   - runInferenceCycle(userId): process pending signals and infer from history
 */
export class UserPreferenceEngine {
  /** In-memory cache of preference snapshots for fast per-turn access. */
  private readonly cache = new Map<string, PreferenceSnapshot>()

  /**
   * Get the current preference snapshot for a user.
   * Returns default preferences for new users (never throws).
   */
  async getSnapshot(userId: string): Promise<PreferenceSnapshot> {
    const cached = this.cache.get(userId)
    if (cached) {
      return cached
    }

    try {
      const record = await prisma.userPreference.findUnique({ where: { userId } })

      if (!record) {
        const snap = defaultSnapshot(userId)
        this.cache.set(userId, snap)
        return snap
      }

      const snap: PreferenceSnapshot = {
        userId: record.userId,
        formality: record.formality,
        verbosity: record.verbosity,
        humor: record.humor,
        proactivity: record.proactivity,
        language: record.language,
        titleWord: record.titleWord,
        tonePreset: record.tonePreset as TonePreset,
        behavioralPrefs: safeParseJson<BehavioralPref[]>(record.behavioralPrefs, []),
        customTraits: safeParseJson<string[]>(record.customTraits, []),
        inferenceConfidence: record.inferenceConfidence,
      }

      this.cache.set(userId, snap)
      return snap
    } catch (err) {
      log.warn("getSnapshot failed, returning defaults", { userId, err })
      return defaultSnapshot(userId)
    }
  }

  /**
   * Apply a delta signal to a preference slider (exponential moving average).
   *
   * @param userId     - User to update
   * @param dimension  - Slider to adjust
   * @param delta      - Direction: +1 (increase) / -1 (decrease) / 0 (confirm)
   * @param confidence - Signal confidence (0–1)
   */
  async applySignal(
    userId: string,
    dimension: PreferenceDimension,
    delta: number,
    confidence = 0.5,
  ): Promise<void> {
    try {
      const snap = await this.getSnapshot(userId)
      const current = snap[dimension] as number
      const scaledDelta = delta * confidence * config.PREFERENCE_ALPHA
      const updated = clampSlider(current + scaledDelta, dimension)

      await this.persistSliderUpdate(userId, dimension, updated)
      this.invalidateCache(userId)

      log.debug("preference signal applied", {
        userId,
        dimension,
        oldValue: current,
        newValue: updated,
        delta,
        confidence,
      })
    } catch (err) {
      log.warn("applySignal failed", { userId, dimension, err })
    }
  }

  /**
   * Explicitly set a slider to a value (user-configured override).
   */
  async setSlider(userId: string, dimension: PreferenceDimension, value: number): Promise<void> {
    const clamped = clampSlider(value, dimension)
    await this.persistSliderUpdate(userId, dimension, clamped)
    this.invalidateCache(userId)
    log.info("slider set explicitly", { userId, dimension, value: clamped })
  }

  /**
   * Update CIPHER-inferred behavioral preferences.
   * Replaces the existing behavioralPrefs array for this user.
   */
  async setCipher(userId: string, prefs: BehavioralPref[]): Promise<void> {
    try {
      await prisma.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          behavioralPrefs: prefs as unknown as object[],
        },
        update: {
          behavioralPrefs: prefs as unknown as object[],
          lastInferredAt: new Date(),
        },
      })
      this.invalidateCache(userId)
    } catch (err) {
      log.warn("setCipher failed", { userId, err })
    }
  }

  /**
   * Set the user's preferred language.
   */
  async setLanguage(userId: string, language: string): Promise<void> {
    try {
      await prisma.userPreference.upsert({
        where: { userId },
        create: { userId, language },
        update: { language },
      })
      this.invalidateCache(userId)
    } catch (err) {
      log.warn("setLanguage failed", { userId, err })
    }
  }

  /**
   * Set the user's tone preset.
   */
  async setTonePreset(userId: string, preset: TonePreset): Promise<void> {
    try {
      await prisma.userPreference.upsert({
        where: { userId },
        create: { userId, tonePreset: preset },
        update: { tonePreset: preset },
      })
      this.invalidateCache(userId)
      log.info("tone preset updated", { userId, preset })
    } catch (err) {
      log.warn("setTonePreset failed", { userId, err })
    }
  }

  /**
   * Set the user's preferred title word (e.g. "Sir", "Bro", "Boss").
   */
  async setTitleWord(userId: string, titleWord: string): Promise<void> {
    try {
      await prisma.userPreference.upsert({
        where: { userId },
        create: { userId, titleWord },
        update: { titleWord },
      })
      this.invalidateCache(userId)
    } catch (err) {
      log.warn("setTitleWord failed", { userId, err })
    }
  }

  /**
   * Run a CIPHER-style inference cycle for a user.
   *
   * Reads recent messages from the profiler, calls the LLM to infer
   * latent preferences, and updates the behavioralPrefs array.
   *
   * This is intended to be called asynchronously (fire-and-forget from pipeline).
   */
  async runInferenceCycle(userId: string, recentMessages: string[]): Promise<void> {
    if (!config.PERSONALIZATION_ENABLED || recentMessages.length < 3) {
      return
    }

    try {
      const existing = await this.getSnapshot(userId)
      const context = recentMessages.slice(-10).join("\n---\n")

      const prompt = [
        "You are analyzing a user's communication style to infer their preferences.",
        "Based on these recent messages, identify 1–3 concrete behavioral preferences.",
        "Return a JSON array: [{\"description\": \"...\", \"confidence\": 0.0–1.0}]",
        "Focus on: response length, formality, language choice, format (bullets/prose), humor.",
        "Only return JSON. No other text.",
        "",
        "Messages:",
        context,
        "",
        "Existing known preferences (skip if already captured):",
        existing.behavioralPrefs.map((p) => `- ${p.description}`).join("\n") || "(none)",
      ].join("\n")

      const raw = await orchestrator.generate("fast", { prompt })
      const cleaned = raw.replace(/```json|```/g, "").trim()

      let inferred: Array<{ description?: string; confidence?: number }> = []
      try {
        inferred = JSON.parse(cleaned) as typeof inferred
      } catch {
        log.debug("inference cycle: could not parse LLM response", { userId })
        return
      }

      if (!Array.isArray(inferred) || inferred.length === 0) {
        return
      }

      const newPrefs: BehavioralPref[] = inferred
        .filter((item) => item.description && item.description.trim().length > 5)
        .map((item) => ({
          description: item.description!.trim(),
          confidence: Math.min(1, Math.max(0, Number(item.confidence ?? 0.5))),
          source: "implicit" as const,
          updatedAt: new Date().toISOString(),
        }))

      if (newPrefs.length === 0) {
        return
      }

      // Merge with existing (avoid duplicates by description similarity)
      const merged = this.mergePrefs(existing.behavioralPrefs, newPrefs)
      await this.setCipher(userId, merged)

      // Update inference confidence
      const newConfidence = Math.min(1, existing.inferenceConfidence + 0.05 * newPrefs.length)
      await prisma.userPreference.update({
        where: { userId },
        data: { inferenceConfidence: newConfidence, lastInferredAt: new Date() },
      })
      this.invalidateCache(userId)

      log.info("inference cycle complete", {
        userId,
        newPrefs: newPrefs.length,
        totalPrefs: merged.length,
        confidence: newConfidence,
      })
    } catch (err) {
      log.warn("inference cycle failed", { userId, err })
    }
  }

  // ============================================================
  //  Private helpers
  // ============================================================

  private async persistSliderUpdate(
    userId: string,
    dimension: PreferenceDimension,
    value: number,
  ): Promise<void> {
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, [dimension]: value },
      update: { [dimension]: value },
    })
  }

  private invalidateCache(userId: string): void {
    this.cache.delete(userId)
  }

  /**
   * Merge new inferred prefs with existing ones, avoiding near-duplicates.
   * Simple heuristic: if description overlap > 50%, skip the new one.
   */
  private mergePrefs(existing: BehavioralPref[], incoming: BehavioralPref[]): BehavioralPref[] {
    const result = [...existing]

    for (const newPref of incoming) {
      const isDuplicate = existing.some((e) => {
        const overlap = this.wordOverlapRatio(e.description, newPref.description)
        return overlap > 0.5
      })

      if (!isDuplicate) {
        result.push(newPref)
      }
    }

    // Keep at most 15 prefs (prevent unbounded growth)
    return result.slice(-15)
  }

  private wordOverlapRatio(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/))
    const wordsB = new Set(b.toLowerCase().split(/\s+/))
    const intersection = [...wordsA].filter((word) => wordsB.has(word)).length
    const union = new Set([...wordsA, ...wordsB]).size
    return union > 0 ? intersection / union : 0
  }
}

/** Singleton export. */
export const userPreferenceEngine = new UserPreferenceEngine()
