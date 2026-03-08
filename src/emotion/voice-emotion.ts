/**
 * @file voice-emotion.ts
 * @description Extracts emotion cues from audio features for voice pipeline.
 *
 * ARCHITECTURE:
 *   Consumes audio metadata produced by VoiceBridge (pitch, energy, pace).
 *   Uses a rule-based heuristic to produce an EmotionScore without
 *   requiring an additional ML model call.
 *
 *   For production-grade models: Emotion2Vec / Whisper-AT integration
 *   can be added as a Python sidecar call here.
 */

import { createLogger } from "../logger.js"
import { neutralScore } from "./emotion-schema.js"
import type { EmotionScore } from "./emotion-schema.js"

const log = createLogger("emotion.voice-emotion")

/** Normalized audio feature vector from the STT pipeline. */
export interface AudioFeatures {
  /** Average pitch in Hz (human speech: 85–255 Hz). */
  pitchHz?: number
  /** Speech energy / volume (0–1 normalized). */
  energy?: number
  /** Words per minute. */
  pace?: number
  /** Detected voice tremor (0–1). */
  tremor?: number
}

/**
 * Infers emotion from audio features using rule-based heuristics.
 *
 * PAPER BASIS:
 *   Emotion2Vec: Ma et al. (2023) — arXiv:2312.15185
 *   Used as design reference for feature→emotion mapping.
 */
export class VoiceEmotionAnalyzer {
  /**
   * Maps audio features to an EmotionScore.
   * Returns neutral score when features are insufficient.
   *
   * @param features - Extracted audio features from STT output
   * @returns EmotionScore with 7 float values
   */
  analyze(features: AudioFeatures): EmotionScore {
    const score = neutralScore()

    const { pitchHz = 160, energy = 0.5, pace = 140, tremor = 0 } = features

    // High pitch + high energy + fast pace → joy/excitement
    if (pitchHz > 200 && energy > 0.7 && pace > 180) {
      score.joy = 0.6
      score.neutral = 0.2
      score.surprise = 0.2
      return score
    }

    // Low pitch + low energy + slow pace → sadness
    if (pitchHz < 120 && energy < 0.3 && pace < 100) {
      score.sadness = 0.6
      score.neutral = 0.3
      score.fear = 0.1
      return score
    }

    // High energy + fast pace + normal/high pitch → anger
    if (energy > 0.8 && pace > 200) {
      score.anger = 0.6
      score.neutral = 0.2
      score.disgust = 0.2
      return score
    }

    // High tremor + medium pitch → fear/anxiety
    if (tremor > 0.5) {
      score.fear = 0.5
      score.neutral = 0.3
      score.sadness = 0.2
      return score
    }

    log.debug("voice emotion: insufficient signal, returning neutral")
    return score
  }
}

export const voiceEmotionAnalyzer = new VoiceEmotionAnalyzer()
