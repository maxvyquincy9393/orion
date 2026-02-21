import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import * as lancedb from "@lancedb/lancedb"

import config from "../config.js"
import { getHistory } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.store")

const VECTOR_DIMENSION = 1536
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"

interface MemoryRow extends Record<string, unknown> {
  id: string
  userId: string
  content: string
  vector: number[]
  metadata: string
  createdAt: number
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
}

function hashToVector(text: string): number[] {
  const vector: number[] = []
  let hash = 0

  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }

  for (let i = 0; i < VECTOR_DIMENSION; i += 1) {
    const seed = (hash + i * 31) ^ text.length
    const value = Math.sin(seed) * 10000
    vector.push(value - Math.floor(value))
  }

  return vector
}

async function openAIEmbed(text: string): Promise<number[] | null> {
  if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.trim().length === 0) {
    return null
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_EMBEDDING_MODEL,
        input: text,
      }),
    })

    if (!response.ok) {
      log.warn("OpenAI embedding API failed", { status: response.status })
      return null
    }

    const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> }
    const embedding = data.data?.[0]?.embedding

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

function sanitizeUserId(userId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    log.warn("userId contains unexpected characters, sanitizing", { userId })
    return userId.replace(/[^a-zA-Z0-9_-]/g, "_")
  }
  return userId
}

export class MemoryStore {
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      const dbPath = path.resolve(process.cwd(), ".orion", "lancedb")
      await fs.mkdir(path.dirname(dbPath), { recursive: true })

      this.db = await lancedb.connect(dbPath)

      const existing = await this.db.tableNames()
      if (existing.includes("memories")) {
        this.table = await this.db.openTable("memories")
      } else {
        const dummyVector = new Array(VECTOR_DIMENSION).fill(0)
        const initialRow: MemoryRow = {
          id: randomUUID(),
          userId: "__init__",
          content: "__init__",
          vector: dummyVector,
          metadata: "{}",
          createdAt: Date.now(),
        }
        this.table = await this.db.createTable("memories", [initialRow])
        await this.table.delete("userId = '__init__'")
      }

      this.initialized = true
      log.info("memory store initialized", { vectorDimension: VECTOR_DIMENSION })
    } catch (error) {
      log.error("failed to init memory store", error)
    }
  }

  async embed(text: string): Promise<number[]> {
    const openAIResult = await openAIEmbed(text)

    if (openAIResult) {
      return openAIResult
    }

    log.debug("using hash-based fallback embedding")
    return hashToVector(text)
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
      }

      await this.table.add([row])
      log.debug("saved memory", { id, userId, contentLength: content.length })
      return id
    } catch (error) {
      log.error("failed to save memory", error)
      return null
    }
  }

  async search(
    userId: string,
    query: string,
    limit = 5
  ): Promise<SearchResult[]> {
    if (!this.table) {
      return []
    }

    try {
      const queryVector = await this.embed(query)
      const sanitizedUserId = sanitizeUserId(userId)

      const results = await this.table
        .vectorSearch(queryVector)
        .where(`userId = '${sanitizedUserId}'`)
        .limit(limit * 2)
        .toArray()

      const filtered = (results as MemoryRow[])
        .filter((row) => row.userId === sanitizedUserId && row.content !== "__init__")
        .slice(0, limit)

      return filtered.map((row) => ({
        id: row.id,
        content: row.content,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        score: 1,
      }))
    } catch (error) {
      log.error("search failed", error)
      return []
    }
  }

  async buildContext(
    userId: string,
    query: string,
    limit = 10
  ): Promise<BuildContextResult> {
    try {
      const messages = await getHistory(userId, limit)
      const searchResults = await this.search(userId, query, 5)

      let systemContext = ""
      if (searchResults.length > 0) {
        const snippets = searchResults.map((r, i) => {
          const source = String(r.metadata.source ?? "memory")
          return `[${i + 1}] (${source}) ${r.content}`
        })
        systemContext = `Relevant memories:\n${snippets.join("\n\n")}`
      }

      const context: Array<{ role: "user" | "assistant"; content: string }> = []

      for (const msg of messages.reverse()) {
        if (msg.role === "user" || msg.role === "assistant") {
          context.push({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })
        }
      }

      return { systemContext, messages: context }
    } catch (error) {
      log.error("buildContext failed", error)
      return { systemContext: "", messages: [] }
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!this.table) {
      return false
    }

    try {
      const sanitizedId = id.replace(/'/g, "")
      await this.table.delete(`id = '${sanitizedId}'`)
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
      await this.table.delete(`userId = '${sanitizedUserId}'`)
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

      const summaryContent = messages
        .slice(0, 50)
        .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        .join("\n")

      await this.save(userId, `[Compressed] ${summaryContent}`, {
        compressed: true,
        compressedAt: Date.now(),
      })

      log.info("compressed history", { userId, count: messages.length })
    } catch (error) {
      log.error("compress failed", error)
    }
  }
}

export const memory = new MemoryStore()
