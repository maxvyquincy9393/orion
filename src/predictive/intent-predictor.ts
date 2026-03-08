/**
 * @file intent-predictor.ts
 * @description Predicts user's next likely request based on conversation context and habits.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Combines memory context + recent conversation to predict next intent.
 *   Confidence threshold of 0.6 filters low-quality predictions.
 *   Predictions logged to PredictionCache Prisma model when available.
 */
import { createLogger } from '../logger.js'
import { orchestrator } from '../engines/orchestrator.js'
import { memory } from '../memory/store.js'

const log = createLogger('predictive.intent')

/** A predicted user intent. */
export interface PredictedIntent {
  intent: string
  confidence: number
  suggestedResponse?: string
  preloadHint?: string
}

/** Minimum confidence threshold for returning a prediction. */
const CONFIDENCE_THRESHOLD = 0.6

class IntentPredictor {
  /**
   * Predict likely next user intent based on recent context.
   * @param userId - User to predict for
   * @param lastMessage - Most recent message for context
   * @returns Predicted intent or null if confidence is too low
   */
  async predict(userId: string, lastMessage: string): Promise<PredictedIntent | null> {
    try {
      const context = await memory.buildContext(userId, lastMessage)
      const prompt = `Based on this conversation context, predict the user's most likely NEXT question or request.

Context: ${context.systemContext.slice(0, 500)}
Last message: ${lastMessage.slice(0, 200)}

Reply with JSON only: {"intent": "description", "confidence": 0.0-1.0, "preloadHint": "what data to prefetch"}`

      const response = await orchestrator.generate('fast', { prompt })
      const prediction = JSON.parse(response) as PredictedIntent
      if (prediction.confidence < CONFIDENCE_THRESHOLD) return null
      log.debug('intent predicted', {
        userId,
        intent: prediction.intent,
        confidence: prediction.confidence,
      })
      return prediction
    } catch (err) {
      log.warn('intent prediction failed', { userId, err })
      return null
    }
  }
}

/** Singleton intent predictor. */
export const intentPredictor = new IntentPredictor()
