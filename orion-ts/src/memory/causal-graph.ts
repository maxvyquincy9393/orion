import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.causal-graph")

const EXTRACTION_PROMPT = `Analyze this message for causal relationships and events. Return JSON with events and their potential causes.

Format:
{
  "events": [
    {"event": "event description", "category": "work|personal|health|finance|hobby|other"}
  ],
  "causes": [
    {"cause": "cause event", "effect": "effect event", "confidence": 0.0-1.0}
  ]
}

Message: `

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
      }

      try {
        const cleaned = response.replace(/```json|```/g, "").trim()
        parsed = JSON.parse(cleaned)
      } catch {
        return
      }

      if (!parsed.events || !Array.isArray(parsed.events)) {
        return
      }

      const nodeMap = new Map<string, string>()

      for (const event of parsed.events) {
        if (!event.event || !event.category) {
          continue
        }

        const existingNode = await prisma.causalNode.findFirst({
          where: { userId, event: event.event },
        })

        if (existingNode) {
          nodeMap.set(event.event, existingNode.id)
        } else {
          const node = await prisma.causalNode.create({
            data: {
              userId,
              event: event.event,
              category: event.category.toLowerCase(),
            },
          })
          nodeMap.set(event.event, node.id)
        }
      }

      if (parsed.causes && Array.isArray(parsed.causes)) {
        for (const cause of parsed.causes) {
          if (!cause.cause || !cause.effect || !cause.confidence) {
            continue
          }

          const fromId = nodeMap.get(cause.cause)
          const toId = nodeMap.get(cause.effect)

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
                strength: Math.min(1, existingEdge.strength + 0.1),
                evidence: existingEdge.evidence + 1,
              },
            })
          } else {
            await prisma.causalEdge.create({
              data: {
                userId,
                fromId,
                toId,
                strength: cause.confidence,
              },
            })
          }
        }
      }

      log.debug("causal graph updated", { userId, events: parsed.events.length })
    } catch (error) {
      log.error("extractAndUpdate failed", error)
    }
  }

  async getDownstreamEffects(
    userId: string,
    event: string
  ): Promise<Array<{ effect: string; strength: number; evidence: number }>> {
    try {
      const node = await prisma.causalNode.findFirst({
        where: { userId, event },
      })

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
        take: 10,
      })

      if (nodes.length === 0) {
        return null
      }

      const strongRelationships: string[] = []
      for (const node of nodes) {
        for (const edge of node.effectEdges) {
          if (edge.strength > 0.7) {
            strongRelationships.push(
              `"${node.event}" often leads to "${edge.to.event}" (${Math.round(edge.strength * 100)}% confidence)`
            )
          }
        }
      }

      if (strongRelationships.length === 0) {
        return null
      }

      return `Observed patterns:\n${strongRelationships.slice(0, 5).join("\n")}`
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
