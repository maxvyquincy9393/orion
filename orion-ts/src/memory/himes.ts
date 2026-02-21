import type { Message } from "@prisma/client"

import { getHistory } from "../database/index.js"
import { memory } from "./store.js"
import { profiler } from "./profiler.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.himes")

export class HiMeSCoordinator {
  async getShortTermContext(
    userId: string,
    query: string
  ): Promise<{
    recentMessages: Message[]
    preFetchedDocs: Array<{ content: string; relevanceScore: number }>
  }> {
    try {
      const [messages, docs] = await Promise.all([
        getHistory(userId, 20),
        this.preFetchDocs(userId, query),
      ])

      return {
        recentMessages: messages,
        preFetchedDocs: docs,
      }
    } catch (error) {
      log.error("getShortTermContext failed", error)
      return {
        recentMessages: [],
        preFetchedDocs: [],
      }
    }
  }

  async getLongTermContext(
    userId: string,
    query: string
  ): Promise<{
    personalFacts: string[]
    relevantMemories: string[]
  }> {
    try {
      const [profile, memories] = await Promise.all([
        profiler.getProfile(userId),
        memory.search(userId, query, 10),
      ])

      const personalFacts: string[] = []
      if (profile) {
        for (const attr of profile.attributes.slice(0, 5)) {
          personalFacts.push(`${attr.key}: ${attr.value}`)
        }
      }

      const relevantMemories = memories.map((m) => m.content)

      return {
        personalFacts,
        relevantMemories,
      }
    } catch (error) {
      log.error("getLongTermContext failed", error)
      return {
        personalFacts: [],
        relevantMemories: [],
      }
    }
  }

  async buildFusedContext(
    userId: string,
    query: string
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    try {
      const [shortTerm, longTerm, profileContext] = await Promise.all([
        this.getShortTermContext(userId, query),
        this.getLongTermContext(userId, query),
        profiler.formatForContext(userId),
      ])

      const context: Array<{ role: "user" | "assistant"; content: string }> = []

      if (profileContext) {
        context.push({
          role: "user",
          content: `[User Context]\n${profileContext}`,
        })
      }

      if (longTerm.personalFacts.length > 0) {
        context.push({
          role: "user",
          content: `[Personal Facts]\n${longTerm.personalFacts.join("\n")}`,
        })
      }

      if (longTerm.relevantMemories.length > 0) {
        context.push({
          role: "user",
          content: `[Relevant Memories]\n${longTerm.relevantMemories.slice(0, 3).join("\n---\n")}`,
        })
      }

      if (shortTerm.preFetchedDocs.length > 0) {
        context.push({
          role: "user",
          content: `[Related Documents]\n${shortTerm.preFetchedDocs
            .slice(0, 3)
            .map((d) => d.content)
            .join("\n---\n")}`,
        })
      }

      for (const msg of shortTerm.recentMessages.reverse()) {
        if (msg.role === "user" || msg.role === "assistant") {
          context.push({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })
        }
      }

      return context
    } catch (error) {
      log.error("buildFusedContext failed", error)
      return []
    }
  }

  private async preFetchDocs(
    userId: string,
    query: string
  ): Promise<Array<{ content: string; relevanceScore: number }>> {
    try {
      const results = await memory.search(userId, query, 5)

      return results.map((r) => ({
        content: r.content,
        relevanceScore: r.score,
      }))
    } catch (error) {
      log.error("preFetchDocs failed", error)
      return []
    }
  }
}

export const hiMeS = new HiMeSCoordinator()
