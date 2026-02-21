import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.temporal-index")

const RAW_BATCH_SIZE = 50
const SIMPLE_WORD_LIMIT = 8
const COMPLEX_QUERY_PATTERN = /\b(why|how|explain|history)\b/i
const DAY_MS = 24 * 60 * 60 * 1000

export type MemoryLevel = 0 | 1 | 2
export type QueryComplexity = "simple" | "complex"

export interface TemporalMemoryNode {
  id: string
  userId: string
  content: string
  level: MemoryLevel
  validFrom: Date
  validUntil: Date | null
  category: string
}

function mapNode(node: {
  id: string
  userId: string
  content: string
  level: number
  validFrom: Date
  validUntil: Date | null
  category: string
}): TemporalMemoryNode {
  return {
    id: node.id,
    userId: node.userId,
    content: node.content,
    level: Math.max(0, Math.min(2, node.level)) as MemoryLevel,
    validFrom: node.validFrom,
    validUntil: node.validUntil,
    category: node.category,
  }
}

export function detectQueryComplexity(query: string): QueryComplexity {
  const trimmed = query.trim()
  if (!trimmed) {
    return "simple"
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  if (wordCount > SIMPLE_WORD_LIMIT) {
    return "complex"
  }

  if (COMPLEX_QUERY_PATTERN.test(trimmed.toLowerCase())) {
    return "complex"
  }

  return "simple"
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .slice(0, 6)
}

export class TemporalIndex {
  async store(
    userId: string,
    content: string,
    level: MemoryLevel,
    category: string,
  ): Promise<TemporalMemoryNode> {
    const cleanCategory = category.trim() || "fact"

    const created = await prisma.memoryNode.create({
      data: {
        userId,
        content,
        level,
        category: cleanCategory,
      },
    })

    if (level === 0) {
      void this.maybeTriggerConsolidation(userId)
    }

    return mapNode(created)
  }

  private async maybeTriggerConsolidation(userId: string): Promise<void> {
    try {
      const totalRaw = await prisma.memoryNode.count({
        where: {
          userId,
          level: 0,
          validUntil: null,
        },
      })

      if (totalRaw >= RAW_BATCH_SIZE && totalRaw % RAW_BATCH_SIZE === 0) {
        await this.consolidate(userId)
      }
    } catch (error) {
      log.warn("Failed to trigger consolidation", { userId, error })
    }
  }

  async expire(nodeId: string): Promise<void> {
    await prisma.memoryNode.updateMany({
      where: {
        id: nodeId,
        validUntil: null,
      },
      data: {
        validUntil: new Date(),
      },
    })
  }

  async retrieve(
    userId: string,
    query: string,
    complexity: QueryComplexity,
  ): Promise<TemporalMemoryNode[]> {
    const tokens = tokenizeQuery(query)
    const levelFilter = complexity === "simple" ? { in: [1, 2] } : undefined

    const whereBase: {
      userId: string
      validUntil: null
      level?: { in: number[] }
    } = {
      userId,
      validUntil: null,
      ...(levelFilter ? { level: levelFilter } : {}),
    }

    if (tokens.length === 0) {
      const recent = await prisma.memoryNode.findMany({
        where: whereBase,
        orderBy: {
          validFrom: "desc",
        },
        take: 20,
      })
      return recent.map(mapNode)
    }

    const queryMatches = await prisma.memoryNode.findMany({
      where: {
        ...whereBase,
        OR: [
          { content: { contains: query } },
          { category: { contains: query } },
          ...tokens.map((token) => ({ content: { contains: token } })),
        ],
      },
      orderBy: {
        validFrom: "desc",
      },
      take: 30,
    })

    const unique = new Map<string, TemporalMemoryNode>()
    for (const node of queryMatches) {
      unique.set(node.id, mapNode(node))
    }

    return Array.from(unique.values())
  }

  async consolidate(userId: string): Promise<void> {
    const rawNodes = await prisma.memoryNode.findMany({
      where: {
        userId,
        level: 0,
        validUntil: null,
      },
      orderBy: {
        validFrom: "asc",
      },
      take: RAW_BATCH_SIZE,
    })

    if (rawNodes.length < RAW_BATCH_SIZE) {
      return
    }

    const summary = await this.buildSummary(rawNodes.map((node) => node.content))
    const now = new Date()

    await prisma.$transaction([
      prisma.memoryNode.create({
        data: {
          userId,
          content: summary,
          level: 1,
          category: "summary",
          validFrom: now,
        },
      }),
      prisma.memoryNode.updateMany({
        where: {
          id: { in: rawNodes.map((node) => node.id) },
        },
        data: {
          validUntil: now,
        },
      }),
    ])

    log.info("Temporal consolidation completed", {
      userId,
      rawNodes: rawNodes.length,
    })
  }

  private async buildSummary(items: string[]): Promise<string> {
    const clippedItems = items.slice(0, RAW_BATCH_SIZE).map((item) => item.slice(0, 240))
    const joined = clippedItems.map((item, index) => `${index + 1}. ${item}`).join("\n")

    try {
      const prompt = [
        "Summarize these user observations into concise long-term memory bullets.",
        "Focus on stable preferences, recurring tasks, habits, and important facts.",
        "Return plain text, max 8 bullets.",
        "Observations:",
        joined,
      ].join("\n\n")

      const generated = await orchestrator.generate("fast", { prompt })
      const summary = generated.trim()
      if (summary.length > 0) {
        return summary.slice(0, 2000)
      }
    } catch (error) {
      log.warn("Temporal summary generation failed, using fallback", error)
    }

    return `Summary:\n${clippedItems.slice(0, 8).map((line) => `- ${line}`).join("\n")}`
  }

  async runMaintenance(userId: string): Promise<void> {
    const now = new Date()
    const rawThreshold = new Date(Date.now() - 30 * DAY_MS)
    const summaryThreshold = new Date(Date.now() - 180 * DAY_MS)

    try {
      await prisma.$transaction([
        prisma.memoryNode.updateMany({
          where: {
            userId,
            level: 0,
            validUntil: null,
            validFrom: { lt: rawThreshold },
          },
          data: {
            validUntil: now,
          },
        }),
        prisma.memoryNode.updateMany({
          where: {
            userId,
            level: 1,
            validUntil: null,
            validFrom: { lt: summaryThreshold },
          },
          data: {
            validUntil: now,
          },
        }),
      ])

      await this.consolidate(userId)
    } catch (error) {
      log.error("Temporal maintenance failed", { userId, error })
    }
  }
}

export const temporalIndex = new TemporalIndex()
