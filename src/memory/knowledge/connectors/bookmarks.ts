/**
 * @file bookmarks.ts
 * @description Chrome/Firefox bookmark JSON parser.
 *
 * ARCHITECTURE:
 *   Reads Chrome or Firefox exported bookmark JSON files.
 *   Extracts URL + title pairs, ingests each as a short document
 *   in the RAG engine so EDITH can recall bookmarked URLs by topic.
 *
 * @module memory/knowledge/connectors/bookmarks
 */

import fsAsync from "node:fs/promises"

import { createLogger } from "../../../logger.js"
import { rag } from "../../rag.js"

const log = createLogger("memory.knowledge.connectors.bookmarks")

/** A single extracted bookmark. */
interface Bookmark {
  /** Page title. */
  title: string
  /** Page URL. */
  url: string
}

/** Result of an ingest operation. */
export interface IngestResult {
  /** Number of bookmarks successfully indexed. */
  indexed: number
  /** Number of bookmarks that failed to index. */
  failed: number
}

/**
 * Chrome/Firefox bookmark connector.
 * Parses the exported JSON format and ingests each bookmark as a short document.
 */
export class BookmarkConnector {
  /**
   * Parse a Chrome or Firefox bookmark export file and ingest all bookmarks.
   *
   * @param jsonPath - Absolute path to the bookmark JSON file
   * @param userId   - User identifier for memory storage
   * @returns Ingest result counts
   */
  async ingestFromFile(jsonPath: string, userId: string): Promise<IngestResult> {
    const result: IngestResult = { indexed: 0, failed: 0 }

    let raw: string
    try {
      raw = await fsAsync.readFile(jsonPath, "utf-8")
    } catch (err) {
      log.warn("cannot read bookmark file", { jsonPath, err })
      return result
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      log.warn("invalid JSON in bookmark file", { jsonPath })
      return result
    }

    const bookmarks = this.extractBookmarks(parsed)
    log.info("bookmark extraction complete", { count: bookmarks.length, jsonPath })

    for (const bookmark of bookmarks) {
      try {
        const content = `${bookmark.title}\n${bookmark.url}`
        const docId = await rag.ingest(userId, content, bookmark.title, `bookmark:${bookmark.url}`)
        if (docId) {
          result.indexed++
        } else {
          result.failed++
        }
      } catch (err) {
        log.warn("bookmark ingest failed", { url: bookmark.url, err })
        result.failed++
      }
    }

    log.info("bookmark ingest complete", result)
    return result
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Recursively extract Bookmark objects from a Chrome or Firefox JSON structure.
   * Both formats use a tree of "children" nodes with "type" and "url" fields.
   *
   * @param node - The parsed JSON node to walk
   * @returns Flat array of Bookmark objects
   */
  private extractBookmarks(node: unknown): Bookmark[] {
    const results: Bookmark[] = []

    if (!node || typeof node !== "object") {
      return results
    }

    const obj = node as Record<string, unknown>

    // Chrome format: type === "url"
    // Firefox format: uri field present
    const url = (obj["url"] ?? obj["uri"]) as string | undefined
    if (url && typeof url === "string" && url.startsWith("http")) {
      const title = (obj["name"] ?? obj["title"] ?? url) as string
      results.push({ title: String(title), url })
      return results
    }

    // Recurse into children
    const children = obj["children"] ?? obj["roots"]
    if (Array.isArray(children)) {
      for (const child of children) {
        results.push(...this.extractBookmarks(child))
      }
    } else if (children && typeof children === "object") {
      // Firefox "roots" is an object
      for (const child of Object.values(children)) {
        results.push(...this.extractBookmarks(child))
      }
    }

    return results
  }
}

/** Singleton BookmarkConnector instance. */
export const bookmarkConnector = new BookmarkConnector()
