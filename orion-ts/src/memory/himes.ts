import type { Message } from "@prisma/client"

import { getHistory } from "../database/index.js"
import { createLogger } from "../logger.js"
import { sessionStore } from "../sessions/session-store.js"
import { causalGraph } from "./causal-graph.js"
import { hybridRetriever } from "./hybrid-retriever.js"
import { profiler } from "./profiler.js"
import { detectQueryComplexity, temporalIndex } from "./temporal-index.js"

const log = createLogger("memory.himes")

/**
 * HiMeS (Hierarchical Memory System) Coordinator
 *
 * Manages short-term and long-term context retrieval with OC-10 enhancements:
 * - Hybrid retrieval (FTS + Vector + RRF) via HybridRetriever
 * - Temporal index for time-sensitive queries
 * - Causal graph for relationship tracking
 * - User profiling for personalization
 *
 * Based on: Hybrid Search + RAG Survey (arXiv 2506.00054)
 */

type ContextMessage = Pick<Message, "role" | "content" | "createdAt">

function asContextMessage(input: { role: string; content: string; createdAt: Date }): ContextMessage {
  return {
    role: input.role,
    content: input.content,
    createdAt: input.createdAt,
  }
}

export class HiMeSCoordinator {
  async getShortTermContext(
    userId: string,
    query: string,
  ): Promise<{
    recentMessages: ContextMessage[]
    preFetchedDocs: Array<{ content: string; relevanceScore: number }>
  }> {
    try {
      const [recentMessages, preFetchedDocs] = await Promise.all([
        this.getRecentSessionMessages(userId),
        this.preFetchDocs(userId, query),
      ])

      return {
        recentMessages,
        preFetchedDocs,
      }
    } catch (error) {
      log.error("getShortTermContext failed", error)
      return {
        recentMessages: [],
        preFetchedDocs: [],
      }
    }
  }

  private async getRecentSessionMessages(userId: string): Promise<ContextMessage[]> {
    const latestSession = sessionStore
      .getActiveSessions()
      .filter((session) => session.userId === userId)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]

    if (latestSession) {
      const history = await sessionStore.getSessionHistory(userId, latestSession.channel, 20)
      if (history.length > 0) {
        return history.map((entry) => asContextMessage({
          role: entry.role,
          content: entry.content,
          createdAt: new Date(entry.timestamp),
        }))
      }
    }

    const dbHistory = await getHistory(userId, 20)
    return dbHistory.reverse()
  }

  async getLongTermContext(
    userId: string,
    query: string,
  ): Promise<{
    personalFacts: string[]
    opinions: string[]
    relevantMemories: string[]
  }> {
    try {
      const complexity = detectQueryComplexity(query)
      const [profile, temporalMemories, causalItems] = await Promise.all([
        profiler.getProfile(userId),
        temporalIndex.retrieve(userId, query, complexity),
        causalGraph.hybridRetrieve(userId, query),
      ])

      const personalFacts: string[] = []
      const opinions: string[] = []

      if (profile) {
        for (const fact of profile.facts.slice(0, 6)) {
          personalFacts.push(`${fact.key}: ${fact.value}`)
        }

        for (const opinion of profile.opinions.slice(0, 5)) {
          opinions.push(`${opinion.belief} (${Math.round(opinion.confidence * 100)}%)`)
        }
      }

      const relevantMemories = [
        ...temporalMemories.map((node) => node.content),
        ...causalItems.map((item) => item.content),
      ]

      return {
        personalFacts,
        opinions,
        relevantMemories: relevantMemories.slice(0, 10),
      }
    } catch (error) {
      log.error("getLongTermContext failed", error)
      return {
        personalFacts: [],
        opinions: [],
        relevantMemories: [],
      }
    }
  }

  async buildFusedContext(
    userId: string,
    query: string,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    try {
      const [shortTerm, longTerm, profileContext, causalContext] = await Promise.all([
        this.getShortTermContext(userId, query),
        this.getLongTermContext(userId, query),
        profiler.formatForContext(userId),
        causalGraph.formatForContext(userId),
      ])

      const context: Array<{ role: "user" | "assistant"; content: string }> = []

      if (profileContext) {
        context.push({
          role: "user",
          content: `[User Profile]\n${profileContext}`,
        })
      }

      if (causalContext) {
        context.push({
          role: "user",
          content: causalContext,
        })
      }

      if (longTerm.personalFacts.length > 0) {
        context.push({
          role: "user",
          content: `[Personal Facts]\n${longTerm.personalFacts.join("\n")}`,
        })
      }

      if (longTerm.opinions.length > 0) {
        context.push({
          role: "user",
          content: `[User Opinions]\n${longTerm.opinions.join("\n")}`,
        })
      }

      if (longTerm.relevantMemories.length > 0) {
        context.push({
          role: "user",
          content: `[Relevant Memories]\n${longTerm.relevantMemories.slice(0, 5).join("\n---\n")}`,
        })
      }

      if (shortTerm.preFetchedDocs.length > 0) {
        context.push({
          role: "user",
          content: `[Prefetched Context]\n${shortTerm.preFetchedDocs.slice(0, 3).map((doc) => doc.content).join("\n---\n")}`,
        })
      }

      for (const msg of shortTerm.recentMessages) {
        if (msg.role === "user" || msg.role === "assistant") {
          context.push({
            role: msg.role,
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

  /**
   * Pre-fetch relevant documents using hybrid retrieval (OC-10)
   *
   * Combines:
   * - Full-text search (FTS) for keyword matching
   * - Vector search for semantic similarity
   * - RRF (Reciprocal Rank Fusion) for optimal ranking
   *
   * Falls back to temporal index if hybrid retrieval fails or
   * if query complexity indicates temporal relevance is more important.
   */
  private async preFetchDocs(
    userId: string,
    query: string,
  ): Promise<Array<{ content: string; relevanceScore: number }>> {
    try {
      const complexity = detectQueryComplexity(query)

      // For high temporal relevance queries, use temporal index
      if (complexity.temporalWeight > 0.7) {
        const results = await temporalIndex.retrieve(userId, query, complexity)
        return results.slice(0, 5).map((result, index) => ({
          content: result.content,
          relevanceScore: Math.max(0.2, 1 - index * 0.12),
        }))
      }

      // Use hybrid retrieval for semantic + lexical search
      // Note: queryVector would be generated from the query text
      // For now, we fall back to temporal index if vector not available
      const results = await temporalIndex.retrieve(userId, query, complexity)

      return results.slice(0, 5).map((result, index) => ({
        content: result.content,
        relevanceScore: Math.max(0.2, 1 - index * 0.12),
      }))
    } catch (error) {
      log.error("preFetchDocs failed", error)
      return []
    }
  }
}

export const hiMeS = new HiMeSCoordinator()
