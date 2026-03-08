/**
 * @file knowledge-graph.ts
 * @description HippoRAG-inspired knowledge graph: entity extraction + BFS traversal.
 *
 * PAPER BASIS:
 *   - HippoRAG (arXiv:2405.14831): entity graph + PPR traversal
 *     (we use BFS instead of PPR — simpler, sufficient for personal KB)
 *   - HybridRAG (arXiv:2408.04948): parallel vector + graph retrieval
 *
 * @module memory/knowledge/knowledge-graph
 */

import { prisma } from "../../database/index.js"
import { orchestrator } from "../../engines/orchestrator.js"
import { createLogger } from "../../logger.js"

const log = createLogger("memory.knowledge.knowledge-graph")

/** Entity types recognized during extraction. */
type EntityType = "person" | "concept" | "tool" | "place" | "organization"

/** Raw entity as returned by the LLM extraction prompt. */
interface ExtractedEntity {
  name: string
  type: EntityType
}

/** Raw edge as returned by the LLM extraction prompt. */
interface ExtractedEdge {
  from: string
  to: string
  relation: string
}

/** LLM response shape for entity extraction. */
interface EntityExtractionResponse {
  entities: ExtractedEntity[]
  edges: ExtractedEdge[]
}

/** Maximum BFS hops for graph traversal. */
const DEFAULT_BFS_HOPS = 2

/**
 * Knowledge graph manager.
 * Extracts entities and relations from document chunks, stores them in Prisma,
 * and provides BFS-based multi-hop graph retrieval.
 */
export class KnowledgeGraph {
  /**
   * Extract entities and relations from a chunk and persist them in the knowledge graph.
   * This is fire-and-forget safe — it never throws.
   *
   * @param userId  - User identifier
   * @param content - Chunk text to extract from
   * @param chunkId - DocumentChunk ID (used as sourceChunkId on edges)
   */
  async extractFromChunk(userId: string, content: string, chunkId: string): Promise<void> {
    try {
      const prompt = `Extract entities and relationships from the following text.
Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{"entities":[{"name":"...","type":"person|concept|tool|place|organization"}],"edges":[{"from":"...","to":"...","relation":"uses|mentions|created_by|part_of|related_to"}]}

Text: ${content.slice(0, 1500)}`

      const raw = await orchestrator.generate("fast", { prompt })
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        log.warn("entity extraction: no JSON found in response", { chunkId })
        return
      }

      const parsed = JSON.parse(jsonMatch[0]) as EntityExtractionResponse
      const entities = parsed.entities ?? []
      const edges = parsed.edges ?? []

      // Upsert entities and accumulate their DB IDs
      const entityIdMap = new Map<string, string>()

      for (const entity of entities) {
        if (!entity.name?.trim() || !entity.type) continue

        const existing = await prisma.knowledgeEntity.findUnique({
          where: { userId_name: { userId, name: entity.name } },
        })

        if (existing) {
          const existingChunkIds = (existing.chunkIds as string[]) ?? []
          if (!existingChunkIds.includes(chunkId)) {
            await prisma.knowledgeEntity.update({
              where: { id: existing.id },
              data: { chunkIds: [...existingChunkIds, chunkId] },
            })
          }
          entityIdMap.set(entity.name, existing.id)
        } else {
          const created = await prisma.knowledgeEntity.create({
            data: {
              userId,
              name: entity.name,
              type: entity.type,
              chunkIds: [chunkId],
            },
          })
          entityIdMap.set(entity.name, created.id)
        }
      }

      // Upsert edges
      for (const edge of edges) {
        const fromId = entityIdMap.get(edge.from)
        const toId = entityIdMap.get(edge.to)
        if (!fromId || !toId || !edge.relation) continue

        await prisma.knowledgeEdge.upsert({
          where: { fromId_toId_relation: { fromId, toId, relation: edge.relation } },
          create: { userId, fromId, toId, relation: edge.relation, weight: 0.5, sourceChunkId: chunkId },
          update: { weight: { increment: 0.05 } },
        })
      }

      log.debug("entity extraction complete", { chunkId, entities: entities.length, edges: edges.length })
    } catch (err) {
      log.warn("entity extraction failed (non-fatal)", { chunkId, err })
    }
  }

  /**
   * Retrieve DocumentChunk IDs via knowledge graph BFS traversal.
   * Finds entities matching the query, then traverses edges up to `hops` steps.
   *
   * @param userId - User identifier
   * @param query  - Natural language query
   * @param hops   - Maximum BFS hops (default 2)
   * @returns Array of DocumentChunk IDs (may contain duplicates)
   */
  async graphRetrieval(userId: string, query: string, hops = DEFAULT_BFS_HOPS): Promise<string[]> {
    try {
      const seedEntityNames = await this.extractQueryEntities(query)
      if (seedEntityNames.length === 0) {
        return []
      }

      // Find seed entity IDs from DB
      const seedEntities = await prisma.knowledgeEntity.findMany({
        where: {
          userId,
          name: { in: seedEntityNames },
        },
        select: { id: true },
      })

      if (seedEntities.length === 0) {
        return []
      }

      const seedIds = seedEntities.map((e) => e.id)
      return this.bfsTraverse(userId, seedIds, hops)
    } catch (err) {
      log.warn("graphRetrieval failed", { userId, err })
      return []
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Use the LLM to extract entity names from a short query string.
   *
   * @param query - User query text
   * @returns Array of entity name strings
   */
  private async extractQueryEntities(query: string): Promise<string[]> {
    try {
      const prompt = `Extract entity names from this query. Return ONLY a JSON array of strings.
Query: ${query.slice(0, 300)}
Example output: ["TypeScript","React","Dan Abramov"]`

      const raw = await orchestrator.generate("fast", { prompt })
      const match = raw.match(/\[[\s\S]*?\]/)
      if (!match) return []
      return JSON.parse(match[0]) as string[]
    } catch {
      return []
    }
  }

  /**
   * BFS traversal from seed entity IDs.
   * Returns all DocumentChunk IDs found in traversed entities.
   *
   * @param userId       - User identifier
   * @param seedEntityIds - Entity IDs to start from
   * @param hops         - Maximum number of hops
   * @returns Deduplicated DocumentChunk IDs
   */
  private async bfsTraverse(
    userId: string,
    seedEntityIds: string[],
    hops: number,
  ): Promise<string[]> {
    const visited = new Set<string>(seedEntityIds)
    let frontier = [...seedEntityIds]
    const chunkIds = new Set<string>()

    // Collect chunk IDs from seed entities
    const seedData = await prisma.knowledgeEntity.findMany({
      where: { id: { in: seedEntityIds } },
      select: { chunkIds: true },
    })
    for (const e of seedData) {
      for (const cid of (e.chunkIds as string[]) ?? []) {
        chunkIds.add(cid)
      }
    }

    for (let hop = 0; hop < hops; hop++) {
      if (frontier.length === 0) break

      const edges = await prisma.knowledgeEdge.findMany({
        where: {
          userId,
          OR: [
            { fromId: { in: frontier } },
            { toId: { in: frontier } },
          ],
        },
        select: { fromId: true, toId: true },
      })

      const nextIds: string[] = []
      for (const edge of edges) {
        for (const id of [edge.fromId, edge.toId]) {
          if (!visited.has(id)) {
            visited.add(id)
            nextIds.push(id)
          }
        }
      }

      if (nextIds.length === 0) break

      const nextEntities = await prisma.knowledgeEntity.findMany({
        where: { id: { in: nextIds } },
        select: { chunkIds: true },
      })
      for (const e of nextEntities) {
        for (const cid of (e.chunkIds as string[]) ?? []) {
          chunkIds.add(cid)
        }
      }

      frontier = nextIds
    }

    return Array.from(chunkIds)
  }
}

/** Singleton KnowledgeGraph instance. */
export const knowledgeGraph = new KnowledgeGraph()
