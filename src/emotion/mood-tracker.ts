/**
 * @file mood-tracker.ts
 * @description Sliding-window mood aggregator and session-level mood persistence.
 *
 * ARCHITECTURE:
 *   Keeps a rolling window of the last EMOTION_WINDOW_SIZE EmotionSamples
 *   per user in memory. Computes an aggregate MoodProfile from the window.
 *
 *   PRIVACY RULE: Raw per-turn EmotionScore values are NEVER persisted.
 *   Only the aggregated EmotionSession row (average floats + dominant label)
 *   is written to the database.
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import config from "../config.js"
import { dominantEmotion, neutralScore } from "./emotion-schema.js"
import type { EmotionScore, EmotionSample, MoodProfile, EmotionLabel } from "./emotion-schema.js"

const log = createLogger("emotion.mood-tracker")

/**
 * Per-user sliding window of recent emotion samples.
 * Computes aggregate MoodProfile and persists session summaries.
 */
export class MoodTracker {
  /** In-memory sliding windows keyed by userId. */
  private readonly windows = new Map<string, EmotionSample[]>()

  /**
   * Records a new EmotionSample and updates the sliding window.
   * Asynchronously persists the updated aggregate to the DB.
   *
   * @param userId - User identifier
   * @param score - The raw emotion score (NOT stored raw)
   * @param source - Whether this came from text or voice analysis
   */
  record(userId: string, score: EmotionScore, source: "text" | "voice"): void {
    const sample: EmotionSample = {
      score,
      dominant: dominantEmotion(score),
      source,
      timestamp: new Date(),
    }

    const window = this.windows.get(userId) ?? []
    window.push(sample)
    if (window.length > config.EMOTION_WINDOW_SIZE) window.shift()
    this.windows.set(userId, window)

    void this.persistSession(userId, window).catch(err =>
      log.warn("session persist failed", { userId, err }),
    )
  }

  /**
   * Returns the current MoodProfile for a user.
   * Returns a neutral profile when no samples exist.
   */
  getProfile(userId: string): MoodProfile {
    const window = this.windows.get(userId)
    if (!window?.length) {
      return {
        dominant: "neutral",
        averageScore: neutralScore(),
        sampleCount: 0,
        windowStart: new Date(),
        updatedAt: new Date(),
      }
    }
    return this.computeProfile(userId, window)
  }

  /** Builds a MoodProfile from the current window. */
  private computeProfile(userId: string, window: EmotionSample[]): MoodProfile {
    const keys: (keyof EmotionScore)[] = [
      "joy", "sadness", "anger", "fear", "surprise", "disgust", "neutral",
    ]
    const avg = neutralScore()
    for (const s of window) {
      for (const k of keys) avg[k] += s.score[k]
    }
    for (const k of keys) avg[k] = avg[k] / window.length

    return {
      dominant: dominantEmotion(avg),
      averageScore: avg,
      sampleCount: window.length,
      windowStart: window[0]!.timestamp,
      updatedAt: new Date(),
    }
  }

  /** Upserts the EmotionSession row (aggregated averages only). */
  private async persistSession(userId: string, window: EmotionSample[]): Promise<void> {
    const profile = this.computeProfile(userId, window)
    const avg = profile.averageScore

    await prisma.emotionSession.upsert({
      where: { id: userId }, // one row per user session
      create: {
        id: userId,
        userId,
        ...avg,
        dominant: profile.dominant,
        sampleCount: profile.sampleCount,
      },
      update: {
        ...avg,
        dominant: profile.dominant,
        sampleCount: profile.sampleCount,
      },
    })
  }
}

export const moodTracker = new MoodTracker()
