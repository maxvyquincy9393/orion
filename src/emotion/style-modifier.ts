/**
 * @file style-modifier.ts
 * @description Converts a MoodProfile into a StyleModifier and system-prompt fragment.
 *
 * ARCHITECTURE:
 *   Called by system-prompt-builder.ts to inject tone adjustments.
 *   The modifier never changes WHAT EDITH says — only HOW she says it.
 *   No user message is modified; only EDITH's response style is adjusted.
 */

import type { MoodProfile, StyleModifier } from "./emotion-schema.js"

/**
 * Generates a StyleModifier and a human-readable system-prompt fragment
 * based on the user's current mood profile.
 */
export class StyleModifierGenerator {
  /**
   * Derives a StyleModifier from a mood profile.
   *
   * @param profile - Current mood profile from MoodTracker
   * @returns StyleModifier with tone/brevity/humor/formality/empathy values
   */
  getModifier(profile: MoodProfile): StyleModifier {
    const { dominant, averageScore: avg } = profile

    // Base modifier starts at neutral midpoints.
    const mod: StyleModifier = {
      tone: "natural and attentive",
      brevity: 0.5,
      humor: 0.3,
      formality: 0.5,
      empathy: 0.4,
    }

    switch (dominant) {
      case "joy":
        mod.tone = "warm and celebratory"
        mod.humor = Math.min(0.7, avg.joy * 0.8)
        mod.brevity = 0.4
        break
      case "sadness":
        mod.tone = "gentle and supportive"
        mod.empathy = 0.85
        mod.brevity = 0.6
        mod.humor = 0.0
        break
      case "anger":
        mod.tone = "calm and measured"
        mod.brevity = 0.7
        mod.formality = 0.6
        mod.humor = 0.0
        mod.empathy = 0.5
        break
      case "fear":
        mod.tone = "reassuring and clear"
        mod.empathy = 0.8
        mod.brevity = 0.65
        mod.humor = 0.0
        break
      case "surprise":
        mod.tone = "engaged and responsive"
        mod.brevity = 0.4
        mod.humor = 0.35
        break
      case "disgust":
        mod.tone = "respectful and solution-focused"
        mod.humor = 0.0
        mod.brevity = 0.6
        break
      case "neutral":
      default:
        // Keep defaults.
        break
    }

    return mod
  }

  /**
   * Converts a StyleModifier into a short system-prompt injection string.
   * Designed to be dropped into the tail of the system prompt.
   *
   * @param mod - Style modifier derived from mood
   * @returns A 1-2 sentence style guidance string
   */
  toPromptFragment(mod: StyleModifier): string {
    const brevityDesc =
      mod.brevity > 0.7
        ? "Keep responses concise."
        : mod.brevity < 0.3
          ? "Feel free to be thorough."
          : ""

    const humorDesc = mod.humor > 0.5 ? "Light humour is appropriate." : ""
    const empathyDesc = mod.empathy > 0.7 ? "Lead with empathy and validation." : ""

    const parts = [
      `Adopt a ${mod.tone} tone.`,
      empathyDesc,
      brevityDesc,
      humorDesc,
    ].filter(Boolean)

    return parts.join(" ")
  }
}

export const styleModifierGenerator = new StyleModifierGenerator()
