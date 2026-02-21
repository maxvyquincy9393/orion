import path from "node:path"
import { randomUUID } from "node:crypto"

import * as lancedb from "@lancedb/lancedb"

import { prisma, saveMessage, getHistory } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import type { GenerateOptions } from "../engines/types.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.store")

interface MemoryRow {
  id: string
  userId: string
  content: string
  vector: number[]
  metadata: string
  createdAt: number
  _distance?: number
}

export class MemoryStore {
  private vectorDb: any
  private table: any = null

  async init(): Promise<void> {
    try {
      const dbPath = path.resolve(process.cwd(), ".orion", "vectors")
      this.vectorDb = await lancedb.connect(dbPath)

      try {
        this.table = await this.vectorDb.openTable("memories")
      } catch {
        const seedVector = Array(1536).fill(0)
        this.table = await this.vectorDb.createTable("memories", [
          {
            id: "__seed__",
            userId: "__seed__",
            content: "seed",
            vector: seedVector,
            metadata: "{}",
            createdAt: Date.now(),
          },
        ])

        try {
          await this.table.delete("id = '__seed__'")
        } catch {
          log.debug("seed cleanup skipped")
        }
      }

      log.info("memory store initialized")
    } catch (error) {
      log.error("memory init failed", error)
      this.table = null
    }
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await orchestrator.generate("fast", {
        prompt:
          `Return ONLY a JSON array of 1536 floats representing the embedding of: ` +
          `"${text}"`,
      })

      const parsed = JSON.parse(response)
      if (Array.isArray(parsed) && parsed.length === 1536) {
        return parsed.map((value) => Number(value) || 0)
      }

      return Array(1536).fill(0)
    } catch (error) {
      log.warn("embed failed, returning zero vector", error)
      return Array(1536).fill(0)
    }
  }

  async save(
    userId: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const vector = await this.embed(content)
      const row: MemoryRow = {
        id: randomUUID(),
        userId,
        content,
        vector,
        metadata: JSON.stringify(metadata),
        createdAt: Date.now(),
      }

      if (this.table) {
        await this.table.add([row])
      }

      await saveMessage(userId, "user", content, "memory", metadata)
    } catch (error) {
      log.error("save failed", error)
    }
  }

  async search(
    userId: string,
    query: string,
    limit = 5,
  ): Promise<Array<{ content: string; score: number; metadata: Record<string, unknown> }>> {
    try {
      if (!this.table) {
        return []
      }

      const vector = await this.embed(query)
      const escapedUser = userId.replace(/'/g, "''")
      const rows = (await this.table
        .search(vector)
        .where(`userId = '${escapedUser}'`)
        .limit(limit)
        .toArray()) as MemoryRow[]

      return rows.map((row) => {
        let parsedMetadata: Record<string, unknown> = {}
        try {
          parsedMetadata = JSON.parse(row.metadata ?? "{}")
        } catch {
          parsedMetadata = {}
        }

        return {
          content: row.content,
          score: row._distance ?? 0,
          metadata: parsedMetadata,
        }
      })
    } catch (error) {
      log.error("search failed", error)
      return []
    }
  }

  async getHistory(userId: string, limit = 50) {
    return getHistory(userId, limit)
  }

  async buildContext(
    userId: string,
    query: string,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    try {
      const [history, semantic] = await Promise.all([
        this.getHistory(userId, 20),
        this.search(userId, query, 10),
      ])

      const dedup = new Set<string>()
      const context: Array<{ role: "user" | "assistant"; content: string }> = []

      for (const item of semantic) {
        if (dedup.has(item.content)) {
          continue
        }
        dedup.add(item.content)
        context.push({ role: "assistant", content: item.content })
      }

      for (const message of history) {
        if (dedup.has(message.content)) {
          continue
        }
        dedup.add(message.content)

        const role = message.role === "assistant" ? "assistant" : "user"
        context.push({ role, content: message.content })
      }

      return context.slice(0, 20)
    } catch (error) {
      log.error("buildContext failed", error)
      return []
    }
  }

  async compress(userId: string): Promise<void> {
    try {
      const history = await this.getHistory(userId, 100)
      if (history.length <= 50) {
        return
      }

      const oldest = history.slice(-50).reverse()
      const compressContext: GenerateOptions["context"] = oldest
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        }))
        .slice(0, 40)

      const summary = await orchestrator.generate("reasoning", {
        prompt:
          "Summarize the following conversation history into a concise memory note.",
        context: compressContext,
      })

      if (!summary.trim()) {
        return
      }

      await saveMessage(userId, "system", summary, "memory", {
        compressed: true,
        sourceCount: oldest.length,
      })

      await prisma.message.deleteMany({
        where: {
          id: { in: oldest.map((message) => message.id) },
        },
      })
    } catch (error) {
      log.error("compress failed", error)
    }
  }
}

export const memory = new MemoryStore()
