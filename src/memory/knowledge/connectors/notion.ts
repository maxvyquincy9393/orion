/**
 * @file notion.ts
 * @description Notion connector — sync pages via Notion API v1.
 *
 * ARCHITECTURE:
 *   Uses @notionhq/client (optional dep) to fetch pages from Notion databases.
 *   Ingests each page as a document into the RAG engine.
 *   Returns early (0/0) if @notionhq/client is not installed.
 *
 * @module memory/knowledge/connectors/notion
 */

import config from "../../../config.js"
import { createLogger } from "../../../logger.js"
import { rag } from "../../rag.js"

const log = createLogger("memory.knowledge.connectors.notion")

/** Result of a sync operation. */
export interface SyncResult {
  /** Number of pages successfully synced. */
  synced: number
  /** Number of pages that failed. */
  failed: number
}

/** Minimal shape of a Notion page block as returned by @notionhq/client. */
interface NotionBlock {
  type: string
  [key: string]: unknown
}

/** Minimal shape of a Notion page object. */
interface NotionPage {
  id: string
  properties: Record<string, unknown>
}

/**
 * Notion connector.
 * Fetches pages from Notion databases and ingests them into the RAG engine.
 */
export class NotionConnector {
  /**
   * Sync all pages from the specified Notion database IDs.
   * Uses NOTION_API_KEY from config.ts.
   *
   * @param databaseIds - Array of Notion database IDs to sync
   * @param userId      - User identifier for memory storage
   * @returns Sync result counts
   */
  async sync(databaseIds: string[], userId: string): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, failed: 0 }

    if (!config.NOTION_API_KEY) {
      log.warn("NOTION_API_KEY not set — skipping Notion sync")
      return result
    }

    // Dynamic import — graceful degradation if not installed
    type NotionClientConstructor = new (opts: { auth: string }) => unknown
    let Client: NotionClientConstructor
    try {
      // Using a variable to prevent TypeScript from statically resolving the optional module.
      const notionMod = "@notionhq/client"
      const mod = await (import(/* webpackIgnore: true */ notionMod) as Promise<unknown>).catch(() => null)
      if (!mod) {
        log.warn("@notionhq/client not installed — Notion sync unavailable")
        return result
      }
      Client = (mod as { Client: NotionClientConstructor }).Client
    } catch {
      log.warn("@notionhq/client not installed — Notion sync unavailable")
      return result
    }

    const client = new Client({ auth: config.NOTION_API_KEY }) as {
      databases: {
        query: (params: { database_id: string }) => Promise<{ results: NotionPage[] }>
      }
      blocks: {
        children: {
          list: (params: { block_id: string }) => Promise<{ results: NotionBlock[] }>
        }
      }
    }

    for (const dbId of databaseIds) {
      try {
        const response = await client.databases.query({ database_id: dbId })
        const pages = response.results

        for (const page of pages) {
          try {
            const text = await this.extractPageText(client, page)
            if (!text.trim()) continue

            const title = this.extractPageTitle(page)
            const docId = await rag.ingest(userId, text, title, `notion:${page.id}`)
            if (docId) {
              result.synced++
            } else {
              result.failed++
            }
          } catch (pageErr) {
            log.warn("page sync failed", { pageId: page.id, err: pageErr })
            result.failed++
          }
        }
      } catch (dbErr) {
        log.warn("database query failed", { dbId, err: dbErr })
      }
    }

    log.info("Notion sync complete", result)
    return result
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract plain text from a Notion page by fetching its blocks.
   *
   * @param client - Notion client instance
   * @param page   - Notion page object
   * @returns Plain text string
   */
  private async extractPageText(
    client: {
      blocks: {
        children: {
          list: (params: { block_id: string }) => Promise<{ results: NotionBlock[] }>
        }
      }
    },
    page: NotionPage,
  ): Promise<string> {
    try {
      const blocks = await client.blocks.children.list({ block_id: page.id })
      return blocks.results
        .map((block) => this.blockToText(block))
        .filter(Boolean)
        .join("\n")
    } catch {
      return ""
    }
  }

  /**
   * Convert a Notion block to a plain text string.
   *
   * @param block - Notion block object
   * @returns Plain text or empty string
   */
  private blockToText(block: NotionBlock): string {
    const richTextTypes = ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "quote", "callout"]
    for (const type of richTextTypes) {
      if (block.type === type) {
        const typeData = block[type] as { rich_text?: Array<{ plain_text?: string }> } | undefined
        if (typeData?.rich_text) {
          return typeData.rich_text.map((rt) => rt.plain_text ?? "").join("")
        }
      }
    }
    return ""
  }

  /**
   * Extract the page title from its properties.
   *
   * @param page - Notion page object
   * @returns Page title string
   */
  private extractPageTitle(page: NotionPage): string {
    const titleProp = page.properties["title"] ?? page.properties["Name"] ?? page.properties["Page"]
    if (titleProp) {
      const tp = titleProp as { title?: Array<{ plain_text?: string }> }
      if (tp.title) {
        return tp.title.map((rt) => rt.plain_text ?? "").join("") || `Notion Page ${page.id}`
      }
    }
    return `Notion Page ${page.id}`
  }
}

/** Singleton NotionConnector instance. */
export const notionConnector = new NotionConnector()
