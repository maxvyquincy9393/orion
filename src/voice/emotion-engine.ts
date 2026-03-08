/**
 * @file emotion-engine.ts
 * @description Lightweight emotion detector for voice synthesis — maps EDITH's
 * outgoing text to an emotional tone, then translates that to Kokoro.js voice
 * parameters (voice model, speed, energy).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by VoiceBridge.speakWithEmotion() before every Kokoro.js synthesis
 *   - Runs entirely offline with no model download — pure lexicon + heuristics
 *   - Mobile-safe: O(n) in text length, zero allocations beyond the result object
 *   - PersonalityEngine tone preset biases the baseline (jarvis → formal, friday → warm)
 *
 * DESIGN PRINCIPLES:
 *   - Rule-based lexicon beats a neural classifier for latency on mobile hardware
 *   - Scores are additive and normalised so long texts don't over-score
 *   - Default emotion is 'calm' — EDITH should always sound composed unless
 *     there is a clear signal to modulate
 *
 * PAPER BASIS:
 *   - "Affective Computing" (Picard 1997) — dimensional emotion model
 *   - arXiv:2306.10799 (Emotion-aware TTS survey) — lexicon + prosody mapping
 */

import { createLogger } from "../logger.js"

const log = createLogger("voice.emotion-engine")

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

/** Discrete emotion tag used to select a Kokoro voice+speed preset. */
export type EmotionTag =
  | "calm"
  | "warm"
  | "urgent"
  | "concerned"
  | "excited"
  | "apologetic"
  | "formal"
  | "playful"

/** Optional context hints that bias emotion detection. */
export interface EmotionContext {
  /** Tone preset from PersonalityEngine (biases baseline). */
  tonePreset?: "jarvis" | "friday" | "cortana" | "hal" | "custom"
  /** Hour of day (0–23) — late night softens, morning energises. */
  hourOfDay?: number
  /** True when the response is a direct answer to a question. */
  isAnswer?: boolean
  /** Conversation urgency level (0 = none, 1 = low, 2 = high). */
  urgency?: 0 | 1 | 2
  /** True when running on mobile — use lightweight voice preset. */
  isMobile?: boolean
}

/** Kokoro.js synthesis parameters derived from detected emotion. */
export interface EmotionVoiceParams {
  /** Kokoro voice ID.  Full list: af_heart, af_bella, af_sarah, af_sky,
   *  am_adam, am_michael, bf_emma, bf_isabella, bm_george, bm_lewis */
  voice: string
  /** Speech rate — 1.0 is natural, 0.85 is slower/heavier, 1.15 is brisk. */
  speed: number
  /** Human-readable label for logging / debug. */
  emotion: EmotionTag
}

// ─────────────────────────────────────────────────────────────
//  Voice presets per emotion
// ─────────────────────────────────────────────────────────────

/**
 * Kokoro voice + speed pairing per emotion tag.
 * Voices chosen for character fit:
 *   af_heart  — composed, clear (EDITH default)
 *   af_bella  — warm, friendly
 *   af_sarah  — soft, gentle (apologetic)
 *   af_sky    — bright, energetic (excited/playful)
 *   am_adam   — measured, grave (concerned)
 *   am_michael — firm, direct (urgent)
 *   bm_george — authoritative (formal)
 *   bf_emma   — light, natural (warm fallback on mobile)
 */
const EMOTION_VOICE_MAP: Record<EmotionTag, { voice: string; speed: number }> = {
  calm:       { voice: "af_heart",   speed: 0.93 },
  warm:       { voice: "af_bella",   speed: 1.00 },
  urgent:     { voice: "am_michael", speed: 1.12 },
  concerned:  { voice: "am_adam",    speed: 0.88 },
  excited:    { voice: "af_sky",     speed: 1.15 },
  apologetic: { voice: "af_sarah",   speed: 0.90 },
  formal:     { voice: "bm_george",  speed: 0.95 },
  playful:    { voice: "af_sky",     speed: 1.08 },
}

/**
 * Mobile-safe voice presets — fewer distinct voices, consistent gender,
 * speeds tighter to 1.0 to reduce artefacts on low-bitrate playback.
 */
const EMOTION_VOICE_MAP_MOBILE: Record<EmotionTag, { voice: string; speed: number }> = {
  calm:       { voice: "af_heart", speed: 0.95 },
  warm:       { voice: "bf_emma",  speed: 1.00 },
  urgent:     { voice: "af_heart", speed: 1.08 },
  concerned:  { voice: "af_heart", speed: 0.92 },
  excited:    { voice: "bf_emma",  speed: 1.10 },
  apologetic: { voice: "af_heart", speed: 0.92 },
  formal:     { voice: "af_heart", speed: 0.95 },
  playful:    { voice: "bf_emma",  speed: 1.06 },
}

// ─────────────────────────────────────────────────────────────
//  Keyword lexicons  (lower-case, word-boundary matched)
// ─────────────────────────────────────────────────────────────

/** Each entry maps an emotion to a list of trigger words/phrases. */
const LEXICON: Record<EmotionTag, string[]> = {
  urgent: [
    "immediately", "right now", "asap", "critical", "emergency", "urgent",
    "danger", "warning", "alert", "hurry", "quickly", "time-sensitive",
    "segera", "darurat", "kritis", "bahaya", "cepat", "peringatan",
  ],
  concerned: [
    "unfortunately", "sorry to say", "i'm worried", "be careful", "watch out",
    "problematic", "issue", "failed", "error", "unable", "cannot", "won't work",
    "sayangnya", "maaf", "khawatir", "gagal", "masalah", "tidak bisa",
  ],
  apologetic: [
    "i apologise", "i apologize", "i'm sorry", "forgive me", "my mistake",
    "my fault", "i was wrong", "i messed up", "pardon me",
    "maafkan", "minta maaf", "mohon maaf", "kesalahanku", "maaf ya",
  ],
  excited: [
    "great news", "fantastic", "amazing", "incredible", "wonderful", "awesome",
    "excellent", "brilliant", "we did it", "success", "achieved", "accomplished",
    "luar biasa", "keren", "mantap", "berhasil", "sukses", "hebat",
  ],
  warm: [
    "of course", "happy to help", "glad to", "absolutely", "sure thing",
    "here for you", "take care", "you got it", "no problem", "welcome",
    "tentu", "dengan senang", "siap", "sama-sama", "senang membantu",
  ],
  playful: [
    "haha", "fun", "joke", "kidding", "just kidding", "lol", "hmm",
    "interesting", "curious", "bet you", "guess what", "fun fact",
    "hehe", "lucu", "asik", "seru", "coba tebak",
  ],
  formal: [
    "pursuant to", "in accordance", "as per", "hereby", "whereas", "notwithstanding",
    "furthermore", "therefore", "accordingly", "regarding", "pertaining to",
    "berdasarkan", "sesuai dengan", "menurut", "oleh karena itu",
  ],
  calm: [
    // Calm is the default — words here *reinforce* calm, not trigger it
    "understood", "noted", "i see", "certainly", "of course", "let me",
    "here is", "here are", "the answer is", "to summarize",
    "baik", "oke", "mengerti", "berikut", "jawabannya",
  ],
}

// ─────────────────────────────────────────────────────────────
//  Structural feature extractors
// ─────────────────────────────────────────────────────────────

/** Count how many times `pattern` appears in `text`. */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

/**
 * Score structural signals in the text.
 * Returns a partial score map — keys not present default to 0.
 */
function structuralScores(text: string): Partial<Record<EmotionTag, number>> {
  const scores: Partial<Record<EmotionTag, number>> = {}

  // Multiple exclamation marks → excitement
  const exclamations = count(text, /!{2,}/g)
  if (exclamations > 0) scores.excited = (scores.excited ?? 0) + exclamations * 0.4

  // CAPS LOCK words (≥3 chars) → urgency
  const capsWords = count(text, /\b[A-Z]{3,}\b/g)
  if (capsWords > 0) scores.urgent = (scores.urgent ?? 0) + capsWords * 0.3

  // Ellipsis "..." → concerned/uncertain
  const ellipsis = count(text, /\.{3,}/g)
  if (ellipsis > 0) scores.concerned = (scores.concerned ?? 0) + ellipsis * 0.2

  // Very short text (<= 8 words) → calm direct answer
  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount <= 8) scores.calm = (scores.calm ?? 0) + 0.3

  // Very long text (>= 80 words) → formal
  if (wordCount >= 80) scores.formal = (scores.formal ?? 0) + 0.3

  return scores
}

// ─────────────────────────────────────────────────────────────
//  Tone preset baseline bias
// ─────────────────────────────────────────────────────────────

/**
 * Per-preset bias added to scores before max selection.
 * Keeps personality consistent across all emotion evaluations.
 */
const PRESET_BIAS: Record<string, Partial<Record<EmotionTag, number>>> = {
  jarvis:  { calm: 0.25, formal: 0.15 },
  friday:  { warm: 0.25, playful: 0.10 },
  cortana: { formal: 0.20, calm: 0.10 },
  hal:     { calm: 0.30, concerned: 0.10 },
  custom:  {},
}

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

/**
 * Detect the dominant emotion in `text` using a fast lexicon + heuristics pass.
 *
 * @param text    - The text EDITH is about to speak
 * @param context - Optional context hints (tone preset, hour, urgency, mobile)
 * @returns Dominant EmotionTag — defaults to 'calm' when signal is weak
 */
export function detectEmotion(text: string, context?: EmotionContext): EmotionTag {
  const lower = text.toLowerCase()
  const words = lower.split(/\W+/).filter(Boolean)
  const wordSet = new Set(words)
  const norm = Math.max(words.length, 1)

  // Accumulate lexicon scores
  const scores: Record<EmotionTag, number> = {
    calm: 0, warm: 0, urgent: 0, concerned: 0,
    excited: 0, apologetic: 0, formal: 0, playful: 0,
  }

  for (const [emotion, triggers] of Object.entries(LEXICON) as [EmotionTag, string[]][]) {
    for (const trigger of triggers) {
      if (trigger.includes(" ")) {
        // Phrase match
        if (lower.includes(trigger)) {
          scores[emotion] += 0.5
        }
      } else {
        // Word match
        if (wordSet.has(trigger)) {
          scores[emotion] += 0.4
        }
      }
    }
    // Normalise by text length so long texts don't always over-score
    scores[emotion] = scores[emotion] / Math.log2(norm + 2)
  }

  // Add structural scores
  const structural = structuralScores(text)
  for (const [emotion, score] of Object.entries(structural) as [EmotionTag, number][]) {
    scores[emotion] += score
  }

  // Apply urgency context override
  if (context?.urgency === 2) {
    scores.urgent += 0.6
  } else if (context?.urgency === 1) {
    scores.concerned += 0.2
  }

  // Hour-of-day softener: midnight → softer, morning → warmer
  if (context?.hourOfDay !== undefined) {
    const h = context.hourOfDay
    if (h >= 23 || h < 6) {
      scores.calm += 0.3
      scores.excited = Math.max(0, scores.excited - 0.2)
    } else if (h >= 7 && h < 10) {
      scores.warm += 0.15
    }
  }

  // Tone preset bias
  const preset = context?.tonePreset ?? "jarvis"
  const bias = PRESET_BIAS[preset] ?? {}
  for (const [emotion, b] of Object.entries(bias) as [EmotionTag, number][]) {
    scores[emotion] += b
  }

  // Pick winner — must beat calm baseline to override default
  let winner: EmotionTag = "calm"
  let maxScore = scores.calm

  for (const [emotion, score] of Object.entries(scores) as [EmotionTag, number][]) {
    if (score > maxScore) {
      maxScore = score
      winner = emotion
    }
  }

  log.debug("emotion detected", { emotion: winner, score: maxScore.toFixed(2) })
  return winner
}

/**
 * Translate an EmotionTag into Kokoro.js synthesis parameters.
 *
 * @param emotion      - Tag from detectEmotion()
 * @param overrideVoice - If provided, always use this voice (user preference)
 * @param isMobile     - Use mobile-safe presets (fewer voices, less speed variance)
 * @returns EmotionVoiceParams ready for KokoroTTS.generate()
 */
export function emotionToVoiceParams(
  emotion: EmotionTag,
  overrideVoice?: string,
  isMobile = false,
): EmotionVoiceParams {
  const map = isMobile ? EMOTION_VOICE_MAP_MOBILE : EMOTION_VOICE_MAP
  const preset = map[emotion]
  return {
    voice: overrideVoice ?? preset.voice,
    speed: preset.speed,
    emotion,
  }
}

/**
 * Convenience: detect emotion and return voice params in one call.
 *
 * @param text          - Text to analyse
 * @param context       - Optional context hints
 * @param overrideVoice - Pin to this voice if set (ignores emotion voice)
 * @returns EmotionVoiceParams
 */
export function getVoiceParamsForText(
  text: string,
  context?: EmotionContext,
  overrideVoice?: string,
): EmotionVoiceParams {
  const emotion = detectEmotion(text, context)
  return emotionToVoiceParams(emotion, overrideVoice, context?.isMobile)
}
