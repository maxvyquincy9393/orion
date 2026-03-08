/**
 * @file suggestion-engine.ts
 * @description Proactive suggestions based on time, context, and habits.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Generates proactive suggestions via LLM given current context.
 *   Combines habit-model + intent predictor signals to surface relevant suggestions.
 *   Suggestions with confidence < 0.7 are filtered out.
 */
import { createLogger } from '../logger.js'
import { orchestrator } from '../engines/orchestrator.js'

const log = createLogger('predictive.suggestions')

/** A proactive suggestion generated for the user. */
export interface Suggestion {
  text: string
  confidence: number
  type: 'reminder' | 'action' | 'information' | 'question'
  triggerReason: string
}

/** Minimum confidence for a suggestion to be surfaced. */
const MIN_CONFIDENCE = 0.7

class SuggestionEngine {
  /**
   * Generate proactive suggestions based on current context.
   * @param userId - User to generate suggestions for
   * @param currentContext - Current conversation or situational context
   * @returns Array of high-confidence suggestions
   */
  async generate(userId: string, currentContext: string): Promise<Suggestion[]> {
    log.debug('generating suggestions', { userId })

    try {
      const prompt = `Based on this context, suggest 2-3 proactive actions or reminders the AI assistant should offer.
Context: ${currentContext.slice(0, 300)}

Reply with JSON array:
[{"text": "suggestion text", "confidence": 0.0-1.0, "type": "reminder|action|information|question", "triggerReason": "why"}]`

      const response = await orchestrator.generate('fast', { prompt })
      const suggestions = JSON.parse(response) as Suggestion[]
      return suggestions.filter(s => s.confidence >= MIN_CONFIDENCE)
    } catch (err) {
      log.warn('suggestion generation failed', { userId, err })
      return []
    }
  }
}

/** Singleton suggestion engine. */
export const suggestionEngine = new SuggestionEngine()
