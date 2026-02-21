import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.profiler")

export interface PersonaFact {
  key: string
  value: string
  confidence: number
  lastUpdated: number
  source: string
}

export interface PersonaOpinion {
  belief: string
  confidence: number
  evidence: string[]
  updatedAt: number
}

export interface UserProfile {
  userId: string
  facts: PersonaFact[]
  opinions: PersonaOpinion[]
  currentTopics: string[]
  lastExtracted: number
}

interface ExtractionPayload {
  facts?: Array<{ key?: string; value?: string; confidence?: number }>
  opinions?: Array<{ belief?: string; confidence?: number; evidence?: string[] }>
}

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function normalizeFactKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
}

function parseJsonPayload(raw: string): ExtractionPayload | null {
  const cleaned = raw.replace(/```json|```/g, "").trim()
  try {
    const parsed = JSON.parse(cleaned) as ExtractionPayload
    if (!parsed || typeof parsed !== "object") {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const EXTRACTION_PROMPT_PREFIX =
  "From this message, extract: (1) objective facts about the user as {key, value, confidence}, only if clearly stated. (2) inferred beliefs as {belief, confidence, evidence}, only if reasonably implied. Return strict JSON object with keys {facts: [], opinions: []}. Message: "

export class UserProfiler {
  async extractFromMessage(
    userId: string,
    message: string,
    role: "user" | "assistant",
  ): Promise<{
    facts: PersonaFact[]
    opinions: PersonaOpinion[]
  }> {
    if (role !== "user" || message.trim().length < 10) {
      return { facts: [], opinions: [] }
    }

    try {
      const prompt = `${EXTRACTION_PROMPT_PREFIX}${message}`
      const response = await orchestrator.generate("fast", { prompt })
      const payload = parseJsonPayload(response)

      if (!payload) {
        return { facts: [], opinions: [] }
      }

      const now = Date.now()
      const sourceSnippet = message.slice(0, 50)

      const facts: PersonaFact[] = []
      for (const candidate of payload.facts ?? []) {
        if (!candidate.key || !candidate.value) {
          continue
        }

        const confidence = clamp(Number(candidate.confidence ?? 0))
        if (confidence < 0.7) {
          continue
        }

        const key = normalizeFactKey(candidate.key)
        if (!key) {
          continue
        }

        facts.push({
          key,
          value: candidate.value.trim(),
          confidence,
          lastUpdated: now,
          source: sourceSnippet,
        })
      }

      const opinions: PersonaOpinion[] = []
      for (const candidate of payload.opinions ?? []) {
        if (!candidate.belief || candidate.belief.trim().length < 6) {
          continue
        }

        const evidence = Array.isArray(candidate.evidence)
          ? candidate.evidence.filter((item) => typeof item === "string" && item.trim().length > 0)
          : []

        opinions.push({
          belief: candidate.belief.trim(),
          confidence: clamp(Number(candidate.confidence ?? 0.5)),
          evidence: evidence.length > 0 ? evidence.slice(0, 5) : [sourceSnippet],
          updatedAt: now,
        })
      }

      return { facts, opinions }
    } catch (error) {
      log.error("extractFromMessage failed", { userId, error })
      return { facts: [], opinions: [] }
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    try {
      const record = await prisma.userProfile.findUnique({ where: { userId } })
      if (!record) {
        return null
      }

      const facts = Array.isArray(record.facts) ? (record.facts as unknown as PersonaFact[]) : []
      const opinions = Array.isArray(record.opinions) ? (record.opinions as unknown as PersonaOpinion[]) : []
      const topics = Array.isArray(record.topics) ? (record.topics as unknown as string[]) : []

      return {
        userId,
        facts,
        opinions,
        currentTopics: topics,
        lastExtracted: record.updatedAt.getTime(),
      }
    } catch (error) {
      log.error("getProfile failed", error)
      return null
    }
  }

  async updateProfile(userId: string, facts: PersonaFact[], opinions: PersonaOpinion[]): Promise<void> {
    try {
      const existing = await this.getProfile(userId)
      const factMap = new Map<string, PersonaFact>()
      const opinionMap = new Map<string, PersonaOpinion>()

      for (const fact of existing?.facts ?? []) {
        factMap.set(fact.key, fact)
      }
      for (const opinion of existing?.opinions ?? []) {
        opinionMap.set(opinion.belief.toLowerCase(), opinion)
      }

      for (const fact of facts) {
        const current = factMap.get(fact.key)
        if (!current || fact.confidence >= current.confidence) {
          factMap.set(fact.key, {
            ...fact,
            confidence: clamp(fact.confidence),
            lastUpdated: Date.now(),
            source: fact.source.slice(0, 50),
          })
        }
      }

      for (const opinion of opinions) {
        const key = opinion.belief.toLowerCase()
        const current = opinionMap.get(key)

        if (!current) {
          opinionMap.set(key, {
            ...opinion,
            confidence: clamp(opinion.confidence),
            evidence: opinion.evidence.slice(0, 8),
            updatedAt: Date.now(),
          })
          continue
        }

        const mergedEvidence = Array.from(new Set([...current.evidence, ...opinion.evidence])).slice(0, 10)
        const mergedConfidence = clamp((current.confidence + opinion.confidence) / 2)

        opinionMap.set(key, {
          belief: current.belief,
          confidence: mergedConfidence,
          evidence: mergedEvidence,
          updatedAt: Date.now(),
        })
      }

      const mergedFacts = Array.from(factMap.values())
      const mergedOpinions = Array.from(opinionMap.values())
      const topics = this.extractTopics(mergedFacts, mergedOpinions)

      await prisma.userProfile.upsert({
        where: { userId },
        update: {
          facts: JSON.parse(JSON.stringify(mergedFacts)),
          opinions: JSON.parse(JSON.stringify(mergedOpinions)),
          topics: JSON.parse(JSON.stringify(topics)),
        },
        create: {
          userId,
          facts: JSON.parse(JSON.stringify(mergedFacts)),
          opinions: JSON.parse(JSON.stringify(mergedOpinions)),
          topics: JSON.parse(JSON.stringify(topics)),
        },
      })

      log.debug("profile updated", {
        userId,
        facts: mergedFacts.length,
        opinions: mergedOpinions.length,
      })
    } catch (error) {
      log.error("updateProfile failed", { userId, error })
    }
  }

  async updateOpinionConfidence(
    userId: string,
    belief: string,
    newEvidence: string,
    direction: "supports" | "contradicts",
  ): Promise<void> {
    try {
      const profile = await this.getProfile(userId)
      const facts = [...(profile?.facts ?? [])]
      const opinions = [...(profile?.opinions ?? [])]
      const normalizedBelief = belief.trim().toLowerCase()
      const now = Date.now()

      const foundIndex = opinions.findIndex((item) => item.belief.toLowerCase() === normalizedBelief)
      const delta = direction === "supports" ? 0.1 : -0.15

      if (foundIndex < 0) {
        opinions.push({
          belief: belief.trim(),
          confidence: clamp(0.5 + delta),
          evidence: [newEvidence.slice(0, 120)],
          updatedAt: now,
        })
      } else {
        const current = opinions[foundIndex]
        const evidence = Array.from(new Set([...current.evidence, newEvidence.slice(0, 120)])).slice(0, 10)

        opinions[foundIndex] = {
          ...current,
          confidence: clamp(current.confidence + delta, 0.05, 0.99),
          evidence,
          updatedAt: now,
        }
      }

      const topics = this.extractTopics(facts, opinions)
      await prisma.userProfile.upsert({
        where: { userId },
        update: {
          facts: JSON.parse(JSON.stringify(facts)),
          opinions: JSON.parse(JSON.stringify(opinions)),
          topics: JSON.parse(JSON.stringify(topics)),
        },
        create: {
          userId,
          facts: JSON.parse(JSON.stringify(facts)),
          opinions: JSON.parse(JSON.stringify(opinions)),
          topics: JSON.parse(JSON.stringify(topics)),
        },
      })
    } catch (error) {
      log.error("updateOpinionConfidence failed", { userId, error })
    }
  }

  private extractTopics(facts: PersonaFact[], opinions: PersonaOpinion[]): string[] {
    const topics = new Set<string>()

    for (const fact of facts) {
      if (fact.key.includes("interest") || fact.key.includes("topic") || fact.key.includes("hobby")) {
        for (const token of fact.value.toLowerCase().split(/[^a-z0-9]+/)) {
          if (token.length >= 4) {
            topics.add(token)
          }
        }
      }
    }

    for (const opinion of opinions) {
      for (const token of opinion.belief.toLowerCase().split(/[^a-z0-9]+/)) {
        if (token.length >= 5) {
          topics.add(token)
        }
      }
    }

    return Array.from(topics).slice(0, 15)
  }

  async formatForContext(userId: string): Promise<string> {
    try {
      const profile = await this.getProfile(userId)
      if (!profile || (profile.facts.length === 0 && profile.opinions.length === 0)) {
        return ""
      }

      const lines: string[] = []

      if (profile.facts.length > 0) {
        lines.push("Facts:")
        for (const fact of profile.facts.sort((a, b) => b.confidence - a.confidence).slice(0, 8)) {
          lines.push(`- ${fact.key}: ${fact.value} (${Math.round(fact.confidence * 100)}%)`)
        }
      }

      if (profile.opinions.length > 0) {
        lines.push("Opinions:")
        for (const opinion of profile.opinions.sort((a, b) => b.confidence - a.confidence).slice(0, 6)) {
          lines.push(`- ${opinion.belief} (${Math.round(opinion.confidence * 100)}%)`)
        }
      }

      if (profile.currentTopics.length > 0) {
        lines.push(`Topics: ${profile.currentTopics.slice(0, 8).join(", ")}`)
      }

      return lines.join("\n")
    } catch (error) {
      log.error("formatForContext failed", { userId, error })
      return ""
    }
  }
}

export const profiler = new UserProfiler()
