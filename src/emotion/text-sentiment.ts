/**
 * @file text-sentiment.ts
 * @description Analyzes user text to produce an EmotionScore via LLM fast-path.
 *
 * ARCHITECTURE:
 *   Uses the 'fast' LLM task type to infer emotion from text.
 *   Returns an EmotionScore (7-label floats 0–1).
 *   Raw results are NOT persisted — caller must pass to mood-tracker.
 *
 *   Privacy guarantee: emotion scores never leave the in-process pipeline.
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import { dominantEmotion, neutralScore } from "./emotion-schema.js"
import type { EmotionScore } from "./emotion-schema.js"

const log = createLogger("emotion.text-sentiment")

const SYSTEM_PROMPT = `You are an emotion classifier. Given a text message, output ONLY a JSON object with these 7 float keys (0.0–1.0 each, summing to approximately 1.0): joy, sadness, anger, fear, surprise, disgust, neutral. No other text.`

/**
 * Analyzes a single text message for emotional content.
 */
export class TextSentimentAnalyzer {
  /**
   * Classifies the emotional content of `text`.
   * Returns a neutral score on any parse/LLM failure.
   *
   * @param text - The user message to analyze
   * @returns EmotionScore with 7 float values
   */
  async analyze(text: string): Promise<EmotionScore> {
    if (!text.trim()) return neutralScore()

    try {
      const raw = await orchestrator.generate("fast", {
        systemPrompt: SYSTEM_PROMPT,
        prompt: text.slice(0, 1000), // cap input length
      })

      const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0]
      if (!jsonStr) return neutralScore()

      const parsed = JSON.parse(jsonStr) as Partial<EmotionScore>
      const score = sanitizeScore(parsed)
      log.debug("text emotion analyzed", { dominant: dominantEmotion(score) })
      return score
    } catch (err) {
      log.warn("text sentiment analysis failed", { err })
      return neutralScore()
    }
  }
}

/** Clamps all values to [0, 1] and fills missing keys with 0. */
function sanitizeScore(raw: Partial<EmotionScore>): EmotionScore {
  const keys: (keyof EmotionScore)[] = [
    "joy",
    "sadness",
    "anger",
    "fear",
    "surprise",
    "disgust",
    "neutral",
  ]
  const score: EmotionScore = neutralScore()
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === "number" && isFinite(v)) {
      score[k] = Math.max(0, Math.min(1, v))
    }
  }
  return score
}

export const textSentimentAnalyzer = new TextSentimentAnalyzer()
