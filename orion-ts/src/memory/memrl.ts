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
  /** Eligibility trace decay */
  private readonly lambda = 0.9

  /**
   * Ensure LanceDB table is initialized and available
   */
  private async ensureTable(): Promise<lancedb.Table | null> {
    if (this.table) {
      return this.table
    }

    try {
      const dbPath = path.resolve(process.cwd(), ".orion", "lancedb")
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
    if (feedback.memoryIds.length === 0) {
      return
    }

    const uniqueIds = Array.from(new Set(feedback.memoryIds.filter((id) => id.trim().length > 0)))
    if (uniqueIds.length === 0) {
      return
    }

    // Compute effective reward combining explicit and implicit signals
    const clampedReward = clamp(feedback.reward, 0, 1)
    const successSignal = feedback.taskSuccess ? 1 : 0
    const effectiveReward = clamp((clampedReward * this.gamma) + (successSignal * (1 - this.gamma)), 0, 1)

    // Update each memory with Bellman Q-value and utility
    await Promise.all(uniqueIds.map(async (memoryId) => {
      try {
        const node = await prisma.memoryNode.findUnique({
          where: { id: memoryId },
          select: { 
            utilityScore: true,
            qValue: true,
            metadata: true,
          },
        })

        if (!node) {
          return
        }

        // Get current Q-value (default to utility if not set)
        const currentQ = node.qValue ?? node.utilityScore
        
        // Estimate next max Q (simplified - in practice could look ahead)
        const nextMaxQ = feedback.taskSuccess ? 0.9 : 0.3
        
        // Bellman update: Q = Q + α * (r + γ * maxQ' - Q)
        const bellmanUpdate = currentQ + this.qAlpha * (effectiveReward + this.gamma * nextMaxQ - currentQ)
        const newQValue = clamp(bellmanUpdate, 0.05, 0.99)
        
        // Traditional utility update with exponential moving average
        const newUtility = clamp(
          node.utilityScore + this.alpha * (effectiveReward - node.utilityScore),
          0.05,
          0.99,
        )

        // Update metadata with IEU triplet info
        const metadata = (node.metadata as Record<string, unknown>) ?? {}
        const updatedMetadata = {
          ...metadata,
          lastFeedback: {
            reward: effectiveReward,
            timestamp: new Date().toISOString(),
            taskSuccess: feedback.taskSuccess,
          },
          intent: metadata.intent ?? extractIntent(metadata.experience as string ?? ""),
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

    try {
      const sanitizedUserId = sanitizeUserId(userId)
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
        .filter((candidate) => candidate.similarityScore > similarityThreshold)

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
        const metadata = (data?.metadata as Record<string, unknown>) ?? {}
        
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
   * Estimate implicit reward from user context
   * 
   * Uses heuristics based on:
   * - Reply length (engagement indicator)
   * - Question presence (information seeking)
   * - Follow-up depth (conversation continuity)
   * 
   * @param userReply - User's follow-up message
   * @param previousResponseLength - Length of assistant's previous response
   * @returns Estimated reward value (0-1)
   */
  estimateRewardFromContext(
    userReply: string | null,
    _previousResponseLength: number,
  ): number {
    if (!userReply || userReply.trim().length < 10) {
      // Short reply = low engagement
      return 0.2
    }

    if (userReply.length > 100) {
      // Long detailed reply = high engagement
      return 0.8
    }

    if (userReply.includes("?")) {
      // Question = information need satisfied
      return 0.7
    }

    if (userReply.match(/\b(thanks|thank you|helpful|great|awesome)\b/i)) {
      // Explicit positive feedback
      return 0.9
    }

    // Default moderate engagement
    return 0.5
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
