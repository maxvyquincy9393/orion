/**
 * @file emotion-engine.test.ts
 * @description Tests for detectEmotion(), emotionToVoiceParams(), and
 * getVoiceParamsForText() — the affective voice layer.
 */

import { describe, it, expect } from "vitest"
import {
  detectEmotion,
  emotionToVoiceParams,
  getVoiceParamsForText,
} from "../emotion-engine.js"

describe("detectEmotion — lexicon detection", () => {
  it("returns 'calm' by default when no strong signal", () => {
    expect(detectEmotion("Here is the information you requested.")).toBe("calm")
  })

  it("detects urgent from urgency keywords", () => {
    const result = detectEmotion("CRITICAL: system is down immediately — emergency!")
    expect(result).toBe("urgent")
  })

  it("detects excited from excitement keywords", () => {
    const result = detectEmotion("Great news — we achieved success! Luar biasa!")
    expect(result).toBe("excited")
  })

  it("detects apologetic from apology keywords", () => {
    const result = detectEmotion("I apologize, my mistake — I was wrong and I'm sorry.")
    expect(result).toBe("apologetic")
  })

  it("detects warm from warm keywords", () => {
    const result = detectEmotion("Of course! Happy to help. I'm here for you.")
    expect(result).toBe("warm")
  })

  it("detects concerned from problem keywords", () => {
    const result = detectEmotion("Unfortunately there is a critical issue — the system failed and cannot recover.")
    expect(result).toBe("concerned")
  })

  it("detects formal from formal language", () => {
    const result = detectEmotion(
      "Pursuant to the agreement and in accordance with the guidelines, furthermore notwithstanding the circumstances, hereby the decision is therefore final.",
    )
    expect(result).toBe("formal")
  })

  it("detects playful from casual markers", () => {
    const result = detectEmotion("Haha, guess what? Fun fact: that is actually super interesting!")
    expect(["playful", "warm", "excited"]).toContain(result) // all acceptable
  })

  it("detects Indonesian urgent keywords", () => {
    // Longer text (>8 words) avoids the short-text calm structural bias
    const result = detectEmotion(
      "Darurat darurat! Situasi sangat bahaya dan segera memerlukan tindakan cepat peringatan kritis sekarang!",
    )
    expect(result).toBe("urgent")
  })

  it("detects Indonesian warm keywords", () => {
    // "senang membantu" phrase triggers phrase-match; "tentu" triggers word-match
    const result = detectEmotion(
      "Tentu! Saya senang membantu Anda. Dengan senang hati, tentu saja siap membantu kapanpun.",
    )
    expect(result).toBe("warm")
  })
})

describe("detectEmotion — structural signals", () => {
  it("treats CAPS WORDS as urgency signal", () => {
    const result = detectEmotion("WARNING WARNING WARNING — DO NOT proceed.")
    expect(result).toBe("urgent")
  })

  it("treats multiple exclamation marks as excitement boost", () => {
    const result = detectEmotion("We succeeded!! The project is done!! Amazing results!!")
    // excited is boosted by !! on top of lexicon
    expect(result).toBe("excited")
  })

  it("defaults to calm for very short responses", () => {
    expect(detectEmotion("Sure.")).toBe("calm")
    expect(detectEmotion("Here you go.")).toBe("calm")
  })
})

describe("detectEmotion — context biasing", () => {
  it("late night (hour 23) softens to calm even with weak signal", () => {
    const result = detectEmotion("Here is a summary.", { hourOfDay: 23 })
    expect(result).toBe("calm")
  })

  it("urgency=2 context boosts urgent emotion", () => {
    const result = detectEmotion("Please check the status.", { urgency: 2 })
    expect(result).toBe("urgent")
  })

  it("urgency=0 does not force urgent", () => {
    const result = detectEmotion("Here is a friendly greeting, hope you are well.", { urgency: 0 })
    expect(result).not.toBe("urgent")
  })

  it("jarvis preset biases toward calm/formal", () => {
    // A warmish text under jarvis stays calm
    const result = detectEmotion("Of course, I can assist you with that.", { tonePreset: "jarvis" })
    expect(["calm", "warm"]).toContain(result)
  })

  it("friday preset biases toward warm", () => {
    const result = detectEmotion("No problem at all.", { tonePreset: "friday" })
    expect(["warm", "calm"]).toContain(result)
  })
})

describe("emotionToVoiceParams", () => {
  it("returns correct voice and speed for calm", () => {
    const p = emotionToVoiceParams("calm")
    expect(p.voice).toBe("af_heart")
    expect(p.speed).toBeGreaterThan(0.8)
    expect(p.speed).toBeLessThan(1.1)
    expect(p.emotion).toBe("calm")
  })

  it("returns faster speed for urgent", () => {
    const calm = emotionToVoiceParams("calm")
    const urgent = emotionToVoiceParams("urgent")
    expect(urgent.speed).toBeGreaterThan(calm.speed)
  })

  it("returns slower speed for concerned vs calm", () => {
    const calm = emotionToVoiceParams("calm")
    const concerned = emotionToVoiceParams("concerned")
    expect(concerned.speed).toBeLessThan(calm.speed)
  })

  it("respects overrideVoice param", () => {
    const p = emotionToVoiceParams("excited", "bm_george")
    expect(p.voice).toBe("bm_george")
    expect(p.emotion).toBe("excited")
  })

  it("returns mobile-safe preset when isMobile=true", () => {
    const desktop = emotionToVoiceParams("urgent")
    const mobile = emotionToVoiceParams("urgent", undefined, true)
    // Mobile uses af_heart or bf_emma, not am_michael
    expect(["af_heart", "bf_emma"]).toContain(mobile.voice)
    // Mobile speed variance is tighter
    expect(Math.abs(mobile.speed - 1.0)).toBeLessThan(Math.abs(desktop.speed - 1.0) + 0.05)
  })

  it("all emotions produce valid params", () => {
    const emotions = ["calm", "warm", "urgent", "concerned", "excited", "apologetic", "formal", "playful"] as const
    for (const emotion of emotions) {
      const p = emotionToVoiceParams(emotion)
      expect(p.voice).toBeTruthy()
      expect(p.speed).toBeGreaterThan(0)
      expect(p.emotion).toBe(emotion)
    }
  })
})

describe("getVoiceParamsForText — convenience wrapper", () => {
  it("combines detection and param lookup in one call", () => {
    const p = getVoiceParamsForText("CRITICAL EMERGENCY right now immediately!")
    expect(p.emotion).toBe("urgent")
    expect(p.speed).toBeGreaterThan(1.0)
  })

  it("isMobile flag flows through to emotionToVoiceParams", () => {
    const mobile = getVoiceParamsForText("Of course!", { isMobile: true, tonePreset: "friday" })
    expect(["af_heart", "bf_emma"]).toContain(mobile.voice)
  })

  it("overrideVoice pins the voice regardless of emotion", () => {
    const p = getVoiceParamsForText("I apologize deeply.", undefined, "bm_lewis")
    expect(p.voice).toBe("bm_lewis")
  })
})
