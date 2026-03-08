/**
 * @file personality-engine.ts
 * @description PersonalityEngine — converts per-user preference snapshots into a
 *              user-specific system prompt fragment injected on every LLM call.
 *
 * ARCHITECTURE:
 *   This module sits between UserPreferenceEngine and system-prompt-builder.ts:
 *
 *     UserPreferenceEngine.getSnapshot(userId)
 *       → PersonalityEngine.buildPersonaFragment(userId, snapshot)
 *         → injected as `extraContext` in buildSystemPrompt()
 *
 *   Static identity (who EDITH is) lives in workspace/SOUL.md.
 *   This module handles the DYNAMIC, PER-USER layer: tone, formality, address style.
 *   It does NOT replace SOUL.md — it extends the runtime context after it.
 *
 * PAPER BASIS:
 *   - PersonaAgent (arXiv:2506.06254): "unique system prompt per user = persona"
 *   - PPP (arXiv:2511.02208): explicit preference compliance (RPers reward)
 *   - Toward Personalized LLM Survey (arXiv:2602.22680): behavioral vs topical prefs
 *
 * @module core/personality-engine
 */

import { createLogger } from "../logger.js"
import type { PreferenceSnapshot, TonePreset } from "../memory/user-preference.js"

const log = createLogger("core.personality-engine")

/**
 * Tone preset descriptors — these are the "personality templates" EDITH can adopt.
 * They modulate HOW she communicates, not WHO she is (SOUL.md handles that).
 */
const TONE_PRESET_DESCRIPTORS: Record<TonePreset, string> = {
  jarvis: "Professional, British-inflected, dry wit. Competent and composed. Never casual, never warm beyond professional warmth. Think J.A.R.V.I.S. from Iron Man.",
  friday: "Warm, supportive, slightly playful. Irish-inspired lightness. Efficient but approachable. Like FRIDAY — caring but never sycophantic.",
  cortana: "Clear, precise, neutral. Focus on clarity and structure. Like Cortana — helpful, to the point, no unnecessary personality.",
  hal: "Minimal. Calm. Extremely concise. No filler words. Answer the question and stop. Like HAL 9000 minus the existential dread.",
  custom: "", // Built entirely from customTraits
}

/**
 * Verbosity level descriptors.
 * Maps slider value (1–5) to a prompt instruction.
 */
const VERBOSITY_DESCRIPTORS: Record<number, string> = {
  1: "Keep responses extremely brief — 1–2 sentences maximum unless more is truly necessary.",
  2: "Keep responses concise. Favor brevity. Skip preamble and filler.",
  3: "Use balanced length — enough to be helpful, not more.",
  4: "Be thorough. Include relevant context, examples, and reasoning.",
  5: "Be comprehensive. Full explanations, examples, and depth are expected and welcomed.",
}

/**
 * Formality level descriptors.
 */
const FORMALITY_DESCRIPTORS: Record<number, string> = {
  1: "Use very casual, informal language. Contractions, slang, and direct style are fine.",
  2: "Keep it casual and conversational. Friendly and direct.",
  3: "Use neutral, everyday language. Neither formal nor casual.",
  4: "Maintain a professional tone. Precise vocabulary, complete sentences.",
  5: "Use formal language throughout. Precise, structured, and professional at all times.",
}

/**
 * Humor level descriptors.
 */
const HUMOR_DESCRIPTORS: Record<number, string> = {
  0: "No humor. Keep responses purely informative and task-focused.",
  1: "Occasional subtle wit is fine, but humor should never dominate.",
  2: "Light humor and wordplay are welcome when contextually appropriate.",
  3: "Humor is a valued part of the interaction. Be witty, clever, and playful when fitting.",
}

/**
 * Nearest-match lookup for slider values (handles float sliders).
 */
function lookupDescriptor(map: Record<number, string>, value: number): string {
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b)
  const rounded = Math.round(value)
  const clamped = Math.max(keys[0]!, Math.min(keys[keys.length - 1]!, rounded))
  return map[clamped] ?? map[keys[0]!] ?? ""
}

/**
 * PersonalityEngine — builds a per-user system prompt fragment from a PreferenceSnapshot.
 *
 * The fragment is designed to be injected AFTER SOUL.md in the system prompt assembly,
 * so static persona always takes precedence over dynamic user preferences.
 */
export class PersonalityEngine {
  /**
   * Build the persona fragment for a user based on their preference snapshot.
   *
   * @param snapshot - The current preference snapshot from UserPreferenceEngine
   * @returns A formatted string to inject as `extraContext` in buildSystemPrompt()
   */
  buildPersonaFragment(snapshot: PreferenceSnapshot): string {
    const sections: string[] = []

    sections.push("# User Preferences (Dynamic — learned from interactions)")

    // Address preference
    if (snapshot.titleWord && snapshot.titleWord !== "Sir") {
      sections.push(`Address the user as "${snapshot.titleWord}".`)
    } else {
      sections.push(`Address the user as "${snapshot.titleWord}".`)
    }

    // Tone preset
    const toneDesc = snapshot.tonePreset === "custom"
      ? this.buildCustomToneDescription(snapshot.customTraits)
      : TONE_PRESET_DESCRIPTORS[snapshot.tonePreset]

    if (toneDesc) {
      sections.push(`Tone: ${toneDesc}`)
    }

    // Verbosity
    const verbDesc = lookupDescriptor(VERBOSITY_DESCRIPTORS, snapshot.verbosity)
    if (verbDesc) {
      sections.push(`Response length: ${verbDesc}`)
    }

    // Formality
    const formalDesc = lookupDescriptor(FORMALITY_DESCRIPTORS, snapshot.formality)
    if (formalDesc) {
      sections.push(`Formality: ${formalDesc}`)
    }

    // Humor
    const humorDesc = lookupDescriptor(HUMOR_DESCRIPTORS, Math.round(snapshot.humor))
    if (humorDesc) {
      sections.push(`Humor: ${humorDesc}`)
    }

    // Language
    if (snapshot.language !== "auto") {
      sections.push(
        `Language: Always respond in ${snapshot.language.toUpperCase()} unless the user switches language.`,
      )
    }

    // CIPHER-inferred behavioral preferences (high-confidence ones only)
    const highConfPrefs = snapshot.behavioralPrefs
      .filter((p) => p.confidence >= 0.6)
      .slice(0, 5)

    if (highConfPrefs.length > 0) {
      sections.push("Behavioral preferences (learned from this user's patterns):")
      for (const pref of highConfPrefs) {
        sections.push(`- ${pref.description}`)
      }
    }

    // Custom traits
    if (snapshot.customTraits.length > 0) {
      sections.push("Custom personality traits:")
      for (const trait of snapshot.customTraits) {
        sections.push(`- ${trait}`)
      }
    }

    // Confidence caveat for low-confidence state
    if (snapshot.inferenceConfidence < 0.3 && snapshot.behavioralPrefs.length === 0) {
      sections.push(
        "Note: User preferences are still being learned. Apply defaults conservatively.",
      )
    }

    const fragment = sections.join("\n")

    log.debug("persona fragment built", {
      userId: snapshot.userId,
      tonePreset: snapshot.tonePreset,
      verbosity: snapshot.verbosity,
      formality: snapshot.formality,
      language: snapshot.language,
      inferredPrefs: highConfPrefs.length,
      confidence: snapshot.inferenceConfidence,
    })

    return fragment
  }

  /**
   * Build a custom tone description from an array of trait strings.
   * Used when tonePreset === 'custom'.
   */
  private buildCustomToneDescription(traits: string[]): string {
    if (traits.length === 0) {
      return TONE_PRESET_DESCRIPTORS.jarvis
    }
    return `Custom personality: ${traits.join(". ")}.`
  }

  /**
   * Infer a delta signal for the verbosity slider from a barge-in event.
   * Returns +1 (response was too short), -1 (response was too long), or 0.
   *
   * A barge-in that happens very early in a response suggests the response was too long.
   * No barge-in after a long response suggests the length was appropriate.
   *
   * @param responseLengthChars   - Character count of the assistant's response
   * @param bargedInAtCharOffset  - Character offset where user interrupted (null = no barge-in)
   */
  inferVerbositySignalFromBargeIn(
    responseLengthChars: number,
    bargedInAtCharOffset: number | null,
  ): { delta: number; confidence: number } {
    if (bargedInAtCharOffset === null) {
      // No barge-in — neutral
      return { delta: 0, confidence: 0 }
    }

    const completionRatio = bargedInAtCharOffset / Math.max(1, responseLengthChars)

    if (completionRatio < 0.25) {
      // Interrupted very early — response was too long
      return { delta: -1, confidence: 0.8 }
    }

    if (completionRatio < 0.5) {
      // Interrupted halfway — probably too long
      return { delta: -0.5, confidence: 0.5 }
    }

    // Interrupted late — mild signal
    return { delta: -0.25, confidence: 0.3 }
  }

  /**
   * Detect a language preference change from message text.
   * Returns the detected language code or null if undetermined.
   */
  detectLanguageFromMessage(message: string): string | null {
    // Simple heuristic: count Indonesian vs English keywords
    const indonesianMarkers = ["yang", "dan", "ke", "di", "itu", "ini", "untuk", "dengan", "dari", "saya", "kamu", "aku", "lu", "gue"]
    const englishMarkers = ["the", "and", "to", "of", "is", "in", "that", "this", "for", "with", "you", "it", "are", "be"]

    const words = message.toLowerCase().split(/\s+/)
    const idCount = words.filter((w) => indonesianMarkers.includes(w)).length
    const enCount = words.filter((w) => englishMarkers.includes(w)).length

    const total = words.length
    if (total < 5) {
      return null
    }

    if (idCount / total > 0.15) {
      return "id"
    }
    if (enCount / total > 0.15) {
      return "en"
    }

    return null
  }
}

/** Singleton export. */
export const personalityEngine = new PersonalityEngine()
