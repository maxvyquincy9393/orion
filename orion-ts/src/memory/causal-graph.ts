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

export class CausalGraph {
  async extractAndUpdate(userId: string, message: string): Promise<void> {
    if (message.length < 20) {
      return
    }

    try {
      const prompt = EXTRACTION_PROMPT + message
      const response = await orchestrator.generate("fast", { prompt })

      let parsed: {
        events: Array<{ event: string; category: string }>
        causes: Array<{ cause: string; effect: string; confidence: number }>
        hyperEdges?: Array<{ nodes: string[]; relation: string; context: string; weight?: number }>
      }

      try {
        const cleaned = response.replace(/```json|```/g, "").trim()
        parsed = JSON.parse(cleaned)
      } catch {
        return
      }

      if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
        return
      }

      const nodeMap = new Map<string, string>()

      for (const event of parsed.events) {
        if (!event.event || !event.category) {
          continue
        }

        const normalizedEvent = event.event.trim()
        const existingNode = await prisma.causalNode.findFirst({
          where: { userId, event: normalizedEvent },
        })

        if (existingNode) {
          nodeMap.set(normalizedEvent, existingNode.id)
        } else {
          const node = await prisma.causalNode.create({
            data: {
              userId,
              event: normalizedEvent,
              category: event.category.toLowerCase(),
            },
          })
          nodeMap.set(normalizedEvent, node.id)
        }
      }

      if (Array.isArray(parsed.causes)) {
        for (const cause of parsed.causes) {
          if (!cause.cause || !cause.effect) {
            continue
          }

          const fromId = nodeMap.get(cause.cause.trim())
          const toId = nodeMap.get(cause.effect.trim())
          if (!fromId || !toId) {
            continue
          }

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
          } else {
            await prisma.causalEdge.create({
              data: {
                userId,
                fromId,
                toId,
                strength: clamp(Number(cause.confidence ?? 0.5)),
              },
            })
          }
        }
      }

      if (Array.isArray(parsed.hyperEdges)) {
        for (const hyperEdge of parsed.hyperEdges) {
          if (!Array.isArray(hyperEdge.nodes) || hyperEdge.nodes.length < 2) {
            continue
          }

          await this.addHyperEdge(
            userId,
            hyperEdge.nodes,
            hyperEdge.relation ?? "related_events",
            hyperEdge.context ?? message.slice(0, 160),
          )
        }
      }

      if (parsed.events.length >= 3) {
        await this.addHyperEdge(
          userId,
          parsed.events.map((event) => event.event),
          "co_occurs_in_message",
          message.slice(0, 200),
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
      const node = await prisma.causalNode.findFirst({ where: { userId, event } })
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

  async addHyperEdge(userId: string, nodes: string[], relation: string, context: string): Promise<void> {
    const normalizedNodes = Array.from(new Set(nodes.map((node) => node.trim()).filter(Boolean)))
    if (normalizedNodes.length < 2) {
      return
    }

    try {
      const resolvedNodeIds: string[] = []

      for (const nodeName of normalizedNodes) {
        const existing = await prisma.causalNode.findFirst({
          where: { userId, event: nodeName },
        })

        if (existing) {
          resolvedNodeIds.push(existing.id)
        } else {
          const created = await prisma.causalNode.create({
            data: {
              userId,
              event: nodeName,
              category: "other",
            },
          })
          resolvedNodeIds.push(created.id)
        }
      }

      const hyperEdge = await prisma.hyperEdge.create({
        data: {
          userId,
          relation: relation.slice(0, 200),
          context: context.slice(0, 500),
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
      const edges = await prisma.hyperEdge.findMany({
        where: {
          userId,
          OR: [
            { relation: { contains: query } },
            { context: { contains: query } },
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
      const complexity = detectQueryComplexity(query)
      const semanticCandidates = await temporalIndex.retrieve(userId, query, complexity)

      const seedNodes = await prisma.causalNode.findMany({
        where: {
          userId,
          OR: [
            { event: { contains: query } },
            { category: { contains: query } },
          ],
        },
        take: 12,
      })

      const nodeDistance = new Map<string, number>()
      const queue: Array<{ nodeId: string; distance: number }> = []

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
