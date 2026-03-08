/**
 * @file emotion-schema.ts
 * @description Type definitions for Phase 21 Emotional Intelligence system.
 *
 * ARCHITECTURE:
 *   Shared interfaces used by text-sentiment.ts, voice-emotion.ts,
 *   mood-tracker.ts, style-modifier.ts, and wellness-detector.ts.
 *
 * PAPER BASIS:
 *   - Ekman, P. (1992). An argument for basic emotions. Cognition & Emotion.
 *   - Demszky et al. (2020). GoEmotions: A dataset of fine-grained emotions. ACL.
 */

/** The 7 Ekman basic emotion labels. */
export type EmotionLabel =
  | "joy"
  | "sadness"
  | "anger"
  | "fear"
  | "surprise"
  | "disgust"
  | "neutral"

/**
 * Per-turn emotion scores. All values are 0–1 floats.
 * Raw scores must NOT be persisted to disk.
 */
export interface EmotionScore {
  joy: number
  sadness: number
  anger: number
  fear: number
  surprise: number
  disgust: number
  neutral: number
}

/** A single sample in the emotion sliding window. */
export interface EmotionSample {
  score: EmotionScore
  dominant: EmotionLabel
  source: "text" | "voice"
  timestamp: Date
}

/**
 * Aggregated mood profile derived from the sliding window.
 * This IS safe to persist (aggregates only, no raw scores).
 */
export interface MoodProfile {
  dominant: EmotionLabel
  averageScore: EmotionScore
  sampleCount: number
  windowStart: Date
  updatedAt: Date
}

/**
 * Style modifier injected into the system prompt.
 * Never modifies user messages — only EDITH's response style.
 */
export interface StyleModifier {
  /** e.g. "warm and reassuring" | "brief and focused" */
  tone: string
  /** 0-1: 0 = very brief, 1 = verbose */
  brevity: number
  /** 0-1: 0 = serious, 1 = playful */
  humor: number
  /** 0-1: 0 = casual, 1 = formal */
  formality: number
  /** 0-1: 0 = neutral, 1 = highly empathetic */
  empathy: number
}

/** Alert generated when distress/burnout patterns are detected. */
export interface WellnessAlert {
  type: "stress" | "burnout" | "negative_spiral"
  userId: string
  detectedAt: Date
  /** System-prompt-safe suggestion for EDITH to surface gently. */
  suggestion: string
}

/** Returns the default neutral emotion score. */
export function neutralScore(): EmotionScore {
  return { joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0, neutral: 1 }
}

/** Returns the dominant label from a score. */
export function dominantEmotion(score: EmotionScore): EmotionLabel {
  return (Object.entries(score) as [EmotionLabel, number][]).reduce((a, b) =>
    b[1] > a[1] ? b : a
  )[0]
}
