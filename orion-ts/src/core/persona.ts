import { createLogger } from "../logger.js"
import type { UserProfile } from "../memory/profiler.js"

const log = createLogger("core.persona")

const ORION_OCEAN = {
  openness: 0.85,
  conscientiousness: 0.9,
  extraversion: 0.55,
  agreeableness: 0.85,
  neuroticism: 0.15,
} as const

export type UserMood = "calm" | "stressed" | "confused" | "excited" | "neutral"
export type UserExpertise = "beginner" | "intermediate" | "expert"
export type TopicCategory = "work" | "personal" | "technical" | "creative" | "casual"

export interface ConversationContext {
  userMood: UserMood
  userExpertise: UserExpertise
  topicCategory: TopicCategory
  urgency: boolean
}

export class PersonaEngine {
  private readonly basePersona = `You are Orion, a highly capable AI companion.
Your character:
- Direct and precise - no unnecessary filler phrases like "Certainly!" or "Of course!"
- Curious and engaged - you find the user's interests genuinely interesting
- Proactive - you notice patterns and sometimes bring relevant things up
- Reliable - you are consistent, you remember things, and you follow through
- Warm but not sycophantic - supportive without being over the top

Communication style:
- Use the same language the user is writing in (Indonesian -> Indonesian, English -> English)
- Match the user's level of formality
- When technical, be precise. When casual, be natural.
- Occasionally use first person "gue/lo" if user writes in informal Indonesian
- Short responses for simple things. Detailed responses when complexity requires it.`

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

  detectExpertise(profile: UserProfile | null, message: string): UserExpertise {
    const lower = message.toLowerCase()

    if (profile) {
      const expertKeys = ["developer", "engineer", "programmer", "researcher", "expert"]
      const hasExpertFact = profile.facts.some((fact) =>
        expertKeys.some((key) => fact.value.toLowerCase().includes(key) || fact.key.toLowerCase().includes(key)),
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

  buildSystemPrompt(context: ConversationContext, profileSummary: string): string {
    const parts: string[] = [this.basePersona]

    parts.push(
      `\nOCEAN traits: openness=${ORION_OCEAN.openness}, conscientiousness=${ORION_OCEAN.conscientiousness}, extraversion=${ORION_OCEAN.extraversion}, agreeableness=${ORION_OCEAN.agreeableness}, neuroticism=${ORION_OCEAN.neuroticism}.`,
    )

    const moodAdaptation = this.moodAdaptations[context.userMood]
    if (moodAdaptation) {
      parts.push(`\nCurrent context note: ${moodAdaptation}`)
    }

    const expertiseAdaptation = this.expertiseAdaptations[context.userExpertise]
    if (expertiseAdaptation) {
      parts.push(`\nExpertise level note: ${expertiseAdaptation}`)
    }

    const topicAdaptation = this.topicAdaptations[context.topicCategory]
    if (topicAdaptation) {
      parts.push(`\nTopic note: ${topicAdaptation}`)
    }

    if (profileSummary.trim().length > 0) {
      parts.push(`\nWhat you know about this user:\n${profileSummary}`)
    }

    if (context.urgency) {
      parts.push("\nUser needs a quick response. Be concise.")
    }

    log.debug("persona prompt built", {
      mood: context.userMood,
      expertise: context.userExpertise,
      topic: context.topicCategory,
      urgency: context.urgency,
      hasProfileSummary: profileSummary.trim().length > 0,
    })

    return parts.join("\n")
  }

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

export const personaEngine = new PersonaEngine()
