/**
 * @file go-emotions-map.ts
 * @description Maps GoEmotions 27-label taxonomy to the 7 Ekman basic emotions.
 *
 * PAPER BASIS:
 *   Demszky et al. (2020). GoEmotions: A Dataset of Fine-Grained Emotions.
 *   https://arxiv.org/abs/2005.00547 — 27 emotion labels from Reddit data.
 *
 * MAPPING STRATEGY:
 *   Each of the 27 GoEmotions labels is assigned to the closest Ekman label.
 *   When multiple GoEmotions labels activate simultaneously, their weights
 *   are summed under the corresponding Ekman bucket.
 */

import type { EmotionLabel } from "./emotion-schema.js"

/**
 * Lookup table: GoEmotions label → Ekman 7-label.
 */
export const GO_EMOTIONS_MAP: Record<string, EmotionLabel> = {
  admiration: "joy",
  amusement: "joy",
  approval: "joy",
  caring: "joy",
  desire: "joy",
  excitement: "joy",
  gratitude: "joy",
  joy: "joy",
  love: "joy",
  optimism: "joy",
  pride: "joy",
  relief: "joy",

  sadness: "sadness",
  grief: "sadness",
  disappointment: "sadness",
  remorse: "sadness",

  anger: "anger",
  annoyance: "anger",
  disapproval: "anger",

  fear: "fear",
  nervousness: "fear",

  surprise: "surprise",
  realization: "surprise",
  curiosity: "surprise",
  confusion: "surprise",

  disgust: "disgust",
  embarrassment: "disgust",

  neutral: "neutral",
}
