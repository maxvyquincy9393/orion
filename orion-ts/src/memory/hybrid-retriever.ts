/**
 * HybridRetriever - OC-10 Implementation
 * 
 * Based on research:
 * - Hybrid Search + RAG Survey (arXiv 2506.00054)
 * 
 * Implements a hybrid retrieval system combining:
 * 1. Full-Text Search (FTS) using SQLite FTS5 for keyword matching
 * 2. Vector Search using LanceDB for semantic similarity
 * 3. Reciprocal Rank Fusion (RRF) for intelligent result combination
 * 
 * The RRF formula: score = Σ(1 / (k + rank))
 * where k = 60 (constant) and rank = position in each result list
 * 
 * @module memory/hybrid-retriever
 */

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import type { SearchResult } from "./store.js"

const log = createLogger("memory.hybrid-retriever")

/**
 * Search result with rank information for RRF computation
 */
interface RankedResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  rank: number
  source: "fts" | "vector"
  rawScore: number
}

/**
 * Configuration for hybrid retrieval
 */
interface HybridConfig {
  /** Number of results to fetch from each source (before fusion) */
  topK: number
  /** Number of final results to return */
  finalLimit: number
  /** RRF constant k (typically 60) */
  rrfK: number
  /** Weight for FTS results (0-1) */
  ftsWeight: number
  /** Weight for vector results (0-1) */
  vectorWeight: number
  /** Minimum score threshold for inclusion */
  scoreThreshold: number
}

/**
 * Default configuration for hybrid retrieval
 */
const DEFAULT_CONFIG: HybridConfig = {
  topK: 20,
  finalLimit: 10,
  rrfK: 60,
  ftsWeight: 0.4,
  vectorWeight: 0.6,
  scoreThreshold: 0.1,
}

/**
 * Sanitize user ID for safe SQL queries
 */
function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
}

/**
 * Compute RRF score for a result
 * 
 * RRF(d) = Σ(1 / (k + r(d)))
 * where:
 * - k = constant (typically 60)
 * - r(d) = rank of document d in list i
 * 
 * @param ranks - Array of ranks from different sources
 * @param k - RRF constant
 * @returns RRF score
 */
function computeRRFScore(ranks: number[], k: number): number {
  return ranks.reduce((sum, rank) => sum + (1 / (k + rank)), 0)
}

/**
 * Parse search result content from FTS
 */
function parseFTSContent(raw: unknown): string {
  if (typeof raw === "string") {
    return raw
  }
  return String(raw ?? "")
}

/**
 * Hybrid Retriever combining FTS and Vector search with RRF
 * 
 * This class implements the fusion of lexical (keyword) and semantic (vector)
 * search results using Reciprocal Rank Fusion. The approach is superior to
 * simple score averaging because:
 * 
 * 1. RRF is rank-aware, not just score-aware
 * 2. Handles different score distributions from different sources
 * 3. More robust to outliers
 * 4. No need to normalize scores between different modalities
 */
export class HybridRetriever {
  private config: HybridConfig

  constructor(config: Partial<HybridConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Perform hybrid search combining FTS and Vector results
   * 
   * Algorithm:
   * 1. Run FTS search in parallel with Vector search
   * 2. Collect top-k results from each
   * 3. Compute RRF scores for all unique documents
   * 4. Sort by RRF score and return top results
   * 
   * @param userId - User identifier
   * @param query - Search query text
   * @param queryVector - Vector embedding of the query
   * @param limit - Maximum results to return
   * @returns Fused search results sorted by RRF score
   */
  async search(
    userId: string,
    query: string,
    queryVector: number[],
    limit?: number,
  ): Promise<SearchResult[]> {
    const finalLimit = limit ?? this.config.finalLimit
    
    try {
      // Run both searches in parallel
      const [ftsResults, vectorResults] = await Promise.all([
        this.searchFTS(userId, query),
        this.searchVector(userId, queryVector),
      ])

      // Fuse results using RRF
      const fusedResults = this.fuseWithRRF(ftsResults, vectorResults)
      
      // Filter by threshold and limit
      return fusedResults
        .filter((r) => r.score >= this.config.scoreThreshold)
        .slice(0, finalLimit)
    } catch (error) {
      log.error("hybrid search failed", { userId, query: query.slice(0, 100), error })
      return []
    }
  }

  /**
   * Full-Text Search using SQLite FTS5
   * 
   * Uses Prisma's raw query to access FTS5 virtual table.
   * FTS is excellent for:
   * - Exact keyword matching
   * - Matching proper nouns and rare terms
   * - Query terms that appear in the training data
   * 
   * @param userId - User identifier
   * @param query - Search query
   * @returns Ranked FTS results
   */
  private async searchFTS(userId: string, query: string): Promise<RankedResult[]> {
    try {
      const sanitizedUserId = sanitizeUserId(userId)
      
      // Prepare FTS query: split into words and add wildcards
      const ftsQuery = query
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .map((w) => `${w}*`)
        .join(" ")
      
      if (!ftsQuery) {
        return []
      }

      // Query FTS5 virtual table with rank
      // rank is computed by FTS5's BM25 algorithm
      const results = await prisma.$queryRaw<Array<{
        id: string
        content: unknown
        rank: number
      }>>`
        SELECT m.id, m.content, rank
        FROM MemoryNode m
        JOIN MemoryNodeFTS fts ON m.id = fts.rowid
        WHERE m.userId = ${sanitizedUserId}
          AND MemoryNodeFTS MATCH ${ftsQuery}
        ORDER BY rank ASC
        LIMIT ${this.config.topK}
      `

      return results.map((row, index) => ({
        id: row.id,
        content: parseFTSContent(row.content),
        metadata: { ftsRank: row.rank },
        rank: index + 1, // 1-based rank for RRF
        source: "fts",
        rawScore: 1 / (1 + row.rank), // Convert rank to approximate score
      }))
    } catch (error) {
      log.warn("FTS search failed, falling back to empty", { error })
      // FTS table might not exist yet, return empty
      return []
    }
  }

  /**
   * Vector Search using LanceDB
   * 
   * Uses the existing LanceDB table for semantic similarity.
   * Vector search excels at:
   * - Semantic understanding (synonyms, paraphrases)
   * - Capturing conceptual similarity
   * - Handling misspellings and variations
   * 
   * @param userId - User identifier
   * @param queryVector - Query embedding vector
   * @returns Ranked vector results
   */
  private async searchVector(
    userId: string, 
    queryVector: number[]
  ): Promise<RankedResult[]> {
    try {
      // Import lancedb dynamically to avoid issues if not available
      const lancedb = await import("@lancedb/lancedb")
      const path = await import("node:path")
      const fs = await import("node:fs/promises")
      
      const dbPath = path.resolve(process.cwd(), ".orion", "lancedb")
      await fs.mkdir(path.dirname(dbPath), { recursive: true })
      
      const db = await lancedb.connect(dbPath)
      const tableNames = await db.tableNames()
      
      if (!tableNames.includes("memories")) {
        return []
      }

      const table = await db.openTable("memories")
      const sanitizedUserId = sanitizeUserId(userId)
      
      const rawResults = await table
        .vectorSearch(queryVector)
        .where(`userId = '${sanitizedUserId}'`)
        .limit(this.config.topK)
        .toArray() as Array<Record<string, unknown>>

      return rawResults
        .filter((row) => row.content !== "__init__")
        .map((row, index) => {
          // Extract distance/score from LanceDB result
          const distance = 
            (typeof row._distance === "number" ? row._distance : null) ??
            (typeof row.distance === "number" ? row.distance : null) ??
            0
          
          // Convert distance to similarity score
          const similarity = 1 / (1 + Math.max(0, distance))
          
          return {
            id: String(row.id),
            content: String(row.content ?? ""),
            metadata: { 
              distance,
              vectorSimilarity: similarity,
            },
            rank: index + 1, // 1-based rank for RRF
            source: "vector",
            rawScore: similarity,
          }
        })
    } catch (error) {
      log.warn("Vector search failed, falling back to empty", { error })
      return []
    }
  }

  /**
   * Fuse results from FTS and Vector using Reciprocal Rank Fusion
   * 
   * RRF is a method for combining ranked lists from different sources.
   * It doesn't require score normalization and handles rank positions
   * rather than raw scores, making it robust across different modalities.
   * 
   * Algorithm:
   * 1. Collect all unique document IDs from both lists
   * 2. For each document, compute RRF score:
   *    score = Σ(1 / (k + rank_i)) for each list i
   * 3. Sort by RRF score descending
   * 
   * @param ftsResults - Results from full-text search
   * @param vectorResults - Results from vector search
   * @returns Fused and ranked results
   */
  private fuseWithRRF(
    ftsResults: RankedResult[],
    vectorResults: RankedResult[],
  ): SearchResult[] {
    // Create a map to aggregate RRF scores
    const scoreMap = new Map<
      string, 
      { 
        id: string
        content: string
        metadata: Record<string, unknown>
        ranks: { fts?: number; vector?: number }
        sources: Set<"fts" | "vector">
      }
    >()

    // Process FTS results
    for (const result of ftsResults) {
      const existing = scoreMap.get(result.id)
      if (existing) {
        existing.ranks.fts = result.rank
        existing.sources.add("fts")
      } else {
        scoreMap.set(result.id, {
          id: result.id,
          content: result.content,
          metadata: { ...result.metadata, source: "fts" },
          ranks: { fts: result.rank },
          sources: new Set(["fts"]),
        })
      }
    }

    // Process Vector results
    for (const result of vectorResults) {
      const existing = scoreMap.get(result.id)
      if (existing) {
        existing.ranks.vector = result.rank
        existing.sources.add("vector")
        // Merge metadata
        existing.metadata = {
          ...existing.metadata,
          ...result.metadata,
          source: "hybrid",
          ftsRank: existing.ranks.fts,
          vectorRank: result.rank,
        }
      } else {
        scoreMap.set(result.id, {
          id: result.id,
          content: result.content,
          metadata: { ...result.metadata, source: "vector" },
          ranks: { vector: result.rank },
          sources: new Set(["vector"]),
        })
      }
    }

    // Compute RRF scores and convert to final results
    const fused: SearchResult[] = []
    
    for (const [id, data] of scoreMap) {
      const ranks: number[] = []
      
      // Add weighted ranks from each source
      if (data.ranks.fts) {
        // Apply FTS weight by adjusting effective rank
        const effectiveRank = data.ranks.fts / this.config.ftsWeight
        ranks.push(effectiveRank)
      }
      
      if (data.ranks.vector) {
        // Apply vector weight by adjusting effective rank
        const effectiveRank = data.ranks.vector / this.config.vectorWeight
        ranks.push(effectiveRank)
      }

      // Compute RRF score
      const rrfScore = computeRRFScore(ranks, this.config.rrfK)

      fused.push({
        id,
        content: data.content,
        metadata: {
          ...data.metadata,
          rrfScore,
          fusionMethod: "rrf",
          sources: Array.from(data.sources),
        },
        score: rrfScore,
      })
    }

    // Sort by RRF score descending
    return fused.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<HybridConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridConfig {
    return { ...this.config }
  }
}

// Export singleton instance
export const hybridRetriever = new HybridRetriever()
