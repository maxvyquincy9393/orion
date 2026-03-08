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
   * Estimate implicit reward from user follow-up quality.
   * Mirrors the heuristic in MemRLUpdater.estimateRewardFromContext().
   */
  private estimateImplicitReward(userReply: string, previousResponseLength: number): number {
    const trimmed = userReply.trim()
    if (trimmed.length < 5) {
      return 0.2 // Very short / no reply = disengagement
    }

    if (/\b(thanks|thank you|helpful|great|perfect|terima kasih|makasih|mantap|bagus)\b/i.test(trimmed)) {
      return 0.9 // Explicit positive
    }

    if (/\b(wrong|incorrect|that's not|bukan itu|salah|not what i asked)\b/i.test(trimmed)) {
      return 0.1 // Explicit negative
    }

    if (trimmed.includes("?")) {
      return 0.7 // Follow-up question = engaged
    }

    if (trimmed.length > 80) {
      return 0.75 // Detailed follow-up = engaged
    }

    if (previousResponseLength > 1000 && trimmed.length < 20) {
      return 0.35 // Long response, short reply = possibly too long
    }

    return 0.5
  }
}

/** Singleton export. */
export const feedbackStore = new FeedbackStore()
