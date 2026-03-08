/**
 * @file feedback-store.ts
 * @description FeedbackStore — collects explicit, barge-in, and edit preference signals
 *              and routes them to both MemRL (memory quality) and UserPreferenceEngine
 *              (preference sliders).
 *
 * ARCHITECTURE:
 *   Signal types captured:
 *     explicit  — user says "too long", "speak Indonesian", etc.
 *     barge-in  — user interrupts TTS mid-response (implies too verbose)
 *     edit      — user corrects EDITH's text (CIPHER pattern)
 *     implicit  — inferred from message length, follow-up patterns
 *
 *   Dual routing:
 *     → MemRL (memrl.ts): updateFromFeedback() — improves memory retrieval quality
 *     → UserPreferenceEngine: applySignal() — updates preference sliders
 *
 *   FeedbackStore does NOT block the response path. All processing is async.
 *
 * PAPER BASIS:
 *   - CIPHER / PRELUDE (arXiv:2404.15269): edit-signal preference inference
 *   - PPP (arXiv:2511.02208): explicit preference compliance signals
 *   - MemRL (arXiv:2601.03192): reward signal for memory Q-value updates
 *
 * @module memory/feedback-store
 */

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import { userPreferenceEngine, type PreferenceDimension } from "./user-preference.js"
import type { TaskFeedback } from "./memrl.js"
import { memory } from "./store.js"

const log = createLogger("memory.feedback-store")

/** Signal types that FeedbackStore can capture. */
export type SignalType = "explicit" | "barge-in" | "edit" | "implicit"

/**
 * An explicit signal from the user stating a preference directly.
 * e.g. "be more brief" / "speak in English" / "stop being so formal"
 */
export interface ExplicitSignalEvent {
  userId: string
  /** The user's raw message that contains the preference directive. */
  message: string
  /** Turn context for CIPHER-style inference. */
  context?: string
}

/**
 * A barge-in signal: user interrupted EDITH mid-response.
 */
export interface BargeInEvent {
  userId: string
  /** Length of EDITH's response in characters. */
  responseLengthChars: number
  /** How many characters of the response had been delivered when interrupted. */
  deliveredChars: number
  /** Memory IDs involved in the response (for MemRL feedback). */
  memoryIds?: string[]
}

/**
 * An edit signal: user corrects or rewrites EDITH's output (CIPHER pattern).
 */
export interface EditSignalEvent {
  userId: string
  /** EDITH's original text. */
  original: string
  /** User's edited version. */
  edited: string
  /** Context of the task. */
  context?: string
  /** Memory IDs involved (for MemRL feedback). */
  memoryIds?: string[]
}

/**
 * An implicit signal inferred from conversation patterns.
 */
export interface ImplicitSignalEvent {
  userId: string
  /** User's follow-up reply (used for MemRL reward estimation). */
  userReply: string
  /** Length of EDITH's previous response. */
  previousResponseLengthChars: number
  /** Memory IDs from the previous turn. */
  memoryIds: string[]
}

/**
 * Keyword patterns that indicate explicit preference signals.
 */
const EXPLICIT_SIGNAL_PATTERNS: Array<{
  pattern: RegExp
  dimension: PreferenceDimension | "language" | "general"
  delta: number
  confidence: number
}> = [
  // Verbosity signals
  { pattern: /\b(too long|terlalu panjang|be (more )?brief|singkat|pendek)\b/i, dimension: "verbosity", delta: -1, confidence: 0.9 },
  { pattern: /\b(more detail|lebih detail|expand|lengkap|comprehensive)\b/i, dimension: "verbosity", delta: 1, confidence: 0.85 },
  // Formality signals
  { pattern: /\b(too formal|terlalu formal|be (more )?casual|santai|informal)\b/i, dimension: "formality", delta: -1, confidence: 0.9 },
  { pattern: /\b(more formal|lebih formal|professional|professional tone)\b/i, dimension: "formality", delta: 1, confidence: 0.85 },
  // Humor signals
  { pattern: /\b(be (more )?funny|humor|jokes?|lucu|lebih seru)\b/i, dimension: "humor", delta: 1, confidence: 0.8 },
  { pattern: /\b(no jokes?|serious|not funny|jangan becanda|serius)\b/i, dimension: "humor", delta: -1, confidence: 0.85 },
  // Proactivity signals
  { pattern: /\b(stop (bugging|bothering)|don't (remind|notify)|jangan ganggu)\b/i, dimension: "proactivity", delta: -1, confidence: 0.9 },
  { pattern: /\b(remind me|notify me|proactive|ingatkan|kasih tau)\b/i, dimension: "proactivity", delta: 1, confidence: 0.75 },
  // Language signals
  { pattern: /\b(speak (in )?english|pakai english|in english|bahasa inggris)\b/i, dimension: "language", delta: 0, confidence: 0.95 },
  { pattern: /\b(speak (in )?indonesian|pakai (bahasa )?indonesia|bahasa indonesia)\b/i, dimension: "language", delta: 0, confidence: 0.95 },
]

/**
 * FeedbackStore captures preference signals from user interactions and routes
 * them to UserPreferenceEngine (sliders) and MemRL (memory quality).
 *
 * All public methods are fire-and-forget safe (they log errors internally).
 */
export class FeedbackStore {
  /**
   * Capture an explicit preference signal from a user message.
   * Scans the message for known patterns and routes matching signals.
   *
   * @param event - The explicit signal event
   */
  async captureExplicit(event: ExplicitSignalEvent): Promise<void> {
    try {
      for (const rule of EXPLICIT_SIGNAL_PATTERNS) {
        if (!rule.pattern.test(event.message)) {
          continue
        }

        if (rule.dimension === "language") {
          const lang = this.detectLanguageFromPattern(event.message)
          if (lang) {
            await userPreferenceEngine.setLanguage(event.userId, lang)
          }
        } else if (this.isPreferenceDimension(rule.dimension)) {
          await userPreferenceEngine.applySignal(
            event.userId,
            rule.dimension,
            rule.delta,
            rule.confidence,
          )
        }

        await this.persistSignal({
          userId: event.userId,
          signalType: "explicit",
          dimension: rule.dimension,
          value: rule.delta,
          confidence: rule.confidence,
          context: event.context ? { text: event.context } : null,
        })

        log.debug("explicit signal captured", {
          userId: event.userId,
          dimension: rule.dimension,
          delta: rule.delta,
        })
      }
    } catch (err) {
      log.warn("captureExplicit failed", { userId: event.userId, err })
    }
  }

  /**
   * Capture a barge-in signal (user interrupted TTS mid-response).
   * Routes verbosity delta to UserPreferenceEngine and a negative reward to MemRL.
   */
  async captureBargeIn(event: BargeInEvent): Promise<void> {
    try {
      const completionRatio = event.deliveredChars / Math.max(1, event.responseLengthChars)
      const verbosityDelta = completionRatio < 0.4 ? -1 : -0.5
      const confidence = completionRatio < 0.25 ? 0.85 : 0.6

      await userPreferenceEngine.applySignal(event.userId, "verbosity", verbosityDelta, confidence)

      await this.persistSignal({
        userId: event.userId,
        signalType: "barge-in",
        dimension: "verbosity",
        value: verbosityDelta,
        confidence,
        context: { completionRatio, responseLengthChars: event.responseLengthChars },
      })

      // Also route negative reward to MemRL
      if (event.memoryIds && event.memoryIds.length > 0) {
        const feedback: TaskFeedback = {
          memoryIds: event.memoryIds,
          taskSuccess: false,
          reward: 0.2, // Low reward — response disrupted
        }
        void memory.provideFeedback(feedback)
          .catch((err) => log.warn("barge-in memrl feedback failed", { userId: event.userId, err }))
      }

      log.debug("barge-in signal captured", {
        userId: event.userId,
        completionRatio,
        verbosityDelta,
      })
    } catch (err) {
      log.warn("captureBargeIn failed", { userId: event.userId, err })
    }
  }

  /**
   * Capture an edit signal (CIPHER pattern).
   * When the user corrects EDITH's output, we infer the preference direction.
   */
  async captureEdit(event: EditSignalEvent): Promise<void> {
    try {
      // Basic edit signal analysis: length change
      const lengthDelta = event.edited.length - event.original.length
      const isShortened = lengthDelta < -50 // Significantly shortened
      const isLengthened = lengthDelta > 100 // Significantly lengthened

      if (isShortened) {
        await userPreferenceEngine.applySignal(event.userId, "verbosity", -0.5, 0.7)
      } else if (isLengthened) {
        await userPreferenceEngine.applySignal(event.userId, "verbosity", 0.5, 0.6)
      }

      await this.persistSignal({
        userId: event.userId,
        signalType: "edit",
        dimension: "verbosity",
        value: isShortened ? -0.5 : isLengthened ? 0.5 : 0,
        confidence: 0.65,
        context: {
          originalLength: event.original.length,
          editedLength: event.edited.length,
          lengthDelta,
        },
      })

      // Route low MemRL reward for the original response
      if (event.memoryIds && event.memoryIds.length > 0) {
        const feedback: TaskFeedback = {
          memoryIds: event.memoryIds,
          taskSuccess: false,
          reward: 0.3,
        }
        void memory.provideFeedback(feedback)
          .catch((err) => log.warn("edit memrl feedback failed", { userId: event.userId, err }))
      }

      log.debug("edit signal captured", { userId: event.userId, lengthDelta })
    } catch (err) {
      log.warn("captureEdit failed", { userId: event.userId, err })
    }
  }

  /**
   * Capture an implicit signal from conversation patterns.
   * Routes MemRL reward based on user follow-up quality.
   */
  async captureImplicit(event: ImplicitSignalEvent): Promise<void> {
    try {
      if (event.memoryIds.length === 0) {
        return
      }

      // Estimate reward from follow-up quality
      const reward = this.estimateImplicitReward(
        event.userReply,
        event.previousResponseLengthChars,
      )

      const feedback: TaskFeedback = {
        memoryIds: event.memoryIds,
        taskSuccess: reward > 0.5,
        reward,
        userReply: event.userReply,
      }

      await memory.provideFeedback(feedback)

      // Implicit verbosity signal from reply length relative to response length
      const replyToResponseRatio = event.userReply.length / Math.max(1, event.previousResponseLengthChars)
      if (replyToResponseRatio < 0.1 && event.previousResponseLengthChars > 500) {
        // Very short reply to a long response — possibly too verbose
        await userPreferenceEngine.applySignal(event.userId, "verbosity", -0.25, 0.3)
      }

      log.debug("implicit signal captured", {
        userId: event.userId,
        reward,
        replyLength: event.userReply.length,
      })
    } catch (err) {
      log.warn("captureImplicit failed", { userId: event.userId, err })
    }
  }

  // ============================================================
  //  Private helpers
  // ============================================================

  private async persistSignal(data: {
    userId: string
    signalType: string
    dimension: string
    value: number
    confidence: number
    context: unknown
  }): Promise<void> {
    try {
      await prisma.preferenceSignal.create({
        data: {
          userId: data.userId,
          signalType: data.signalType,
          dimension: data.dimension,
          value: data.value,
          confidence: data.confidence,
          context: data.context as object,
          processed: true, // Mark as processed since we route immediately
        },
      })
    } catch (err) {
      log.debug("signal persist failed (non-critical)", { err })
    }
  }

  private detectLanguageFromPattern(message: string): string | null {
    if (/\b(english|bahasa inggris)\b/i.test(message)) {
      return "en"
    }
    if (/\b(indonesian|bahasa indonesia|indo|id)\b/i.test(message)) {
      return "id"
    }
    return null
  }

  private isPreferenceDimension(dim: string): dim is PreferenceDimension {
    return ["formality", "verbosity", "humor", "proactivity"].includes(dim)
  }

  /**
   * Estimate implicit reward from user follow-up using multi-signal fusion.
   *
   * Signals (in priority order):
   *   1. Explicit correction → 0.05  (user said EDITH was wrong)
   *   2. Repeat question     → 0.15  (user re-asked the same thing)
   *   3. Clarification req   → 0.25  (user didn't understand)
   *   4. Explicit positive   → 0.90  (thanks / mantap / exactly)
   *   5. Short dismissal     → 0.35  (ok / oke — disengaged)
   *   6. Follow-up question  → 0.60  (conversation continues)
   *   7. Natural continuation→ 0.55–0.65
   *   8. Default             → 0.45
   *
   * NOTE: reply length is NOT used as a positive signal. A long reply can mean
   * confusion; a follow-up question can mean the response was incomplete.
   *
   * @param userReply - User's follow-up message
   * @param _previousResponseLength - Kept for API compatibility
   * @param previousQuery - Prior user query (enables repeat-question detection)
   */
  private estimateImplicitReward(
    userReply: string,
    _previousResponseLength: number,
    previousQuery?: string,
  ): number {
    const trimmed = userReply.trim()
    if (trimmed.length === 0) return 0.2

    const reply = trimmed.toLowerCase()

    // Signal 1: Explicit correction
    if (/\b(bukan itu|bukan maksudnya|bukan begitu|salah|keliru|tidak betul|tidak benar)\b|not what i (asked|meant|wanted)|that'?s? (wrong|incorrect|not right)|you'?re? wrong|wrong answer|bukan gitu/.test(reply)) {
      return 0.05
    }

    // Signal 2: Repeat question (Jaccard overlap with previous query)
    if (previousQuery && reply.includes("?")) {
      const stopWords = new Set(["yang", "apa", "gimana", "bagaimana", "kenapa", "mengapa", "the", "is", "are", "what", "how", "why", "when", "can", "do", "di", "ke", "dan", "atau"])
      const toWords = (s: string) => s.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w))
      const prevWords = new Set(toWords(previousQuery))
      const curWords = new Set(toWords(reply))
      if (prevWords.size > 0 && curWords.size > 0) {
        const intersection = [...prevWords].filter(w => curWords.has(w)).length
        const union = new Set([...prevWords, ...curWords]).size
        if (intersection / union > 0.55) return 0.15
      }
    }

    // Signal 3: Clarification request
    if (/\b(what do you mean|could you explain|don'?t understand|gak ngerti|ga ngerti|kurang jelas|explain more|be more specific|more detail|could you clarify|maksudnya apa|apa maksudnya|elaborate|i'?m? confused)\b/.test(reply)) {
      return 0.25
    }

    // Signal 4: Explicit positive
    if (/\b(thanks|thank you|thank u|thx|helpful|great|perfect|excellent|awesome|exactly|spot on|that'?s? (right|correct|it|perfect)|yes exactly|makasih|terima kasih|mantap|bagus|bener|tepat|pas banget|you'?re? right|that helps)\b/.test(reply)) {
      return 0.90
    }

    // Signal 5: Short dismissal
    const dismissals = new Set(["ok", "okay", "oke", "k", "fine", "sure", "alright", "noted", "ya", "yep", "yup", "hmm", "oh"])
    const tokens = reply.split(/\s+/)
    if (tokens.length <= 2 && tokens.every(w => dismissals.has(w.replace(/[.,!]$/, "")))) {
      return 0.35
    }

    // Signal 6: Follow-up question (conversation alive)
    if (reply.includes("?") && reply.length > 15) return 0.60

    // Signal 7: Natural continuation
    if (reply.length > 30) return 0.65
    if (reply.length > 10) return 0.55

    return 0.45
  }
}

/** Singleton export. */
export const feedbackStore = new FeedbackStore()
