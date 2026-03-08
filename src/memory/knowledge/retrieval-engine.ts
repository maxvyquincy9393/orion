/**
 * @file retrieval-engine.ts
 * @description Hybrid knowledge retrieval: vector + knowledge graph + citations.
 *
 * PAPER BASIS:
 *   - HybridRAG (arXiv:2408.04948): parallel VectorRAG + GraphRAG merged reranking
 *   - HippoRAG (arXiv:2405.14831): graph traversal for multi-hop queries
 *
 * @module memory/knowledge/retrieval-engine
 */

import { prisma } from "../../database/index.js"
import { memory } from "../store.js"
import { createLogger } from "../../logger.js"
import { knowledgeGraph } from "./knowledge-graph.js"
import { citationBuilder, type CitedChunk, type CitationResult } from "./citation-builder.js"

const log = createLogger("memory.knowledge.retrieval-engine")

/** Default maximum number of chunks to return. */
const DEFAULT_MAX_CHUNKS = 5

/**
 * Hybrid retrieval engine.
 * Combines vector similarity search with knowledge graph traversal,
 * then builds a citation context for LLM injection.
 */
export class RetrievalEngine {
  /**
   * Retrieve the most relevant chunks for a query using parallel
   * vector search and knowledge graph traversal.
   *
   * @param userId    - User identifier
   * @param query     - Natural language query
   * @param maxChunks - Maximum number of chunks to return (default 5)
   * @returns CitationResult with formatted prompt and source metadata
   */
  async retrieve(userId: string, query: string, maxChunks = DEFAULT_MAX_CHUNKS): Promise<CitationResult> {
    try {
      // Run vector search and graph retrieval in parallel
      const [vectorResults, graphChunkIds] = await Promise.all([
        memory.search(userId, query, maxChunks).catch((err) => {
          log.warn("vector search failed", { userId, err })
          return []
        }),
        knowledgeGraph.graphRetrieval(userId, query).catch((err) => {
          log.warn("graph retrieval failed", { userId, err })
          return []
        }),
      ])

      // Build a deduplicated set of chunk IDs from both sources
      const seenIds = new Set<string>()
      const chunkIdCandidates: Array<{ id: string; score: number }> = []

      for (const result of vectorResults) {
        const vectorId = String(result.metadata?.vectorId ?? result.metadata?.chunkId ?? "")
        if (vectorId && !seenIds.has(vectorId)) {
          seenIds.add(vectorId)
          chunkIdCandidates.push({ id: vectorId, score: result.score ?? 0.5 })
        }
      }

      for (const graphId of graphChunkIds) {
        if (!seenIds.has(graphId)) {
          seenIds.add(graphId)
          // Graph results get a base score slightly lower than vector results
          chunkIdCandidates.push({ id: graphId, score: 0.4 })
        }
      }

      if (chunkIdCandidates.length === 0) {
        // Fallback: use the raw vector results without DB chunk lookup
        const fallbackChunks: CitedChunk[] = vectorResults.slice(0, maxChunks).map((r) => ({
          content: r.content,
          sourceName: String(r.metadata?.title ?? "Unknown"),
          sourceFile: String(r.metadata?.source ?? ""),
          page: typeof r.metadata?.page === "number" ? r.metadata.page : undefined,
          section: typeof r.metadata?.section === "string" ? r.metadata.section : undefined,
          score: r.score ?? 0.5,
        }))
        return citationBuilder.build(query, fallbackChunks)
      }

      // Fetch DocumentChunk metadata from Prisma for proper citation info
      const dbChunkIds = chunkIdCandidates.map((c) => c.id).slice(0, maxChunks * 2)
      const dbChunks = await prisma.documentChunk.findMany({
        where: { id: { in: dbChunkIds }, userId },
        include: { document: { select: { title: true, source: true } } },
      })

      const scoreMap = new Map(chunkIdCandidates.map((c) => [c.id, c.score]))

      const citedChunks: CitedChunk[] = dbChunks
        .slice(0, maxChunks)
        .map((chunk) => ({
          content: chunk.content,
          sourceName: chunk.document.title,
          sourceFile: chunk.document.source,
          page: chunk.page ?? undefined,
          section: chunk.section ?? undefined,
          score: scoreMap.get(chunk.id) ?? 0.5,
        }))

      return citationBuilder.build(query, citedChunks)
    } catch (err) {
      log.error("retrieve failed", { userId, err })
      return citationBuilder.build(query, [])
    }
  }

  /**
   * Convenience method: retrieve and return a context string ready for pipeline injection.
   * Returns an empty string if no relevant chunks were found.
   *
   * @param userId - User identifier
   * @param query  - Natural language query
   * @returns Formatted context string or empty string
   */
  async retrieveContext(userId: string, query: string): Promise<string> {
    const result = await this.retrieve(userId, query)
    return result.prompt
  }
}

/** Singleton RetrievalEngine instance. */
export const retrievalEngine = new RetrievalEngine()
