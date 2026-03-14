/**
 * @file store.ts
 * @description Primary memory store  LanceDB vector store, context builder, and MemRL integration.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Central hub for all memory persistence: embed, save, search, and buildContext.
 *   Used throughout the codebase via the exported `memory` singleton.
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import * as lancedb from "@lancedb/lancedb"

import config from "../config.js"
import { getHistory, saveMessage } from "../database/index.js"
import { validateMemoryEntries, type MemoryEntry } from "../security/memory-validator.js"
import { createLogger } from "../logger.js"
import { sanitizeUserId, parseJsonSafe } from "../utils/index.js"
import { lanceFilter } from "./lance-filter.js"
import { hiMeS } from "./himes.js"
import { memrlUpdater, type TaskFeedback } from "./memrl.js"
import { proMem } from "./promem.js"
import { temporalIndex } from "./temporal-index.js"
import { localEmbedder } from "./local-embedder.js"

const log = createLogger("memory.store")

const VECTOR_DIMENSION = 768

/** Maximum allowed content length for a single memory entry (50 000 chars â‰ˆ ~12 500 tokens). */
const MAX_MEMORY_CONTENT_LENGTH = 50_000
const LEGACY_VECTOR_DIMENSION = 1536
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
const OLLAMA_EMBEDDING_MODEL = "nomic-embed-text"
const EMBEDDING_REQUEST_TIMEOUT_MS = 8_000
const PENDING_FEEDBACK_MAX_AGE_MS = 30 * 60 * 1000
const EMBEDDING_CACHE_MAX_ENTRIES = 512
const HASH_FALLBACK_ALERT_EVERY = 25

interface MemoryRow extends Record<string, unknown> {
  id: string
  userId: string
  content: string
  vector: number[]
  metadata: string
  createdAt: number
  utilityScore: number
}

async function fetchJsonWithTimeout<T>(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })

    if (!response.ok) {
      return { ok: false, status: response.status, data: null }
    }

    const data = (await response.json()) as T
    return { ok: true, status: response.status, data }
  } finally {
    clearTimeout(timeout)
  }
}

export interface SearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

export interface BuildContextResult {
  systemContext: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
  retrievedMemoryIds: string[]
}

function hashFeature(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function normalizeVector(vector: number[]): number[] {
  const squaredSum = vector.reduce((sum, value) => sum + (value * value), 0)
  if (!Number.isFinite(squaredSum) || squaredSum <= 0) {
    return vector
  }
  const norm = Math.sqrt(squaredSum)
  return vector.map((value) => value / norm)
}

/**
 * Deterministic lexical fallback embedding.
 *
 * This is intentionally simple and local-only, but preserves token overlap
 * better than pseudo-random sin-based vectors.
 */
function hashToVector(text: string): number[] {
  const normalizedText = text
    .toLowerCase()
    .normalize("NFKC")
    .trim()

  const vector = new Array(VECTOR_DIMENSION).fill(0)
  if (!normalizedText) {
    return vector
  }

  const rawTokens = normalizedText.match(/[a-z0-9_]+/g) ?? []
  const tokens = rawTokens.length > 0
    ? rawTokens
    : [normalizedText.slice(0, 128)]

  const baseWeight = 1 / Math.sqrt(tokens.length)

  for (const token of tokens) {
    const truncated = token.slice(0, 64)
    if (!truncated) {
      continue
    }

    const tokenHash = hashFeature(truncated)

    // Multiple signed projections per token for better spread.
    for (let projection = 0; projection < 3; projection += 1) {
      const mixed = (tokenHash + Math.imul(0x9e3779b1, projection + 1)) >>> 0
      const index = mixed % VECTOR_DIMENSION
      const sign = ((mixed >>> 31) & 1) === 0 ? 1 : -1
      vector[index] += sign * baseWeight
    }

    // Add short n-gram signals to improve lexical similarity for close variants.
    const maxGramOffset = Math.min(truncated.length - 3, 5)
    for (let i = 0; i <= maxGramOffset; i += 1) {
      const gram = truncated.slice(i, i + 3)
      if (gram.length < 3) {
        continue
      }
      const gramHash = hashFeature(gram)
      const gramIndex = gramHash % VECTOR_DIMENSION
      const gramSign = ((gramHash >>> 30) & 1) === 0 ? 1 : -1
      vector[gramIndex] += gramSign * (baseWeight * 0.5)
    }
  }

  return normalizeVector(vector)
}

async function openAIEmbed(text: string): Promise<number[] | null> {
  if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.trim().length === 0) {
    return null
  }

  try {
    const result = await fetchJsonWithTimeout<{ data?: Array<{ embedding?: number[] }> }>(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_EMBEDDING_MODEL,
          input: text,
          dimensions: VECTOR_DIMENSION,
        }),
      },
      EMBEDDING_REQUEST_TIMEOUT_MS,
    )

    if (!result.ok) {
      log.warn("OpenAI embedding API failed", { status: result.status })
      return null
    }

    const embedding = result.data?.data?.[0]?.embedding

    if (!embedding || embedding.length !== VECTOR_DIMENSION) {
      log.warn("Unexpected embedding dimension", { expected: VECTOR_DIMENSION, got: embedding?.length })
      return null
    }

    return embedding
  } catch (error) {
    log.warn("OpenAI embedding request failed", error)
    return null
  }
}

async function ollamaEmbed(text: string): Promise<number[] | null> {
  const baseUrl = config.OLLAMA_BASE_URL.trim().length > 0
    ? config.OLLAMA_BASE_URL
    : "http://localhost:11434"

  try {
    const result = await fetchJsonWithTimeout<{ embedding?: number[]; embeddings?: number[][] }>(
      `${baseUrl.replace(/\/+$/, "")}/api/embed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OLLAMA_EMBEDDING_MODEL,
          input: text,
        }),
      },
      EMBEDDING_REQUEST_TIMEOUT_MS,
    )

    if (!result.ok) {
      log.warn("Ollama embedding API failed", { status: result.status })
      return null
    }

    const embedding = result.data?.embeddings?.[0] ?? result.data?.embedding

    if (!embedding || embedding.length !== VECTOR_DIMENSION) {
      log.warn("Unexpected embedding dimension", { expected: VECTOR_DIMENSION, got: embedding?.length })
      return null
    }

    return embedding
  } catch (error) {
    log.warn("Ollama embedding request failed", error)
    return null
  }
}

export class MemoryStore {
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null
  private initialized = false
  private embeddingCache = new Map<string, number[]>()
  private hashFallbackCount = 0

  private getCachedEmbedding(text: string): number[] | null {
    const cached = this.embeddingCache.get(text)
    return cached ? [...cached] : null
  }

  private setCachedEmbedding(text: string, vector: number[]): void {
    this.embeddingCache.set(text, [...vector])
    if (this.embeddingCache.size <= EMBEDDING_CACHE_MAX_ENTRIES) {
      return
    }

    const oldestKey = this.embeddingCache.keys().next().value
    if (typeof oldestKey === "string") {
      this.embeddingCache.delete(oldestKey)
    }
  }

  private recordHashFallbackEmbedding(text: string): void {
    this.hashFallbackCount += 1
    log.debug("using hash-based fallback embedding", {
      count: this.hashFallbackCount,
      textLength: text.length,
    })

    if (this.hashFallbackCount === 1 || this.hashFallbackCount % HASH_FALLBACK_ALERT_EVERY === 0) {
      log.warn("hash-based fallback embedding activated", {
        count: this.hashFallbackCount,
        openAiConfigured: config.OPENAI_API_KEY.trim().length > 0,
        ollamaBaseUrl: config.OLLAMA_BASE_URL,
      })
    }
  }

  private async createMemoryTable(): Promise<lancedb.Table> {
    if (!this.db) {
      throw new Error("memory database not initialized")
    }

    const dummyVector = new Array(VECTOR_DIMENSION).fill(0)
    const initialRow: MemoryRow = {
      id: randomUUID(),
      userId: "__init__",
      content: "__init__",
      vector: dummyVector,
      metadata: "{}",
      createdAt: Date.now(),
      utilityScore: 0.5,
    }

    const table = await this.db.createTable("memories", [initialRow])
    await table.delete("userId = '__init__'")
    return table
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      const dbPath = path.resolve(process.cwd(), ".edith", "lancedb")
      await fs.mkdir(path.dirname(dbPath), { recursive: true })

      this.db = await lancedb.connect(dbPath)

      const existing = await this.db.tableNames()
      if (existing.includes("memories")) {
        const existingTable = await this.db.openTable("memories")
        const sampleRows = (await existingTable.query().select(["vector"]).limit(1).toArray()) as Array<{
          vector?: unknown
        }>
        const firstVector = sampleRows[0]?.vector
        const firstVectorLength =
          Array.isArray(firstVector)
            || (typeof firstVector === "object" && firstVector !== null && "length" in firstVector)
            ? Number((firstVector as { length: number }).length)
            : null

        if (firstVectorLength === LEGACY_VECTOR_DIMENSION) {
          log.info("legacy memory table detected, recreating", {
            fromDimension: firstVectorLength,
            toDimension: VECTOR_DIMENSION,
          })
          await this.db.dropTable("memories")
          this.table = await this.createMemoryTable()
        } else {
          this.table = existingTable
        }
      } else {
        this.table = await this.createMemoryTable()
      }

      this.initialized = true
      log.info("memory store initialized", { vectorDimension: VECTOR_DIMENSION })
    } catch (error) {
      log.error("failed to init memory store", error)
    }
  }

  async embed(text: string): Promise<number[]> {
    const cacheKey = text.trim()
    if (cacheKey) {
      const cached = this.getCachedEmbedding(cacheKey)
      if (cached) {
        return cached
      }
    }

    // Phase 9: Try local embedder first when enabled (offline-capable)
    if (config.LOCAL_EMBEDDER_ENABLED && localEmbedder.isAvailable()) {
      const localResult = await localEmbedder.embed(text)
      if (localResult) {
        if (cacheKey) {
          this.setCachedEmbedding(cacheKey, localResult)
        }
        return localResult
      }
    }

    const ollamaResult = await ollamaEmbed(text)

    if (ollamaResult) {
      if (cacheKey) {
        this.setCachedEmbedding(cacheKey, ollamaResult)
      }
      return ollamaResult
    }

    const openAIResult = await openAIEmbed(text)
    if (openAIResult) {
      if (cacheKey) {
        this.setCachedEmbedding(cacheKey, openAIResult)
      }
      return openAIResult
    }

    this.recordHashFallbackEmbedding(text)
    const fallback = hashToVector(text)
    if (cacheKey) {
      this.setCachedEmbedding(cacheKey, fallback)
    }
    return fallback
  }

  /** Returns true when the LanceDB vector store has been successfully initialized. */
  isInitialized(): boolean {
    return this.initialized
  }

  getFallbackEmbeddingCount(): number {
    return this.hashFallbackCount
  }

  async save(
    userId: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<string | null> {
    if (!this.table) {
      log.warn("memory table not initialized")
      return null
    }

    // Write-time content validation
    if (!content || content.trim().length === 0) {
      log.warn("memory save rejected: empty content", { userId })
      return null
    }

    if (content.length > MAX_MEMORY_CONTENT_LENGTH) {
      log.warn("memory save rejected: content exceeds max length", {
        userId,
        length: content.length,
        maxLength: MAX_MEMORY_CONTENT_LENGTH,
      })
      return null
    }

    // Validate entries before embedding
    const entries = validateMemoryEntries([{ content, metadata }])
    if (entries.clean.length === 0) {
      log.warn("memory save rejected: failed validation", { userId })
      return null
    }

    try {
      const id = randomUUID()
      const vector = await this.embed(content)
      const row: MemoryRow = {
        id,
        userId: sanitizeUserId(userId),
        content,
        vector,
        metadata: JSON.stringify(metadata),
        createdAt: Date.now(),
        utilityScore: 0.5,
      }

      await this.table.add([row])
      if (metadata.temporal !== false) {
        const levelValue = Number(metadata.level)
        const level = levelValue === 1 || levelValue === 2 ? levelValue : 0
        const category = typeof metadata.category === "string" ? metadata.category : "fact"
        void temporalIndex.store(userId, content, level, category, id)
      }
      log.debug("saved memory", { id, userId, contentLength: content.length })
      return id
    } catch (error) {
      log.error("failed to save memory", error)
      return null
    }
  }

  private async legacySearch(
    userId: string,
    queryVector: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.table || limit <= 0) {
      return []
    }

    const sanitizedUserId = sanitizeUserId(userId)

    const results = await this.table
      .vectorSearch(queryVector)
      .where(lanceFilter.eq("userId", sanitizedUserId))
      .limit(limit * 2)
      .toArray()

    const filtered = (results as MemoryRow[])
      .filter((row) => row.userId === sanitizedUserId && row.content !== "__init__")
      .slice(0, limit)

    return filtered.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: parseJsonSafe(row.metadata),
      score: 1,
    }))
  }

  async search(
    userId: string,
    query: string,
    limit = 5,
  ): Promise<SearchResult[]> {
    if (!this.table || limit <= 0) {
      return []
    }

    let queryVector: number[] | null = null

    try {
      queryVector = await this.embed(query)
      const memrlResults = await memrlUpdater.twoPhaseRetrieve(
        sanitizeUserId(userId),
        queryVector,
        limit,
        config.MEMRL_SIMILARITY_THRESHOLD,
      )

      if (memrlResults.length > 0) {
        return memrlResults
      }

      return await this.legacySearch(userId, queryVector, limit)
    } catch (error) {
      log.error("search failed", error)

      if (!queryVector) {
        return []
      }

      try {
        return await this.legacySearch(userId, queryVector, limit)
      } catch (fallbackError) {
        log.error("legacy search fallback failed", fallbackError)
        return []
      }
    }
  }

  async provideFeedback(feedback: TaskFeedback): Promise<void> {
    await memrlUpdater.updateFromFeedback(feedback)
  }

  async buildContext(
    userId: string,
    query: string,
    limit = 10
  ): Promise<BuildContextResult> {
    try {
      const retrievalLimit = Math.max(3, Math.min(8, Math.floor(limit / 2)))
      const [fused, adaptiveMemories] = await Promise.all([
        hiMeS.buildFusedContext(userId, query, (text) => this.embed(text)),
        this.search(userId, query, retrievalLimit),
      ])

      const systemBlocks: string[] = []
      const contextMessages: Array<{ role: "user" | "assistant"; content: string }> = []

      for (const item of fused) {
        if (item.role === "user" && item.content.startsWith("[")) {
          systemBlocks.push(item.content)
          continue
        }
        contextMessages.push(item)
      }

      if (adaptiveMemories.length > 0) {
        const memoryBlock = [
          "[Adaptive Memories]",
          ...adaptiveMemories.map((item, index) => `${index + 1}. ${item.content}`),
        ].join("\n")
        systemBlocks.push(memoryBlock)
      }

      if (contextMessages.length > limit) {
        contextMessages.splice(0, contextMessages.length - limit)
      }

      const validationInput: MemoryEntry[] = systemBlocks.map((content) => ({
        content,
        metadata: { source: "himes" },
      }))
      const validated = validateMemoryEntries(validationInput)
      const systemContext = validated.clean.map((item) => item.content).join("\n\n")
      const retrievedMemoryIds = Array.from(new Set(adaptiveMemories.map((item) => item.id)))

      // Register pending MemRL feedback (Fix 0.3)
      // Gateway will consume this on next user turn
      if (retrievedMemoryIds.length > 0) {
        this.registerPendingFeedback(userId, retrievedMemoryIds, 0.5) // provisional reward
      }

      return { systemContext, messages: contextMessages, retrievedMemoryIds }
    } catch (error) {
      log.error("buildContext failed", error)
      return { systemContext: "", messages: [], retrievedMemoryIds: [] }
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!this.table) {
      return false
    }

    try {
      await this.table.delete(lanceFilter.eq("id", id))
      log.debug("memory entry deleted", { id })
      return true
    } catch (error) {
      log.error("failed to delete memory entry", error)
      return false
    }
  }

  async clear(userId: string): Promise<void> {
    if (!this.table) {
      return
    }

    try {
      const sanitizedUserId = sanitizeUserId(userId)
      await this.table.delete(lanceFilter.eq("userId", sanitizedUserId))
      log.info("memory cleared for user", { userId })
    } catch (error) {
      log.error("failed to clear memory", error)
    }
  }

  async compress(userId: string): Promise<void> {
    try {
      const messages = await getHistory(userId, 100)
      if (messages.length < 50) {
        return
      }

      const facts = await proMem.extract(userId, messages.slice(0, 50).reverse())
      if (facts.length === 0) {
        return
      }

      for (const fact of facts) {
        const metadata = {
          role: "system",
          compressed: true,
          source: "promem",
          category: "fact",
          level: 1,
          compressedAt: Date.now(),
        }
        await this.save(userId, fact, metadata)
        await saveMessage(userId, "system", fact, "memory", metadata)
      }

      log.info("compressed history with promem", { userId, count: messages.length, facts: facts.length })
    } catch (error) {
      log.error("compress failed", error)
    }
  }

  // ============== MemRL Feedback Side-Channel (Fix 0.3) ==============

  /** Pending feedback data per userId, set after each retrieval. */
  private readonly pendingFeedback = new Map<string, {
    retrievedIds: string[]
    provisionalReward: number
    timestamp: number
  }>()

  private pruneStalePendingFeedback(now = Date.now()): void {
    for (const [userId, entry] of this.pendingFeedback) {
      if (now - entry.timestamp > PENDING_FEEDBACK_MAX_AGE_MS) {
        this.pendingFeedback.delete(userId)
      }
    }
  }

  /**
   * Called internally after each retrieve() to register pending feedback.
   * Gateway/pipeline calls consumePendingFeedback() on next turn.
   */
  registerPendingFeedback(userId: string, retrievedIds: string[], provisionalReward: number): void {
    this.pruneStalePendingFeedback()
    this.pendingFeedback.set(userId, {
      retrievedIds,
      provisionalReward,
      timestamp: Date.now(),
    })
  }

  /**
   * Consume and clear pending feedback for a user.
   * Returns null if no pending feedback exists.
   */
  consumePendingFeedback(userId: string): { retrievedIds: string[]; provisionalReward: number; timestamp: number } | null {
    this.pruneStalePendingFeedback()
    const data = this.pendingFeedback.get(userId) ?? null
    this.pendingFeedback.delete(userId)

    if (data && Date.now() - data.timestamp > PENDING_FEEDBACK_MAX_AGE_MS) {
      return null
    }

    return data
  }

  /**
   * Clear feedback for a user (call on disconnect/cleanup).
   */
  clearFeedback(userId: string): void {
    this.pendingFeedback.delete(userId)
  }

  clearAllFeedback(): void {
    this.pendingFeedback.clear()
  }
}

export const memory = new MemoryStore()

export const __memoryStoreTestUtils = {
  hashToVector,
}
