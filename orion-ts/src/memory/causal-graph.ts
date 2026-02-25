import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { detectQueryComplexity, temporalIndex } from "./temporal-index.js"

const log = createLogger("memory.causal-graph")

const EXTRACTION_PROMPT = `Analyze this message for causal relationships and events.
Return strict JSON object with keys:
{
  "events": [{"event": "...", "category": "work|personal|health|finance|hobby|other"}],
  "causes": [{"cause": "...", "effect": "...", "confidence": 0.0-1.0}],
  "hyperEdges": [{"nodes": ["event A", "event B"], "relation": "...", "context": "...", "weight": 0.0-1.0}]
}
Return empty arrays when unsure.
Message: `

const DEFAULT_HYPEREDGE_WEIGHT = 0.5
const MAX_EVENT_LENGTH = 240
const MAX_CATEGORY_LENGTH = 48
const MAX_RELATION_LENGTH = 200
const MAX_CONTEXT_LENGTH = 500

interface ExtractedEvent {
  event: string
  category: string
}

interface ExtractedCause {
  cause: string
  effect: string
  confidence: number
}

interface ExtractedHyperEdge {
  nodes: string[]
  relation: string
  context: string
  weight: number
}

interface ExtractedCausalPayload {
  events: ExtractedEvent[]
  causes: ExtractedCause[]
  hyperEdges: ExtractedHyperEdge[]
}

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
}

function lexicalScore(query: string, candidate: string): number {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) {
    return 0
  }

  const candidateTokens = new Set(tokenize(candidate))
  let hits = 0
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      hits += 1
    }
  }

  return hits / queryTokens.size
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return ""
  }
  return value.trim().slice(0, maxLength)
}

function normalizeCategory(value: unknown): string {
  const category = normalizeText(value, MAX_CATEGORY_LENGTH).toLowerCase()
  return category || "other"
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{")
  if (start < 0) {
    return null
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === "\"") {
        inString = false
      }
      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }

    if (char === "{") {
      depth += 1
      continue
    }

    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return raw.slice(start, i + 1)
      }
    }
  }

  return null
}

function parseExtractionPayload(response: string): ExtractedCausalPayload | null {
  const cleaned = response.replace(/```json|```/gi, "").trim()
  const candidateJson = cleaned.startsWith("{") ? cleaned : (extractFirstJsonObject(cleaned) ?? cleaned)

  try {
    const parsed = JSON.parse(candidateJson) as unknown
    if (!isRecord(parsed)) {
      return null
    }

    const events: ExtractedEvent[] = []
    const seenEvents = new Set<string>()
    for (const rawEvent of Array.isArray(parsed.events) ? parsed.events : []) {
      if (!isRecord(rawEvent)) {
        continue
      }
      const event = normalizeText(rawEvent.event, MAX_EVENT_LENGTH)
      if (!event) {
        continue
      }
      const dedupeKey = event.toLowerCase()
      if (seenEvents.has(dedupeKey)) {
        continue
      }
      seenEvents.add(dedupeKey)
      events.push({
        event,
        category: normalizeCategory(rawEvent.category),
      })
    }

    const causes: ExtractedCause[] = []
    const seenCauses = new Set<string>()
    for (const rawCause of Array.isArray(parsed.causes) ? parsed.causes : []) {
      if (!isRecord(rawCause)) {
        continue
      }
      const cause = normalizeText(rawCause.cause, MAX_EVENT_LENGTH)
      const effect = normalizeText(rawCause.effect, MAX_EVENT_LENGTH)
      if (!cause || !effect || cause === effect) {
        continue
      }
      const key = `${cause.toLowerCase()}::${effect.toLowerCase()}`
      if (seenCauses.has(key)) {
        continue
      }
      seenCauses.add(key)
      causes.push({
        cause,
        effect,
        confidence: clamp(toFiniteNumber(rawCause.confidence) ?? DEFAULT_HYPEREDGE_WEIGHT),
      })
    }

    const hyperEdges: ExtractedHyperEdge[] = []
    const seenHyperEdges = new Set<string>()
    for (const rawHyperEdge of Array.isArray(parsed.hyperEdges) ? parsed.hyperEdges : []) {
      if (!isRecord(rawHyperEdge)) {
        continue
      }

      const normalizedNodes = Array.from(
        new Set(
          (Array.isArray(rawHyperEdge.nodes) ? rawHyperEdge.nodes : [])
            .map((node) => normalizeText(node, MAX_EVENT_LENGTH))
            .filter(Boolean),
        ),
      )

      if (normalizedNodes.length < 2) {
        continue
      }

      const relation = normalizeText(rawHyperEdge.relation, MAX_RELATION_LENGTH) || "related_events"
      const context = normalizeText(rawHyperEdge.context, MAX_CONTEXT_LENGTH)
      const dedupeKey = `${relation.toLowerCase()}::${[...normalizedNodes].sort((a, b) => a.localeCompare(b)).join("||")}`
      if (seenHyperEdges.has(dedupeKey)) {
        continue
      }
      seenHyperEdges.add(dedupeKey)
      hyperEdges.push({
        nodes: normalizedNodes,
        relation,
        context,
        weight: clamp(toFiniteNumber(rawHyperEdge.weight) ?? DEFAULT_HYPEREDGE_WEIGHT),
      })
    }

    return { events, causes, hyperEdges }
  } catch {
    return null
  }
}

function buildHyperEdgeKey(nodes: string[], relation: string): string {
  return `${relation.toLowerCase()}::${[...nodes].sort((a, b) => a.localeCompare(b)).join("||")}`
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const leftSorted = [...left].sort((a, b) => a.localeCompare(b))
  const rightSorted = [...right].sort((a, b) => a.localeCompare(b))
  return leftSorted.every((value, index) => value === rightSorted[index])
}

function normalizeQueryText(query: string): string {
  return query.trim().slice(0, 500)
}

export class CausalGraph {
  private async resolveNodeIds(
    userId: string,
    nodeNames: string[],
    categoryHints = new Map<string, string>(),
  ): Promise<Map<string, string>> {
    const normalizedNames = Array.from(
      new Set(nodeNames.map((name) => normalizeText(name, MAX_EVENT_LENGTH)).filter(Boolean)),
    )
    if (normalizedNames.length === 0) {
      return new Map()
    }

    const resolved = new Map<string, string>()
    const existingNodes = await prisma.causalNode.findMany({
      where: {
        userId,
        event: {
          in: normalizedNames,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    })

    for (const node of existingNodes) {
      if (!resolved.has(node.event)) {
        resolved.set(node.event, node.id)
      }
    }

    for (const nodeName of normalizedNames) {
      if (resolved.has(nodeName)) {
        continue
      }

      const created = await prisma.causalNode.create({
        data: {
          userId,
          event: nodeName,
          category: normalizeCategory(categoryHints.get(nodeName)),
        },
      })
      resolved.set(nodeName, created.id)
    }

    return resolved
  }

  private async upsertCausalEdge(
    userId: string,
    fromId: string,
    toId: string,
    confidence: number,
  ): Promise<void> {
    const existingEdge = await prisma.causalEdge.findUnique({
      where: { fromId_toId: { fromId, toId } },
    })

    if (existingEdge) {
      await prisma.causalEdge.update({
        where: { id: existingEdge.id },
        data: {
          strength: clamp(existingEdge.strength + 0.1),
          evidence: existingEdge.evidence + 1,
        },
      })
      return
    }

    await prisma.causalEdge.create({
      data: {
        userId,
        fromId,
        toId,
        strength: clamp(confidence),
      },
    })
  }

  async extractAndUpdate(userId: string, message: string): Promise<void> {
    if (message.length < 20) {
      return
    }

    try {
      const prompt = EXTRACTION_PROMPT + message
      const response = await orchestrator.generate("fast", { prompt })

      const parsed = parseExtractionPayload(response)
      if (!parsed) {
        return
      }

      if (parsed.events.length === 0 && parsed.causes.length === 0 && parsed.hyperEdges.length === 0) {
        return
      }

      const categoryHints = new Map(parsed.events.map((event) => [event.event, event.category]))
      const allNodeNames = new Set<string>()
      for (const event of parsed.events) {
        allNodeNames.add(event.event)
      }
      for (const cause of parsed.causes) {
        allNodeNames.add(cause.cause)
        allNodeNames.add(cause.effect)
      }
      for (const hyperEdge of parsed.hyperEdges) {
        for (const node of hyperEdge.nodes) {
          allNodeNames.add(node)
        }
      }

      const nodeMap = await this.resolveNodeIds(userId, Array.from(allNodeNames), categoryHints)

      for (const cause of parsed.causes) {
        const fromId = nodeMap.get(cause.cause)
        const toId = nodeMap.get(cause.effect)
        if (!fromId || !toId) {
          continue
        }
        await this.upsertCausalEdge(userId, fromId, toId, cause.confidence)
      }

      const hyperEdgesToPersist = new Map<string, ExtractedHyperEdge>()
      for (const hyperEdge of parsed.hyperEdges) {
        const key = buildHyperEdgeKey(hyperEdge.nodes, hyperEdge.relation)
        const existing = hyperEdgesToPersist.get(key)
        if (!existing || hyperEdge.weight > existing.weight) {
          hyperEdgesToPersist.set(key, {
            ...hyperEdge,
            context: hyperEdge.context || message.slice(0, 160),
          })
        }
      }

      if (parsed.events.length >= 3) {
        const nodes = parsed.events.map((event) => event.event)
        hyperEdgesToPersist.set(buildHyperEdgeKey(nodes, "co_occurs_in_message"), {
          nodes,
          relation: "co_occurs_in_message",
          context: message.slice(0, 200),
          weight: DEFAULT_HYPEREDGE_WEIGHT,
        })
      }

      for (const hyperEdge of hyperEdgesToPersist.values()) {
        await this.addHyperEdge(
          userId,
          hyperEdge.nodes,
          hyperEdge.relation,
          hyperEdge.context,
          hyperEdge.weight,
        )
      }

      log.debug("causal graph updated", {
        userId,
        events: parsed.events.length,
        causes: Array.isArray(parsed.causes) ? parsed.causes.length : 0,
      })
    } catch (error) {
      log.error("extractAndUpdate failed", error)
    }
  }

  async getDownstreamEffects(
    userId: string,
    event: string,
  ): Promise<Array<{ effect: string; strength: number; evidence: number }>> {
    try {
      const normalizedEvent = normalizeText(event, MAX_EVENT_LENGTH)
      if (!normalizedEvent) {
        return []
      }

      const node = await prisma.causalNode.findFirst({ where: { userId, event: normalizedEvent } })
      if (!node) {
        return []
      }

      const edges = await prisma.causalEdge.findMany({
        where: { userId, fromId: node.id },
        include: { to: true },
      })

      return edges.map((edge) => ({
        effect: edge.to.event,
        strength: edge.strength,
        evidence: edge.evidence,
      }))
    } catch (error) {
      log.error("getDownstreamEffects failed", error)
      return []
    }
  }

  async addHyperEdge(
    userId: string,
    nodes: string[],
    relation: string,
    context: string,
    weight = DEFAULT_HYPEREDGE_WEIGHT,
  ): Promise<void> {
    const normalizedNodes = Array.from(
      new Set(nodes.map((node) => normalizeText(node, MAX_EVENT_LENGTH)).filter(Boolean)),
    )
    if (normalizedNodes.length < 2) {
      return
    }

    try {
      const nodeMap = await this.resolveNodeIds(userId, normalizedNodes)
      const resolvedNodeIds = normalizedNodes
        .map((nodeName) => nodeMap.get(nodeName))
        .filter((nodeId): nodeId is string => typeof nodeId === "string")

      if (resolvedNodeIds.length < 2) {
        return
      }

      const normalizedRelation = normalizeText(relation, MAX_RELATION_LENGTH) || "related_events"
      const normalizedContext = normalizeText(context, MAX_CONTEXT_LENGTH)
      const normalizedWeight = clamp(weight)

      // Best-effort runtime dedupe: schema has no unique constraint for hyperedge member sets yet.
      const existingCandidates = await prisma.hyperEdge.findMany({
        where: {
          userId,
          relation: normalizedRelation,
          members: {
            some: {
              nodeId: { in: resolvedNodeIds },
            },
          },
        },
        include: {
          members: {
            select: { nodeId: true },
          },
        },
        take: 20,
      })

      const matchingEdge = existingCandidates.find((edge) => {
        const memberIds = edge.members.map((member) => member.nodeId)
        return sameStringSet(memberIds, resolvedNodeIds)
      })

      if (matchingEdge) {
        await prisma.hyperEdge.update({
          where: { id: matchingEdge.id },
          data: {
            weight: Math.max(matchingEdge.weight, normalizedWeight),
            ...(normalizedContext ? { context: normalizedContext } : {}),
          },
        })
        return
      }

      const hyperEdge = await prisma.hyperEdge.create({
        data: {
          userId,
          relation: normalizedRelation,
          context: normalizedContext,
          weight: normalizedWeight,
        },
      })

      await prisma.hyperEdgeMembership.createMany({
        data: resolvedNodeIds.map((nodeId) => ({
          hyperEdgeId: hyperEdge.id,
          nodeId,
        })),
      })
    } catch (error) {
      log.error("addHyperEdge failed", { userId, relation, error })
    }
  }

  async queryHyperEdges(userId: string, query: string): Promise<Array<{
    relation: string
    nodes: string[]
    context: string
    weight: number
  }>> {
    try {
      const normalizedQuery = normalizeQueryText(query)
      if (!normalizedQuery) {
        return []
      }

      const edges = await prisma.hyperEdge.findMany({
        where: {
          userId,
          OR: [
            { relation: { contains: normalizedQuery } },
            { context: { contains: normalizedQuery } },
          ],
        },
        include: {
          members: {
            include: {
              node: true,
            },
          },
        },
        take: 10,
        orderBy: {
          weight: "desc",
        },
      })

      return edges.map((edge) => ({
        relation: edge.relation,
        nodes: edge.members.map((member) => member.node.event),
        context: edge.context,
        weight: edge.weight,
      }))
    } catch (error) {
      log.error("queryHyperEdges failed", { userId, error })
      return []
    }
  }

  async hybridRetrieve(userId: string, query: string): Promise<Array<{
    content: string
    type: "node" | "edge" | "hyperedge"
    relevance: number
  }>> {
    try {
      const normalizedQuery = normalizeQueryText(query)
      const complexity = detectQueryComplexity(normalizedQuery)
      const semanticCandidates = await temporalIndex.retrieve(userId, normalizedQuery, complexity)

      const seedNodes = normalizedQuery
        ? await prisma.causalNode.findMany({
          where: {
            userId,
            OR: [
              { event: { contains: normalizedQuery } },
              { category: { contains: normalizedQuery } },
            ],
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 12,
        })
        : []

      const nodeDistance = new Map<string, number>()
      const queue: Array<{ nodeId: string; distance: number }> = []
      const seenGraphEdges = new Set<string>()

      for (const node of seedNodes) {
        nodeDistance.set(node.id, 0)
        queue.push({ nodeId: node.id, distance: 0 })
      }

      const collectedEdges: Array<{ fromEvent: string; toEvent: string; strength: number; distance: number }> = []

      while (queue.length > 0) {
        const current = queue.shift()
        if (!current || current.distance >= 2) {
          continue
        }

        const edges = await prisma.causalEdge.findMany({
          where: {
            userId,
            OR: [
              { fromId: current.nodeId },
              { toId: current.nodeId },
            ],
          },
          include: {
            from: true,
            to: true,
          },
          take: 20,
        })

        for (const edge of edges) {
          if (seenGraphEdges.has(edge.id)) {
            continue
          }
          seenGraphEdges.add(edge.id)

          collectedEdges.push({
            fromEvent: edge.from.event,
            toEvent: edge.to.event,
            strength: edge.strength,
            distance: current.distance + 1,
          })

          for (const neighbor of [edge.fromId, edge.toId]) {
            if (!nodeDistance.has(neighbor) || (nodeDistance.get(neighbor) ?? 99) > current.distance + 1) {
              nodeDistance.set(neighbor, current.distance + 1)
              queue.push({ nodeId: neighbor, distance: current.distance + 1 })
            }
          }
        }
      }

      const graphNodeIds = Array.from(nodeDistance.keys())
      const graphNodes = graphNodeIds.length
        ? await prisma.causalNode.findMany({
          where: {
            id: { in: graphNodeIds },
          },
        })
        : []

      const relatedHyperEdges = graphNodeIds.length
        ? await prisma.hyperEdge.findMany({
          where: {
            userId,
            members: {
              some: {
                nodeId: { in: graphNodeIds },
              },
            },
          },
          include: {
            members: {
              include: {
                node: true,
              },
            },
          },
          take: 10,
        })
        : []

      const merged: Array<{ content: string; type: "node" | "edge" | "hyperedge"; relevance: number }> = []

      for (const semantic of semanticCandidates.slice(0, 8)) {
        merged.push({
          content: semantic.content,
          type: "node",
          relevance: clamp(lexicalScore(query, semantic.content) * 0.6 + 0.2),
        })
      }

      for (const node of graphNodes) {
        const distance = nodeDistance.get(node.id) ?? 2
        const graphScore = distance === 0 ? 1 : distance === 1 ? 0.7 : 0.4
        const semanticScore = lexicalScore(query, `${node.event} ${node.category}`)

        merged.push({
          content: `${node.event} (${node.category})`,
          type: "node",
          relevance: clamp(semanticScore * 0.6 + graphScore * 0.4),
        })
      }

      for (const edge of collectedEdges.slice(0, 20)) {
        const graphScore = edge.distance === 1 ? 0.7 : 0.4
        const semanticScore = lexicalScore(query, `${edge.fromEvent} ${edge.toEvent}`)

        merged.push({
          content: `${edge.fromEvent} -> ${edge.toEvent} (${Math.round(edge.strength * 100)}%)`,
          type: "edge",
          relevance: clamp(semanticScore * 0.6 + graphScore * 0.4),
        })
      }

      for (const edge of relatedHyperEdges) {
        const nodeText = edge.members.map((member) => member.node.event).join(", ")
        const semanticScore = lexicalScore(query, `${edge.relation} ${edge.context} ${nodeText}`)

        merged.push({
          content: `${edge.relation}: [${nodeText}] (${edge.context})`,
          type: "hyperedge",
          relevance: clamp(semanticScore * 0.6 + edge.weight * 0.4),
        })
      }

      const deduped = new Map<string, { content: string; type: "node" | "edge" | "hyperedge"; relevance: number }>()
      for (const item of merged) {
        const key = `${item.type}:${item.content}`
        const existing = deduped.get(key)
        if (!existing || item.relevance > existing.relevance) {
          deduped.set(key, item)
        }
      }

      return Array.from(deduped.values())
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 15)
    } catch (error) {
      log.error("hybridRetrieve failed", { userId, error })
      return []
    }
  }

  async generateInsight(userId: string): Promise<string | null> {
    try {
      const nodes = await prisma.causalNode.findMany({
        where: { userId },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          effectEdges: {
            include: { to: true },
            orderBy: { strength: "desc" },
            take: 3,
          },
        },
        take: 12,
      })

      const hyperEdges = await prisma.hyperEdge.findMany({
        where: { userId },
        include: {
          members: {
            include: {
              node: true,
            },
          },
        },
        take: 5,
        orderBy: {
          weight: "desc",
        },
      })

      const lines: string[] = []

      for (const node of nodes) {
        for (const edge of node.effectEdges) {
          if (edge.strength > 0.7) {
            lines.push(`"${node.event}" often leads to "${edge.to.event}" (${Math.round(edge.strength * 100)}%)`)
          }
        }
      }

      for (const hyperEdge of hyperEdges) {
        const nodeLabels = hyperEdge.members.map((member) => member.node.event).join(", ")
        lines.push(`${hyperEdge.relation}: [${nodeLabels}]`)
      }

      if (lines.length === 0) {
        return null
      }

      return `Observed patterns:\n${lines.slice(0, 8).join("\n")}`
    } catch (error) {
      log.error("generateInsight failed", error)
      return null
    }
  }

  async formatForContext(userId: string): Promise<string> {
    try {
      const insight = await this.generateInsight(userId)
      if (!insight) {
        return ""
      }
      return `[User Patterns]\n${insight}`
    } catch (error) {
      log.error("formatForContext failed", error)
      return ""
    }
  }
}

export const causalGraph = new CausalGraph()

export const __causalGraphTestUtils = {
  parseExtractionPayload,
  extractFirstJsonObject,
  buildHyperEdgeKey,
  sameStringSet,
  normalizeQueryText,
}
