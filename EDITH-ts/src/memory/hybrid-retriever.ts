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
import config from "../config.js"
import { orchestrator } from "../engines/orchestrator.js"
import { clamp, sanitizeUserId as sanitizeVectorUserId } from "../utils/index.js"
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
  scoreThreshold: 0.005,
}

const MIN_RRF_WEIGHT = 0.01
const MAX_TOP_K = 200
const MAX_FINAL_LIMIT = 50
const SHORT_TECHNICAL_TOKENS = new Set([
  "ai",
  "db",
  "go",
  "io",
  "js",
  "ml",
  "qa",
  "ts",
  "ui",
  "ux",
])

/**
 * Compute weighted RRF score contribution for one source.
 *
 * Weighted RRF(d) = Σ(w_i * (1 / (k + r_i(d))))
 * where:
 * - w_i = source weight
 * - k = constant (typically 60)
 * - r_i(d) = rank of document d in source i
 */
function computeWeightedRRFScore(rank: number, weight: number, k: number): number {
  return weight * (1 / (k + rank))
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

function normalizePositiveInt(value: number, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function normalizeWeight(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return clamp(value, MIN_RRF_WEIGHT, 1)
}

function normalizeHybridConfig(config: Partial<HybridConfig>, base: HybridConfig = DEFAULT_CONFIG): HybridConfig {
  const next: HybridConfig = {
    topK: normalizePositiveInt(config.topK ?? base.topK, base.topK, 1, MAX_TOP_K),
    finalLimit: normalizePositiveInt(config.finalLimit ?? base.finalLimit, base.finalLimit, 1, MAX_FINAL_LIMIT),
    rrfK: normalizePositiveInt(config.rrfK ?? base.rrfK, base.rrfK, 1, 10_000),
    ftsWeight: normalizeWeight(config.ftsWeight ?? base.ftsWeight, base.ftsWeight),
    vectorWeight: normalizeWeight(config.vectorWeight ?? base.vectorWeight, base.vectorWeight),
    scoreThreshold: clamp(
      Number.isFinite(config.scoreThreshold ?? base.scoreThreshold)
        ? Number(config.scoreThreshold ?? base.scoreThreshold)
        : base.scoreThreshold,
      0,
      1,
    ),
  }

  // Keep candidate pool >= final output limit so "limit" settings stay intuitive.
  next.topK = Math.max(next.topK, next.finalLimit)
  return next
}

function buildFTSQuery(query: string): string {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const rawToken of query.match(/[a-zA-Z0-9_]+/g) ?? []) {
    const token = rawToken.trim().toLowerCase()
    if (!token) {
      continue
    }

    const allowShort = token.length >= 2 && SHORT_TECHNICAL_TOKENS.has(token)
    if (token.length <= 2 && !allowShort) {
      continue
    }
    if (token.length > 2 || allowShort) {
      if (seen.has(token)) {
        continue
      }
      seen.add(token)
      deduped.push(token)
    }
    if (deduped.length >= 8) {
      break
    }
  }

  return deduped.map((token) => `${token}*`).join(" ")
}

function tokenizeForOverlap(text: string): Set<string> {
  return new Set(
    (text.match(/[a-z0-9]+/gi) ?? [])
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 2),
  )
}

function computeOverlapScore(query: string, candidate: string): number {
  const queryTokens = tokenizeForOverlap(query)
  if (queryTokens.size === 0) {
    return 0
  }

  const candidateTokens = tokenizeForOverlap(candidate)
  let overlap = 0
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1
    }
  }
  return overlap / queryTokens.size
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
    this.config = normalizeHybridConfig(config)
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
    const finalLimit = normalizePositiveInt(limit ?? this.config.finalLimit, this.config.finalLimit, 1, MAX_FINAL_LIMIT)
    if (!query.trim() || queryVector.length === 0) {
      return []
    }
    
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
      // Prisma parameterization already handles SQL quoting; do not sanitize userId here
      // because MemoryNode.userId stores the raw value (see temporal-index/store).
      const ftsQuery = buildFTSQuery(query)

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
        -- MemoryNode.id is a string primary key; FTS rowid maps to SQLite rowid, not m.id.
        JOIN MemoryNodeFTS fts ON m.rowid = fts.rowid
        WHERE m.userId = ${userId}
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
      
      const dbPath = path.resolve(process.cwd(), ".edith", "lancedb")
      await fs.mkdir(path.dirname(dbPath), { recursive: true })
      
      const db = await lancedb.connect(dbPath)
      const tableNames = await db.tableNames()
      
      if (!tableNames.includes("memories")) {
        return []
      }

      const table = await db.openTable("memories")
      const sanitizedUserId = sanitizeVectorUserId(userId)
      
      const rawResults = await table
        .vectorSearch(queryVector)
        .where(`userId = '${sanitizedUserId}'`)
        .limit(this.config.topK)
        .toArray() as Array<Record<string, unknown>>

      return rawResults
        // Defense-in-depth: keep local filtering in case LanceDB where semantics drift.
        .filter((row) => row.content !== "__init__" && String(row.userId ?? "") === sanitizedUserId)
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

    // Compute weighted RRF scores and convert to final results
    const fused: SearchResult[] = []
    
    for (const [id, data] of scoreMap) {
      let rrfScore = 0

      if (data.ranks.fts) {
        rrfScore += computeWeightedRRFScore(data.ranks.fts, this.config.ftsWeight, this.config.rrfK)
      }
      
      if (data.ranks.vector) {
        rrfScore += computeWeightedRRFScore(data.ranks.vector, this.config.vectorWeight, this.config.rrfK)
      }

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
    this.config = normalizeHybridConfig(config, this.config)
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridConfig {
    return { ...this.config }
  }

  /**
   * Simplified retrieve method that auto-generates embeddings.
   * 
   * This is a convenience wrapper around search() that handles
   * embedding generation internally. Use this when you just have
   * a text query and don't want to manage embeddings yourself.
   *
   * @param userId - User identifier
   * @param query - Search query text
   * @param embedFn - Function to generate embeddings (pass memory.embed)
   * @param limit - Maximum results to return
   * @returns Fused search results sorted by RRF score
   */
  async retrieve(
    userId: string,
    query: string,
    embedFn: (text: string) => Promise<number[]>,
    limit?: number,
  ): Promise<SearchResult[]> {
    try {
      let embeddingInput = query
      if (config.HYBRID_HYDE_ENABLED) {
        const hypothetical = await this.generateHypotheticalDocument(query)
        if (hypothetical) {
          embeddingInput = `${query}\n\n${hypothetical}`
        }
      }

      const queryVector = await embedFn(embeddingInput)
      const results = await this.search(userId, query, queryVector, limit)
      if (!config.HYBRID_RERANK_ENABLED) {
        return results
      }

      return this.rerankResults(query, results, limit)
    } catch (error) {
      log.error("retrieve failed (embedding generation error)", { userId, query: query.slice(0, 100), error })
      return []
    }
  }

  private rerankResults(query: string, results: SearchResult[], limit?: number): SearchResult[] {
    const reranked = results
      .map((result) => {
        const overlap = computeOverlapScore(query, result.content)
        const baseScore = result.score ?? 0
        const rerankScore = (baseScore * 0.7) + (overlap * 0.3)
        return {
          ...result,
          metadata: {
            ...(result.metadata ?? {}),
            rerankScore,
            overlapScore: overlap,
          },
          score: rerankScore,
        }
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

    if (typeof limit === "number" && Number.isFinite(limit)) {
      return reranked.slice(0, Math.max(1, Math.floor(limit)))
    }
    return reranked
  }

  private async generateHypotheticalDocument(query: string): Promise<string | null> {
    try {
      const prompt = `Write a concise hypothetical answer to improve retrieval coverage for this query:\n\n${query.slice(0, 400)}`
      const generated = await orchestrator.generate("fast", {
        prompt,
        temperature: 0.2,
      })
      const trimmed = generated.trim()
      return trimmed.length > 0 ? trimmed.slice(0, 800) : null
    } catch (error) {
      log.warn("HyDE generation failed, fallback to raw query", { error })
      return null
    }
  }
}

// Export singleton instance
export const hybridRetriever = new HybridRetriever()

export const __hybridRetrieverTestUtils = {
  buildFTSQuery,
  normalizeHybridConfig,
  computeWeightedRRFScore,
  computeOverlapScore,
  SHORT_TECHNICAL_TOKENS: new Set(SHORT_TECHNICAL_TOKENS),
}
