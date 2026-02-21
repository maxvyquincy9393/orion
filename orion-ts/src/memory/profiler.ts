import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.profiler")

export interface PersonaAttribute {
  key: string
  value: string
  confidence: number
  lastUpdated: number
  source: string
}

export interface UserProfile {
  userId: string
  attributes: PersonaAttribute[]
  currentTopics: string[]
  lastExtracted: number
}

const EXTRACTION_PROMPT = `Extract user characteristics from this message as JSON array. Only extract if clearly stated or strongly implied. Return [] if nothing clear.

Format: [{"key": "trait_name", "value": "extracted_value", "confidence": 0.0-1.0}]

Keys to look for: occupation, interests, location, preferences, goals, personality_traits, communication_style, expertise_areas

Message: `

export class UserProfiler {
  async extractFromMessage(
    userId: string,
    message: string,
    role: "user" | "assistant"
  ): Promise<PersonaAttribute[]> {
    if (role !== "user" || message.length < 10) {
      return []
    }

    try {
      const prompt = EXTRACTION_PROMPT + message
      const response = await orchestrator.generate("fast", { prompt })

      let attributes: Array<{ key: string; value: string; confidence: number }> = []
      try {
        const cleaned = response.replace(/```json|```/g, "").trim()
        attributes = JSON.parse(cleaned)
        if (!Array.isArray(attributes)) {
          return []
        }
      } catch {
        return []
      }

      const validAttributes: PersonaAttribute[] = []
      const now = Date.now()
      const source = message.slice(0, 50)

      for (const attr of attributes) {
        if (!attr.key || !attr.value || typeof attr.confidence !== "number") {
          continue
        }
        if (attr.confidence < 0.6) {
          continue
        }

        validAttributes.push({
          key: attr.key.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          value: attr.value,
          confidence: Math.min(1, Math.max(0, attr.confidence)),
          lastUpdated: now,
          source,
        })
      }

      return validAttributes
    } catch (error) {
      log.error("extractFromMessage failed", error)
      return []
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    try {
      const record = await prisma.userProfile.findUnique({
        where: { userId },
      })

      if (!record) {
        return null
      }

      const attributes = (record.attributes as unknown as PersonaAttribute[]) ?? []
      const topics = (record.topics as unknown as string[]) ?? []

      return {
        userId,
        attributes,
        currentTopics: topics,
        lastExtracted: record.updatedAt.getTime(),
      }
    } catch (error) {
      log.error("getProfile failed", error)
      return null
    }
  }

  async updateProfile(userId: string, attributes: PersonaAttribute[]): Promise<void> {
    if (attributes.length === 0) {
      return
    }

    try {
      const existing = await this.getProfile(userId)
      const mergedMap = new Map<string, PersonaAttribute>()

      if (existing) {
        for (const attr of existing.attributes) {
          mergedMap.set(attr.key, attr)
        }
      }

      for (const attr of attributes) {
        const existingAttr = mergedMap.get(attr.key)
        if (!existingAttr || attr.confidence > existingAttr.confidence) {
          mergedMap.set(attr.key, attr)
        }
      }

      const mergedAttributes = Array.from(mergedMap.values())
      const topics = this.extractTopics(mergedAttributes)

      await prisma.userProfile.upsert({
        where: { userId },
        update: {
          attributes: JSON.parse(JSON.stringify(mergedAttributes)),
          topics: JSON.parse(JSON.stringify(topics)),
        },
        create: {
          userId,
          attributes: JSON.parse(JSON.stringify(mergedAttributes)),
          topics: JSON.parse(JSON.stringify(topics)),
        },
      })

      log.debug("profile updated", { userId, attributeCount: mergedAttributes.length })
    } catch (error) {
      log.error("updateProfile failed", error)
    }
  }

  private extractTopics(attributes: PersonaAttribute[]): string[] {
    const topics = new Set<string>()

    for (const attr of attributes) {
      if (attr.key.includes("interest") || attr.key.includes("expertise")) {
        const values = attr.value.toLowerCase().split(/[,\s]+/)
        for (const v of values) {
          if (v.length > 3) {
            topics.add(v)
          }
        }
      }
    }

    return Array.from(topics).slice(0, 10)
  }

  async formatForContext(userId: string): Promise<string> {
    try {
      const profile = await this.getProfile(userId)
      if (!profile || profile.attributes.length === 0) {
        return ""
      }

      const lines: string[] = ["User Profile:"]
      const topAttributes = profile.attributes
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10)

      for (const attr of topAttributes) {
        lines.push(`- ${attr.key}: ${attr.value} (${Math.round(attr.confidence * 100)}%)`)
      }

      return lines.join("\n")
    } catch (error) {
      log.error("formatForContext failed", error)
      return ""
    }
  }
}

export const profiler = new UserProfiler()
