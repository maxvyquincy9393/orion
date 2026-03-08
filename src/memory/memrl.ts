/**
 * MemRL — Memory Reinforcement Learning via Intent-Experience-Utility triplets.
 *
 * Implements the two-phase retrieval + Bellman Q-update architecture from:
 * arXiv 2601.03192 (MemRL: Self-Evolving Memory via Episodic RL)
 *
 * Phase A (retrieval): Semantic similarity filter — candidates from vector search
 * Phase B (ranking): Q-value reranking — high-utility memories surface first
 *
 * After every agent response, updateFromFeedback() is called to update Q-values:
 *   Q_new = Q_old + α * (r + γ * max_Q_next - Q_old)    [Bellman equation]
 *
 * Over time, memories that reliably lead to good outcomes get higher Q-values
 * and are retrieved more often. The agent learns what to remember.
 *
 * CRITICAL: updateFromFeedback() must be called after EVERY response.
 * If it is not called, the agent does not learn. This is wired in message-pipeline.ts
 * Stage 11. Do not bypass the pipeline.
 *
 * Memory format: Intent-Experience-Utility triplets
 *   intent: What was the user trying to achieve?
 *   experience: What did the agent do, and what happened?
 *   utility: Q-value [-1.0, 1.0] — learned from outcomes over time
 *
 * @module memory/memrl
 */

import fs from "node:fs/promises"
import path from "node:path"

import * as lancedb from "@lancedb/lancedb"

import config from "../config.js"
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import { sanitizeUserId, clamp, parseJsonSafe } from "../utils/index.js"
import type { SearchResult } from "./store.js"

const log = createLogger("memory.memrl")

/**
 * IEU Triplet structure for enhanced memory representation
 * Based on Mem-α paper: each memory has intent, experience, and utility components
 */
interface IEUTriplet {
  /** The user's original intent/query that led to this memory */
  intent: string
  /** The actual experience/content stored */
  experience: string
  /** Computed utility score (0-1) */
  utility: number
  /** Q-value for Bellman updates */
  qValue: number
}

interface LanceSearchRow extends Record<string, unknown> {
  id: string
  userId: string
  content: string
  metadata: string
  utilityScore?: number
  qValue?: number
  intentVector?: number[]
  _distance?: number
  distance?: number
  _score?: number
  score?: number
  similarity?: number
}

interface RankedCandidate {
  row: LanceSearchRow
  similarityScore: number
  utilityScore: number
  qValue: number
  blendedScore: number
  ieuTriplet: IEUTriplet
}

/**
 * Task feedback structure for reinforcement learning
 * Memory IDs are used to identify which memories contributed to a response
 */
export interface TaskFeedback {
  /** Memory IDs that were used in generating the response */
  memoryIds: string[]
  /** Whether the task was completed successfully */
  taskSuccess: boolean
  /** Explicit reward signal (0-1) */
  reward: number
  /** User's follow-up message for implicit feedback */
  userReply?: string
  /** Session context for temporal credit assignment */
  sessionId?: string
}

/**
 * Safely convert unknown value to number or null
 */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isFiniteVector(vector: number[]): boolean {
  return Array.isArray(vector) && vector.length > 0 && vector.every((item) => Number.isFinite(item))
}

function normalizeSimilarityThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.3
  }
  return clamp(value, 0, 1)
}

function computeEffectiveReward(explicitReward: number, taskSuccess: boolean): number {
  const normalizedExplicit = clamp(explicitReward, 0, 1)
  const successSignal = taskSuccess ? 1 : 0
  return clamp((normalizedExplicit * 0.7) + (successSignal * 0.3), 0, 1)
}

/**
 * Convert LanceDB distance/score to similarity score (0-1)
 */
function toSimilarityScore(row: LanceSearchRow): number {
  const distance = asNumber(row._distance) ?? asNumber(row.distance)
  if (distance !== null) {
    return clamp(1 / (1 + Math.max(0, distance)), 0, 1)
  }

  const rawScore = asNumber(row._score) ?? asNumber(row.score) ?? asNumber(row.similarity)
  if (rawScore === null) {
    return 0.5
  }

  if (rawScore >= 0 && rawScore <= 1) {
    return rawScore
  }

  return clamp(1 / (1 + Math.abs(rawScore)), 0, 1)
}

/**
 * Extract intent from content using simple heuristics
 * In production, this could use an LLM to extract true user intent
 */
function extractIntent(content: string): string {
  // Simple heuristic: first sentence or first 100 chars
  const firstSentence = content.split(/[.!?]/, 1)[0]?.trim() ?? content
  return firstSentence.slice(0, 200)
}

/**
 * MemRL Updater with IEU triplets and Bellman Q-learning
 * 
 * Implements the core reinforcement learning loop for memory optimization:
 * 1. Two-phase retrieval: similarity filter + utility ranking
 * 2. Bellman Q-value updates based on task feedback
 * 3. Intent-aware experience tracking
 */
export class MemRLUpdater {
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null

  /** Learning rate for utility updates (alpha) */
  private readonly alpha = clamp(config.MEMRL_ALPHA, 0.01, 1)
  /** Discount factor for future rewards (gamma) */
  private readonly gamma = clamp(config.MEMRL_GAMMA, 0, 1)
  /** Bellman Q-learning rate */
  private readonly qAlpha = 0.1

  /**
   * Ensure LanceDB table is initialized and available
   */
  private async ensureTable(): Promise<lancedb.Table | null> {
    if (this.table) {
      return this.table
    }

    try {
      const dbPath = path.resolve(process.cwd(), ".edith", "lancedb")
      await fs.mkdir(path.dirname(dbPath), { recursive: true })
      this.db = await lancedb.connect(dbPath)

      const tableNames = await this.db.tableNames()
      if (!tableNames.includes("memories")) {
        return null
      }

      this.table = await this.db.openTable("memories")
      return this.table
    } catch (error) {
      log.warn("failed to init memrl lancedb table", error)
      return null
    }
  }

  /**
   * Update memory utility based on task feedback using Bellman equation
   * 
   * Q(s,a) = Q(s,a) + α * [r + γ * max(Q(s',a')) - Q(s,a)]
   * 
   * Where:
   * - s = current state (memory context)
   * - a = action (retrieving this memory)
   * - r = reward from feedback
   * - s' = next state (follow-up context)
   * - α = learning rate
   * - γ = discount factor
   */
  async updateFromFeedback(feedback: TaskFeedback): Promise<void> {
    if (!Array.isArray(feedback.memoryIds) || feedback.memoryIds.length === 0) {
      return
    }

    const uniqueIds = Array.from(
      new Set(
        feedback.memoryIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    )
    if (uniqueIds.length === 0) {
      return
    }

    // Compute effective reward combining explicit and implicit signals.
    // gamma remains strictly a temporal discount factor in Bellman updates.
    const effectiveReward = computeEffectiveReward(feedback.reward, feedback.taskSuccess)

    const nodes = await prisma.memoryNode.findMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
      select: {
        id: true,
        userId: true,
        utilityScore: true,
        qValue: true,
        metadata: true,
      },
    })

    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const fallbackNextMaxQByUser = new Map<string, number>()

    // Update each memory with Bellman Q-value and utility
    await Promise.all(uniqueIds.map(async (memoryId) => {
      try {
        const node = nodeById.get(memoryId)

        if (!node) {
          return
        }

        // Get current Q-value (default to utility if not set)
        const currentQ = node.qValue ?? node.utilityScore

        const peerMaxQ = nodes
          .filter((candidate) => candidate.userId === node.userId && candidate.id !== memoryId)
          .map((candidate) => candidate.qValue ?? candidate.utilityScore)

        let nextMaxQ = peerMaxQ.length > 0
          ? Math.max(...peerMaxQ)
          : Number.NaN

        if (!Number.isFinite(nextMaxQ)) {
          if (fallbackNextMaxQByUser.has(node.userId)) {
            nextMaxQ = fallbackNextMaxQByUser.get(node.userId) ?? 0.5
          } else {
            const successor = await prisma.memoryNode.findFirst({
              where: {
                userId: node.userId,
                id: { not: memoryId },
              },
              orderBy: { qValue: "desc" },
              select: {
                qValue: true,
                utilityScore: true,
              },
            })

            nextMaxQ = successor
              ? (successor.qValue ?? successor.utilityScore)
              : 0.5
            fallbackNextMaxQByUser.set(node.userId, nextMaxQ)
          }
        }

        nextMaxQ = clamp(nextMaxQ, -1, 1)

        // Bellman update: Q = Q + α * (r + γ * maxQ' - Q)
        const bellmanUpdate = currentQ + this.qAlpha * (effectiveReward + this.gamma * nextMaxQ - currentQ)
        const newQValue = clamp(bellmanUpdate, -1, 1)

        // Traditional utility update with exponential moving average
        const newUtility = clamp(
          node.utilityScore + this.alpha * (effectiveReward - node.utilityScore),
          0,
          1,
        )

        // Update metadata with IEU triplet info
        const metadata = asRecord(node.metadata)
        const updatedMetadata = {
          ...metadata,
          lastFeedback: {
            reward: effectiveReward,
            timestamp: new Date().toISOString(),
            taskSuccess: feedback.taskSuccess,
          },
          intent: metadata.intent ?? extractIntent(typeof metadata.experience === "string" ? metadata.experience : ""),
        }

        await prisma.memoryNode.update({
          where: { id: memoryId },
          data: {
            utilityScore: newUtility,
            qValue: newQValue,
            metadata: updatedMetadata,
            retrievalCount: {
              increment: 1,
            },
            ...(feedback.taskSuccess
              ? {
                successCount: {
                  increment: 1,
                },
              }
              : {}),
          },
        })

        log.debug("memrl update applied", { 
          memoryId, 
          oldUtility: node.utilityScore,
          newUtility,
          oldQ: currentQ,
          newQ: newQValue,
          nextMaxQ,
          reward: effectiveReward,
        })
      } catch (error) {
        log.debug("memrl update skipped", { memoryId, error })
      }
    }))
  }

  /**
   * Two-Phase retrieval with IEU triplet ranking
   * 
   * Phase 1: Filter by similarity threshold
   * Phase 2: Rank by blended score (similarity + Q-value + utility)
   * 
   * The IEU triplet allows for intent-aware retrieval where memories
   * with matching intents are prioritized even if their raw content
   * similarity is lower.
   */
  async twoPhaseRetrieve(
    userId: string,
    queryVector: number[],
    limit: number,
    similarityThreshold = 0.3,
  ): Promise<SearchResult[]> {
    const table = await this.ensureTable()
    if (!table || limit <= 0) {
      return []
    }

    if (!isFiniteVector(queryVector)) {
      return []
    }

    try {
      const sanitizedUserId = sanitizeUserId(userId)
      const normalizedSimilarityThreshold = normalizeSimilarityThreshold(similarityThreshold)
      const candidateLimit = Math.max(limit * 3, limit)

      // Phase 1: Vector similarity search
      const rawRows = await table
        .vectorSearch(queryVector)
        .where(`userId = '${sanitizedUserId}'`)
        .limit(candidateLimit)
        .toArray() as LanceSearchRow[]

      const phaseOne = rawRows
        .filter((row) => row.userId === sanitizedUserId && row.content !== "__init__")
        .map((row) => ({
          row,
          similarityScore: toSimilarityScore(row),
        }))
        .filter((candidate) => candidate.similarityScore > normalizedSimilarityThreshold)

      if (phaseOne.length === 0) {
        return []
      }

      // Phase 2: Fetch utility/Q-values from database for ranking
      const utilityRows = await prisma.memoryNode.findMany({
        where: {
          id: {
            in: phaseOne.map((candidate) => candidate.row.id),
          },
        },
        select: {
          id: true,
          utilityScore: true,
          qValue: true,
          metadata: true,
        },
      })

      const dataById = new Map(utilityRows.map((item) => [item.id, item]))

      // Build IEU triplets and compute blended scores
      const ranked: RankedCandidate[] = phaseOne.map((candidate) => {
        const data = dataById.get(candidate.row.id)
        const persistedUtility = data?.utilityScore
        const persistedQ = data?.qValue
        const metadata = asRecord(data?.metadata)
        
        const utilityScore = clamp(
          persistedUtility
          ?? asNumber(candidate.row.utilityScore)
          ?? 0.5,
          0.05,
          0.99,
        )
        
        const qValue = clamp(
          persistedQ
          ?? asNumber(candidate.row.qValue)
          ?? utilityScore,
          0.05,
          0.99,
        )

        // Build IEU triplet
        const ieuTriplet: IEUTriplet = {
          intent: (metadata.intent as string) ?? extractIntent(candidate.row.content),
          experience: candidate.row.content,
          utility: utilityScore,
          qValue,
        }

        // Blended score: 50% similarity, 30% Q-value, 20% utility
        // Q-value is weighted higher as it captures temporal credit assignment
        const blendedScore = (0.5 * candidate.similarityScore) + 
                            (0.3 * qValue) + 
                            (0.2 * utilityScore)

        return {
          row: candidate.row,
          similarityScore: candidate.similarityScore,
          utilityScore,
          qValue,
          blendedScore,
          ieuTriplet,
        }
      })

      // Sort by blended score and return top results
      return ranked
        .sort((a, b) => b.blendedScore - a.blendedScore)
        .slice(0, limit)
        .map((candidate) => ({
          id: candidate.row.id,
          content: candidate.row.content,
          metadata: {
            ...parseJsonSafe(candidate.row.metadata),
            ieu: candidate.ieuTriplet,
            qValue: candidate.qValue,
            blendedScore: candidate.blendedScore,
          },
          score: candidate.blendedScore,
        }))
    } catch (error) {
      log.warn("memrl two-phase retrieval failed", error)
      return []
    }
  }

  /**
   * Estimate implicit reward from user follow-up using multi-signal fusion.
   *
   * Signals evaluated in priority order:
   *   1. Explicit correction  → 0.05  (strong override — user said EDITH was wrong)
   *   2. Repeat question      → 0.15  (user re-asked same thing — response failed)
   *   3. Clarification req    → 0.25  (user didn't understand — response unclear)
   *   4. Explicit positive    → 0.90  (thanks / mantap / exactly)
   *   5. Short dismissal      → 0.35  (ok / oke / k — not engaged)
   *   6. Follow-up question   → 0.60  (continuing conversation, neutral-positive)
   *   7. Natural continuation → 0.65  (normal reply, engagement confirmed)
   *   8. Default              → 0.45
   *
   * IMPORTANT: reply length alone is NOT a reward signal.
   * A long reply may mean the user is confused, not satisfied.
   * A question may mean EDITH failed to answer completely.
   *
   * @param userReply - User's follow-up message
   * @param _previousResponseLength - Unused (kept for API compatibility)
   * @param context - Optional context for repeat-question detection
   * @returns Estimated reward in [0, 1]
   */
  estimateRewardFromContext(
    userReply: string | null,
    _previousResponseLength: number,
    context?: { previousQuery?: string },
  ): number {
    if (!userReply || userReply.trim().length === 0) {
      return 0.2  // No reply = session ended or ignored
    }

    const reply = userReply.trim().toLowerCase()

    // ── Signal 1: Explicit correction ────────────────────────────────
    // User is explicitly saying EDITH gave the wrong answer.
    const correctionRe = /\b(bukan itu|bukan maksudnya|bukan begitu|salah|keliru|tidak betul|tidak benar)\b|not what i (asked|meant|wanted|said)|that'?s? (wrong|incorrect|not right|not it|not what)|you'?re? wrong|wrong answer|incorrect answer|bukan gitu/
    if (correctionRe.test(reply)) {
      return 0.05
    }

    // ── Signal 2: Repeat question ─────────────────────────────────────
    // User re-asked essentially the same question → response didn't help.
    // Detection: Jaccard word overlap > 0.55 with previous query + is a question.
    if (context?.previousQuery && reply.includes("?")) {
      const stopWords = new Set(["yang", "apa", "gimana", "bagaimana", "kenapa", "mengapa", "the", "is", "are", "what", "how", "why", "when", "can", "do", "di", "ke", "dan", "atau"])
      const toWords = (s: string) =>
        s.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w))

      const prevWords = new Set(toWords(context.previousQuery))
      const curWords = new Set(toWords(reply))

      if (prevWords.size > 0 && curWords.size > 0) {
        const intersection = [...prevWords].filter(w => curWords.has(w)).length
        const union = new Set([...prevWords, ...curWords]).size
        const jaccard = intersection / union

        if (jaccard > 0.55) {
          return 0.15
        }
      }
    }

    // ── Signal 3: Clarification request ──────────────────────────────
    // User didn't understand — EDITH's response was unclear or incomplete.
    const clarificationRe = /\b(what do you mean|could you explain|don'?t understand|gak ngerti|ga ngerti|kurang jelas|explain more|be more specific|more detail|could you clarify|maksudnya apa|apa maksudnya|hah\?|huh\?|elaborate|i'?m? confused)\b/
    if (clarificationRe.test(reply)) {
      return 0.25
    }

    // ── Signal 4: Explicit positive ───────────────────────────────────
    const positiveRe = /\b(thanks|thank you|thank u|thx|helpful|great|perfect|excellent|awesome|exactly|spot on|that'?s? (right|correct|it|perfect)|yes exactly|got it thanks|makasih|terima kasih|mantap|bagus|bener|tepat|pas banget|you'?re? right|that helps)\b/
    if (positiveRe.test(reply)) {
      return 0.90
    }

    // ── Signal 5: Short dismissal ─────────────────────────────────────
    // Single-word acknowledgements with no engagement.
    const dismissals = new Set(["ok", "okay", "oke", "k", "fine", "sure", "alright", "noted", "ya", "yep", "yup", "hmm", "oh"])
    const replyTokens = reply.split(/\s+/)
    if (replyTokens.length <= 2 && replyTokens.every(w => dismissals.has(w.replace(/[.,!]$/, "")))) {
      return 0.35
    }

    // ── Signal 6: Follow-up question ─────────────────────────────────
    // User is continuing — conversation is alive, reply was at least partially useful.
    if (reply.includes("?") && reply.length > 15) {
      return 0.60
    }

    // ── Signal 7: Natural continuation ───────────────────────────────
    if (reply.length > 30) {
      return 0.65
    }

    if (reply.length > 10) {
      return 0.55
    }

    return 0.45
  }

  /**
   * Compute IEU triplet for a new memory
   * 
   * @param content - Memory content
   * @param context - Optional context for intent extraction
   * @returns IEU triplet with computed values
   */
  computeIEUTriplet(content: string, context?: { query?: string }): IEUTriplet {
    const intent = context?.query ? extractIntent(context.query) : extractIntent(content)
    
    return {
      intent,
      experience: content,
      utility: 0.5, // Initial neutral utility
      qValue: 0.5,  // Initial neutral Q-value
    }
  }
}

// Singleton instance
export const memrlUpdater = new MemRLUpdater()

export const __memrlTestUtils = {
  toSimilarityScore,
  extractIntent,
  normalizeSimilarityThreshold,
  computeEffectiveReward,
}
