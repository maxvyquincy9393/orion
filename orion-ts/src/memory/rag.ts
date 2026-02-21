import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { execa } from "execa"

import config from "../config.js"
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import { memory } from "./store.js"

const log = createLogger("memory.rag")

function chunkText(content: string, size = 500, overlap = 50): string[] {
  const chunks: string[] = []
  if (!content.trim()) {
    return chunks
  }

  let cursor = 0
  while (cursor < content.length) {
    const end = Math.min(content.length, cursor + size)
    chunks.push(content.slice(cursor, end))
    if (end >= content.length) {
      break
    }
    cursor = Math.max(0, end - overlap)
  }

  return chunks
}

export class RAGEngine {
  async ingest(
    userId: string,
    content: string,
    title: string,
    source = "manual",
  ): Promise<string | null> {
    try {
      const parentId = randomUUID()
      const chunks = chunkText(content, 500, 50)

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]
        const metadata = {
          parentId,
          title,
          source,
          chunkIndex: index,
        }

        await memory.save(userId, chunk, metadata)
      }

      await prisma.document.create({
        data: {
          id: parentId,
          userId,
          title,
          source,
        },
      })

      log.info("document ingested", { title, chunks: chunks.length, source })
      return parentId
    } catch (error) {
      log.error("ingest failed", error)
      return null
    }
  }

  async query(userId: string, queryText: string, limit = 5): Promise<string> {
    try {
      const results = await memory.search(userId, queryText, limit)
      const ragResults = results.filter((item) => {
        const source = item.metadata.source
        return typeof source === "string" && source.length > 0
      })

      if (ragResults.length === 0) {
        return ""
      }

      return ragResults
        .map((item, index) => {
          const source = String(item.metadata.source ?? "unknown")
          const title = String(item.metadata.title ?? "untitled")
          return `[${index + 1}] (${source}) ${title}\n${item.content}`
        })
        .join("\n\n")
    } catch (error) {
      log.error("query failed", error)
      return ""
    }
  }

  async ingestFile(userId: string, filePath: string): Promise<string | null> {
    try {
      const ext = path.extname(filePath).toLowerCase()
      const title = path.basename(filePath)

      let content = ""
      if (ext === ".txt" || ext === ".md" || ext === ".json") {
        content = await fs.readFile(filePath, "utf-8")
      } else if (ext === ".pdf") {
        const pythonCode = [
          "import sys",
          "from pypdf import PdfReader",
          "reader = PdfReader(sys.argv[1])",
          "text = []",
          "for page in reader.pages:",
          "    text.append(page.extract_text() or '')",
          "print('\\n'.join(text))",
        ].join("; ")

        const result = await execa(config.PYTHON_PATH, ["-c", pythonCode, filePath])
        content = result.stdout
      } else {
        log.warn("unsupported file extension", { filePath, ext })
        return null
      }

      return this.ingest(userId, content, title, filePath)
    } catch (error) {
      log.error("ingestFile failed", error)
      return null
    }
  }

  async deleteDocument(docId: string): Promise<void> {
    try {
      await memory.delete(docId)
      await prisma.document.deleteMany({ where: { id: docId } })
      log.info("document deleted", { docId })
    } catch (error) {
      log.error("deleteDocument failed", error)
    }
  }
}

export const rag = new RAGEngine()
