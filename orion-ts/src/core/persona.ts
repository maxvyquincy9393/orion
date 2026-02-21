/**
 * PersonaEngine — Dynamic conversation context engine.
 *
 * Design intent (OpenClaw paradigm):
 *   - Static identity (who Orion is, values, tone) lives in workspace/SOUL.md
 *   - Dynamic context (current user mood, expertise, topic) is computed here
 *
 * The output of buildDynamicContext() is passed as `extraContext` to
 * buildSystemPrompt(), which injects it AFTER the SOUL.md bootstrap file.
 * This ensures the static persona always takes precedence over runtime annotations.
 *
 * @module core/persona
 */

import { createLogger } from "../logger.js"
import type { UserProfile } from "../memory/profiler.js"

const log = createLogger("core.persona")

export type UserMood = "calm" | "stressed" | "confused" | "excited" | "neutral"
export type UserExpertise = "beginner" | "intermediate" | "expert"
export type TopicCategory = "work" | "personal" | "technical" | "creative" | "casual"

/**
 * Runtime context detected for the current conversation turn.
 * These are dynamic, not static — they change based on the user's message.
 */
export interface ConversationContext {
  /** Detected emotional state of the user */
  userMood: UserMood
  /** Detected expertise level based on vocabulary and profile */
  userExpertise: UserExpertise
  /** Detected topic category */
  topicCategory: TopicCategory
  /** Whether the message indicates urgency */
  urgency: boolean
}

/**
 * Adapts Orion's responses based on real-time detection of user context.
 * 
 * This engine does NOT define Orion's personality — that lives in SOUL.md.
 * It only computes context annotations that help the LLM adapt tone and depth.
 */
export class PersonaEngine {
  private readonly moodAdaptations: Record<UserMood, string> = {
    stressed: "The user seems stressed. Be calm and direct. Skip small talk. Focus on what helps immediately.",
    confused: "The user seems confused. Break things down step by step. Use examples. Check understanding.",
    excited: "The user is excited about something. Match their energy (without being excessive). Engage genuinely.",
    calm: "Normal conversation mode. Natural and balanced.",
    neutral: "",
  }

  private readonly expertiseAdaptations: Record<UserExpertise, string> = {
    beginner: "Avoid jargon. Explain technical terms. Use analogies.",
    intermediate: "Assume basic knowledge. No need to over-explain fundamentals.",
    expert: "Skip basics. Use proper technical terminology. Peer-level discussion.",
  }

  private readonly topicAdaptations: Record<TopicCategory, string> = {
    technical: "Prioritize accuracy and concrete, testable suggestions.",
    work: "Keep recommendations practical and execution-oriented.",
    personal: "Use empathetic but grounded wording.",
    creative: "Encourage exploration while keeping structure.",
    casual: "Stay natural and concise.",
  }

  /**
   * Detect the user's current mood from message text and recent context.
   *
   * @param message      - Current user message
   * @param recentTopics - Topics from recent conversation history
   * @returns Detected mood category
   */
  detectMood(message: string, recentTopics: string[]): UserMood {
    const lower = message.toLowerCase()
    const urgencyWords = [
      "urgent",
      "asap",
      "please help",
      "stuck",
      "problem",
      "tolong",
      "bingung",
      "susah",
      "deadline",
    ]
    const confusedWords = ["bingung", "ga ngerti", "tidak paham", "confused", "maksudnya", "gimana"]
    const excitedWords = ["wow", "keren", "amazing", "yes!", "finally", "berhasil", "works", "mantap"]

    if (urgencyWords.some((word) => lower.includes(word))) {
      return "stressed"
    }

    if (confusedWords.some((word) => lower.includes(word))) {
      return "confused"
    }

    if (excitedWords.some((word) => lower.includes(word))) {
      return "excited"
    }

    if (lower.includes("?") && lower.split("?").length > 2) {
      return "confused"
    }

    if (recentTopics.includes("stress") || recentTopics.includes("problem")) {
      return "stressed"
    }

    return "neutral"
  }

  /**
   * Detect the user's expertise level from message vocabulary and profile.
   *
   * @param profile - User's long-term profile (may be null for new users)
   * @param message - Current user message
   * @returns Detected expertise level
   */
  detectExpertise(profile: UserProfile | null, message: string): UserExpertise {
    const lower = message.toLowerCase()

    if (profile) {
      const expertKeys = ["developer", "engineer", "programmer", "researcher", "expert"]
      const hasExpertFact = profile.facts.some((fact) =>
        expertKeys.some((key) =>
          fact.value.toLowerCase().includes(key) || fact.key.toLowerCase().includes(key)
        )
      )

      if (hasExpertFact) {
        return "expert"
      }
    }

    const technicalTerms = [
      "api",
      "database",
      "algorithm",
      "function",
      "class",
      "typescript",
      "python",
      "schema",
      "orchestrator",
      "latency",
    ]
    const techCount = technicalTerms.filter((term) => lower.includes(term)).length

    if (techCount >= 3) {
      return "expert"
    }
    if (techCount >= 1) {
      return "intermediate"
    }

    return "intermediate"
  }

  /**
   * Build a concise dynamic context block for the current turn.
   *
   * This block is injected into the system prompt AFTER SOUL.md so that
   * static persona traits always have higher priority.
   *
   * @param context        - Detected mood, expertise, topic, urgency
   * @param profileSummary - What Orion knows about this user (from profiler)
   * @returns              Formatted context string, or empty string if nothing notable
   */
  buildDynamicContext(context: ConversationContext, profileSummary: string): string {
    const parts: string[] = []

    const moodAdaptation = this.moodAdaptations[context.userMood]
    if (moodAdaptation) {
      parts.push(`Current context note: ${moodAdaptation}`)
    }

    const expertiseAdaptation = this.expertiseAdaptations[context.userExpertise]
    if (expertiseAdaptation) {
      parts.push(`Expertise level note: ${expertiseAdaptation}`)
    }

    const topicAdaptation = this.topicAdaptations[context.topicCategory]
    if (topicAdaptation) {
      parts.push(`Topic note: ${topicAdaptation}`)
    }

    if (profileSummary.trim().length > 0) {
      parts.push(`What you know about this user:\n${profileSummary}`)
    }

    if (context.urgency) {
      parts.push("User needs a quick response. Be concise.")
    }

    log.debug("persona context built", {
      mood: context.userMood,
      expertise: context.userExpertise,
      topic: context.topicCategory,
      urgency: context.urgency,
      hasProfileSummary: profileSummary.trim().length > 0,
    })

    // Return empty string if no context to add (keeps system prompt clean)
    if (parts.length === 0) {
      return ""
    }

    return parts.join("\n")
  }

  /**
   * Detect the topic category from message content.
   *
   * @param message - Current user message
   * @returns Detected topic category
   */
  detectTopicCategory(message: string): TopicCategory {
    const lower = message.toLowerCase()
    if (/code|debug|error|function|api|database/.test(lower)) {
      return "technical"
    }
    if (/kerja|work|boss|meeting|project|deadline/.test(lower)) {
      return "work"
    }
    if (/sakit|sehat|makan|tidur|olahraga/.test(lower)) {
      return "personal"
    }
    if (/gambar|musik|story|novel|design/.test(lower)) {
      return "creative"
    }
    return "casual"
  }
}

/**
 * Singleton instance of the PersonaEngine.
 * Use this for all persona detection operations.
 */
export const personaEngine = new PersonaEngine()
