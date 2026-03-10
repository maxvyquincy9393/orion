/**
 * @file tool.ts
 * @description Notion integration tool for EDITH — search pages, create pages,
 *   and append blocks to existing pages.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Loaded by the skills system. Calls the Notion REST API.
 *   Requires NOTION_TOKEN in config.
 */

import config from "../../src/config.js"
import { createLogger } from "../../src/logger.js"

const log = createLogger("ext.notion")

const NOTION_API_BASE = "https://api.notion.com/v1"
const NOTION_API_VERSION = "2022-06-28"

interface NotionPage {
  id: string
  url: string
  properties: Record<string, unknown>
}

interface NotionSearchResult {
  results: NotionPage[]
  has_more: boolean
}

async function notionFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = config.NOTION_TOKEN
  if (!token?.trim()) {
    throw new Error("NOTION_TOKEN is not configured")
  }

  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
      "User-Agent": "EDITH-AI",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Notion API ${response.status}: ${body.slice(0, 200)}`)
  }

  return response.json() as Promise<T>
}

/** Search Notion workspace for pages matching a query. */
export async function searchPages(query: string, limit = 10): Promise<NotionPage[]> {
  log.debug("searching notion", { query, limit })
  const result = await notionFetch<NotionSearchResult>("/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      page_size: limit,
      filter: { value: "page", property: "object" },
    }),
  })
  return result.results
}

/** Create a new page in a Notion database. */
export async function createPage(
  databaseId: string,
  title: string,
  content: string,
): Promise<NotionPage> {
  log.debug("creating notion page", { databaseId, title })
  return notionFetch<NotionPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: title } }] },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ text: { content } }] },
        },
      ],
    }),
  })
}

/** Append a text block to an existing page. */
export async function appendToPage(pageId: string, text: string): Promise<void> {
  log.debug("appending to notion page", { pageId })
  await notionFetch(`/blocks/${encodeURIComponent(pageId)}/children`, {
    method: "PATCH",
    body: JSON.stringify({
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ text: { content: text } }] },
        },
      ],
    }),
  })
}

/** Tool metadata for the skills loader. */
export const toolMeta = {
  name: "notion",
  description: "Notion integration — search pages, create pages, append content",
  functions: { searchPages, createPage, appendToPage },
}
