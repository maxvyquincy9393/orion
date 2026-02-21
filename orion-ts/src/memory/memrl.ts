import fs from "node:fs/promises"
import path from "node:path"

import * as lancedb from "@lancedb/lancedb"

import config from "../config.js"
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import type { SearchResult } from "./store.js"

const log = createLogger("memory.memrl")

interface LanceSearchRow extends Record<string, unknown> {
  id: string
  userId: string
  content: string
  metadata: string
  utilityScore?: number
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
  blendedScore: number
}

// Interface untuk feedback setelah task selesai
export interface TaskFeedback {
  memoryIds: string[]
  taskSuccess: boolean
  reward: number
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function sanitizeUserId(userId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    return userId.replace(/[^a-zA-Z0-9_-]/g, "_")
  }
  return userId
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  return null
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

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

export class MemRLUpdater {
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null

  private readonly alpha = clamp(config.MEMRL_ALPHA, 0.01, 1)
  private readonly gamma = clamp(config.MEMRL_GAMMA, 0, 1)

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

  // Panggil setelah setiap response/task selesai
  async updateFromFeedback(feedback: TaskFeedback): Promise<void> {
    if (feedback.memoryIds.length === 0) {
      return
    }

    const uniqueIds = Array.from(new Set(feedback.memoryIds.filter((id) => id.trim().length > 0)))
    if (uniqueIds.length === 0) {
      return
    }

    const clampedReward = clamp(feedback.reward, 0, 1)
    const successSignal = feedback.taskSuccess ? 1 : 0
    const effectiveReward = clamp((clampedReward * this.gamma) + (successSignal * (1 - this.gamma)), 0, 1)

    await Promise.all(uniqueIds.map(async (memoryId) => {
      try {
        const node = await prisma.memoryNode.findUnique({
          where: { id: memoryId },
          select: { utilityScore: true },
        })

        if (!node) {
          return
        }

        const nextScore = clamp(
          node.utilityScore + this.alpha * (effectiveReward - node.utilityScore),
          0.05,
          0.99,
        )

        await prisma.memoryNode.update({
          where: { id: memoryId },
          data: {
            utilityScore: nextScore,
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
      } catch (error) {
        log.debug("memrl update skipped", { memoryId, error })
      }
    }))
  }

  // Two-Phase retrieval: filter similarity dulu, rank by utility
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

      const utilityRows = await prisma.memoryNode.findMany({
        where: {
          id: {
            in: phaseOne.map((candidate) => candidate.row.id),
          },
        },
        select: {
          id: true,
          utilityScore: true,
        },
      })

      const utilityById = new Map(utilityRows.map((item) => [item.id, item.utilityScore]))

      const ranked: RankedCandidate[] = phaseOne.map((candidate) => {
        const persistedUtility = utilityById.get(candidate.row.id)
        const utilityScore = clamp(
          persistedUtility
          ?? asNumber(candidate.row.utilityScore)
          ?? 0.5,
          0.05,
          0.99,
        )

        return {
          row: candidate.row,
          similarityScore: candidate.similarityScore,
          utilityScore,
          blendedScore: (0.6 * candidate.similarityScore) + (0.4 * utilityScore),
        }
      })

      return ranked
        .sort((a, b) => b.blendedScore - a.blendedScore)
        .slice(0, limit)
        .map((candidate) => ({
          id: candidate.row.id,
          content: candidate.row.content,
          metadata: parseMetadata(candidate.row.metadata),
          score: candidate.blendedScore,
        }))
    } catch (error) {
      log.warn("memrl two-phase retrieval failed", error)
      return []
    }
  }

  // Hitung implicit reward dari conversation continuation
  estimateRewardFromContext(
    userReply: string | null,
    _previousResponseLength: number,
  ): number {
    if (!userReply || userReply.trim().length < 10) {
      return 0.2
    }

    if (userReply.length > 100) {
      return 0.8
    }

    if (userReply.includes("?")) {
      return 0.7
    }

    return 0.5
  }
}

export const memrlUpdater = new MemRLUpdater()
