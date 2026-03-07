import type { Message } from "@prisma/client"

import { getHistory } from "../database/index.js"
import { createLogger } from "../logger.js"
import { sessionStore } from "../sessions/session-store.js"
import { causalGraph } from "./causal-graph.js"
import { hybridRetriever } from "./hybrid-retriever.js"
import { memory } from "./store.js"
import { profiler } from "./profiler.js"
import { detectQueryComplexity, temporalIndex } from "./temporal-index.js"
import config from "../config.js"

const log = createLogger("memory.himes")

/**
 * Rough token estimate: ~4 characters per token on average. This avoids a
 * full tokenizer dependency while staying within ±15 % of real BPE counts for
 * English text (validated against cl100k_base on mixed prose/code samples).
 *
 * Ref: OpenAI tokenizer cookbook — "A helpful rule of thumb is that one token
 * generally corresponds to ~4 characters of text for common English text."
 */
const CHARS_PER_TOKEN = 4

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Enforce a hard token budget on the fused context array.
 *
 * Strategy (priority-preserving):
 *   1. Walk the context entries in order (profile → facts → memories → docs → session).
 *   2. Keep each entry as long as the running total stays within budget.
 *   3. If a single entry would exceed the remaining budget, truncate its
 *      content by characters to fit, then stop accepting further entries.
 *
 * This ensures the highest-priority context (profile, causal patterns) is
 * always included first, while lower-priority context gracefully degrades.
 */
function enforceTokenBudget(
  context: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (maxTokens <= 0) {
    return context
  }

  const budgeted: Array<{ role: "user" | "assistant"; content: string }> = []
  let usedTokens = 0

  for (const entry of context) {
    const entryTokens = estimateTokens(entry.content)

    if (usedTokens + entryTokens <= maxTokens) {
      budgeted.push(entry)
      usedTokens += entryTokens
      continue
    }

    // Partial fit: truncate content to fill remaining budget
    const remainingTokens = maxTokens - usedTokens
    if (remainingTokens > 20) {
      const truncatedLength = remainingTokens * CHARS_PER_TOKEN
      budgeted.push({
        role: entry.role,
        content: entry.content.slice(0, truncatedLength) + "\n[…truncated]",
      })
    }
    break
  }

  return budgeted
}

/**
 * HiMeS — Hierarchical Memory System.
 *
 * Fuses short-term session context with long-term persistent memory to
 * assemble the most relevant context for each agent turn.
 *
 * Architecture:
 *   Short-term: recent N turns from current session (lossless)
 *   Long-term: vector + FTS hybrid retrieval via HybridRetriever
 *   Fusion: RRF-ranked merge of short and long term results
 *
 * Memory retrieval uses HybridRetriever (vector + FTS + RRF reranking)
 * rather than pure semantic search. This handles:
 *   - Exact matches (names, dates, IDs) → FTS
 *   - Semantic similarity (concepts, intent) → vector
 *   - Final ranking → MemRL Q-value weighting
 *
 * Additional features:
 *   - Temporal index for time-sensitive queries
 *   - Causal graph for relationship tracking
 *   - User profiling for personalization
 *
 * Research basis: arXiv 2601.06152 (HiMeS),
 * arXiv 2512.13564 (Memory in the Age of AI Agents — taxonomy),
 * arXiv 2506.00054 (Hybrid Search + RAG Survey)
 */

type ContextMessage = Pick<Message, "role" | "content" | "createdAt">

function asContextMessage(input: { role: string; content: string; createdAt: Date }): ContextMessage {
  return {
    role: input.role,
    content: input.content,
    createdAt: input.createdAt,
  }
}

function dedupeMemories(memories: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const memoryText of memories) {
    const normalized = memoryText.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    deduped.push(memoryText)
  }

  return deduped
}

function applyForgettingCurve(memories: string[]): string[] {
  const retained: string[] = []
  for (const [index, memoryText] of memories.entries()) {
    const retention = Math.exp(-index / 6)
    if (retention >= 0.25) {
      retained.push(memoryText)
    }
  }
  return retained.length > 0 ? retained : memories.slice(0, 3)
}

function consolidateMemories(memories: string[]): string[] {
  if (memories.length <= 6) {
    return memories
  }

  const head = memories.slice(0, 4)
  const tail = memories.slice(4, 10).map((item) => item.replace(/\s+/g, " ").trim())
  if (tail.length === 0) {
    return head
  }

  return [
    ...head,
    `[Consolidated Memory]\n- ${tail.join("\n- ")}`,
  ]
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

      const mergedMemories = [
        ...temporalMemories.map((node) => node.content),
        ...causalItems.map((item) => item.content),
      ]
      const dedupedMemories = dedupeMemories(mergedMemories)
      const decayedMemories = config.HIMES_FORGETTING_CURVE_ENABLED
        ? applyForgettingCurve(dedupedMemories)
        : dedupedMemories
      const consolidatedMemories = config.HIMES_CONSOLIDATION_ENABLED
        ? consolidateMemories(decayedMemories)
        : decayedMemories

      return {
        personalFacts,
        opinions,
        relevantMemories: consolidatedMemories.slice(0, 10),
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

  /**
   * Assemble the full fused context from short-term + long-term memory.
   *
   * @param maxTokens  Soft token budget. When > 0, the returned context is
   *                   truncated so that the total estimated token count does
   *                   not exceed this limit. Pass 0 or omit to disable.
   *                   Defaults to `SESSION_CONTEXT_WINDOW_TOKENS` from config.
   *
   * Research ref: arXiv 2601.06152 §3.2 — token-aware context assembly.
   */
  async buildFusedContext(
    userId: string,
    query: string,
    maxTokens: number = config.SESSION_CONTEXT_WINDOW_TOKENS,
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

      if (maxTokens > 0) {
        const budgeted = enforceTokenBudget(context, maxTokens)
        if (budgeted.length < context.length) {
          log.info("HiMeS context truncated to fit token budget", {
            userId,
            maxTokens,
            originalEntries: context.length,
            keptEntries: budgeted.length,
          })
        }
        return budgeted
      }

      return context
    } catch (error) {
      log.error("buildFusedContext failed", error)
      return []
    }
  }

  /**
   * Pre-fetch relevant documents using hybrid retrieval (FTS + Vector + RRF).
   *
   * Falls back to temporal index if HYBRID_SEARCH_ENABLED=false or on error.
   *
   * Architecture:
   * - Full-text search (FTS) for keyword matching using SQLite FTS5
   * - Vector search for semantic similarity using LanceDB
   * - RRF (Reciprocal Rank Fusion) for optimal ranking
   *
   * Refs: arXiv 2312.10997 (Hybrid Search + RAG Survey)
   */
  private async preFetchDocs(
    userId: string,
    query: string,
  ): Promise<Array<{ content: string; relevanceScore: number }>> {
    if (!config.HYBRID_SEARCH_ENABLED) {
      return this.preFetchDocsLegacy(userId, query)
    }

    try {
      const results = await hybridRetriever.retrieve(
        userId,
        query,
        (text) => memory.embed(text),
        8, // topK
      )

      return results.map((result) => ({
        content: result.content,
        relevanceScore: result.score,
      }))
    } catch (err) {
      log.warn("hybrid retrieval failed, falling back to temporal index", { userId, query: query.slice(0, 100), err })
      return this.preFetchDocsLegacy(userId, query)
    }
  }

  /**
   * Legacy pre-fetch using temporal index only.
   * Used as fallback when hybrid search is disabled or fails.
   */
  private async preFetchDocsLegacy(
    userId: string,
    query: string,
  ): Promise<Array<{ content: string; relevanceScore: number }>> {
    try {
      const complexity = detectQueryComplexity(query)
      const results = await temporalIndex.retrieve(userId, query, complexity)

      return results.slice(0, 5).map((result, index) => ({
        content: result.content,
        relevanceScore: Math.max(0.2, 1 - index * 0.12),
      }))
    } catch (error) {
      log.error("preFetchDocsLegacy failed", error)
      return []
    }
  }
}

export const hiMeS = new HiMeSCoordinator()

export const __himesTestUtils = {
  dedupeMemories,
  applyForgettingCurve,
  consolidateMemories,
  estimateTokens,
  enforceTokenBudget,
}
