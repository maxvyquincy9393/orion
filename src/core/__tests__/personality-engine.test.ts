/**
 * @file personality-engine.test.ts
 * @description Unit tests for PersonalityEngine (Phase 10D).
 */

import { describe, it, expect } from "vitest"
import { PersonalityEngine } from "../personality-engine.js"
import type { PreferenceSnapshot } from "../../memory/user-preference.js"

function makeSnapshot(overrides: Partial<PreferenceSnapshot> = {}): PreferenceSnapshot {
  return {
    userId: "user-1",
    formality: 3,
    verbosity: 2,
    humor: 1,
    proactivity: 3,
    language: "auto",
    titleWord: "Sir",
    tonePreset: "jarvis",
    behavioralPrefs: [],
    customTraits: [],
    inferenceConfidence: 0,
    ...overrides,
  }
}

describe("PersonalityEngine", () => {
  const engine = new PersonalityEngine()

  describe("buildPersonaFragment", () => {
    it("returns a non-empty string for default snapshot", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot())
      expect(fragment.length).toBeGreaterThan(0)
    })

    it("includes title word in fragment", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ titleWord: "Boss" }))
      expect(fragment).toContain("Boss")
    })

    it("includes jarvis tone description", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ tonePreset: "jarvis" }))
      expect(fragment.toLowerCase()).toContain("professional")
    })

    it("includes friday tone description", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ tonePreset: "friday" }))
      expect(fragment.toLowerCase()).toContain("warm")
    })

    it("includes cortana tone description", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ tonePreset: "cortana" }))
      expect(fragment.toLowerCase()).toContain("clear")
    })

    it("includes hal tone description", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ tonePreset: "hal" }))
      expect(fragment.toLowerCase()).toContain("minimal")
    })

    it("includes verbosity=1 (brief) instruction", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ verbosity: 1 }))
      expect(fragment.toLowerCase()).toContain("brief")
    })

    it("includes verbosity=5 (detailed) instruction", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ verbosity: 5 }))
      expect(fragment.toLowerCase()).toContain("comprehensive")
    })

    it("includes formality=1 (casual) instruction", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ formality: 1 }))
      expect(fragment.toLowerCase()).toContain("casual")
    })

    it("includes formality=5 (formal) instruction", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ formality: 5 }))
      expect(fragment.toLowerCase()).toContain("formal")
    })

    it("includes humor=0 (no humor) instruction", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ humor: 0 }))
      expect(fragment.toLowerCase()).toContain("no humor")
    })

    it("includes language instruction when language is not auto", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ language: "id" }))
      expect(fragment.toUpperCase()).toContain("ID")
    })

    it("does not include language instruction for auto", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({ language: "auto" }))
      expect(fragment).not.toContain("Always respond in")
    })

    it("includes high-confidence behavioral prefs (>= 0.6)", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({
        behavioralPrefs: [
          { description: "Prefers bullet points", confidence: 0.8, source: "implicit", updatedAt: "" },
          { description: "Avoid jargon", confidence: 0.4, source: "implicit", updatedAt: "" }, // low conf
        ],
      }))
      expect(fragment).toContain("Prefers bullet points")
      expect(fragment).not.toContain("Avoid jargon") // below 0.6 threshold
    })

    it("includes custom traits", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({
        customTraits: ["Never start sentences with 'I'"],
      }))
      expect(fragment).toContain("Never start sentences with 'I'")
    })

    it("includes confidence caveat for very new users", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({
        inferenceConfidence: 0,
        behavioralPrefs: [],
      }))
      expect(fragment.toLowerCase()).toContain("still being learned")
    })

    it("uses custom traits for custom preset", () => {
      const fragment = engine.buildPersonaFragment(makeSnapshot({
        tonePreset: "custom",
        customTraits: ["Always use emojis"],
      }))
      expect(fragment).toContain("Custom personality")
      expect(fragment).toContain("Always use emojis")
    })
  })

  describe("inferVerbositySignalFromBargeIn", () => {
    it("returns strong negative signal for very early barge-in (<25%)", () => {
      const result = engine.inferVerbositySignalFromBargeIn(1000, 100)
      expect(result.delta).toBe(-1)
      expect(result.confidence).toBeGreaterThan(0.7)
    })

    it("returns moderate negative signal for mid barge-in (25–50%)", () => {
      const result = engine.inferVerbositySignalFromBargeIn(1000, 300)
      expect(result.delta).toBeLessThan(0)
      expect(result.confidence).toBeLessThan(0.8)
    })

    it("returns zero delta when no barge-in occurred", () => {
      const result = engine.inferVerbositySignalFromBargeIn(1000, null)
      expect(result.delta).toBe(0)
      expect(result.confidence).toBe(0)
    })
  })

  describe("detectLanguageFromMessage", () => {
    it("detects Indonesian from typical Indonesian message", () => {
      const lang = engine.detectLanguageFromMessage("halo, apa yang bisa saya bantu untuk kamu hari ini?")
      expect(lang).toBe("id")
    })

    it("detects English from typical English message", () => {
      const lang = engine.detectLanguageFromMessage("what is the weather like today and is it going to rain?")
      expect(lang).toBe("en")
    })

    it("returns null for short or ambiguous message", () => {
      const lang = engine.detectLanguageFromMessage("ok")
      expect(lang).toBeNull()
    })
  })
})
