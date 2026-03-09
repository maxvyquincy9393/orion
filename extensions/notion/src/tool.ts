/**
 * @file tool.ts
 * @description Notion workspace integration — search, read, write pages.
 *
 * ARCHITECTURE / INTEGRATION:
 *   API: https://developers.notion.com/reference
 *   Uses Notion API v2022-06-28 via native fetch.
 */

import { createLogger } from "../../../src/logger.js"

const log = createLogger("ext.notion")
const API = "https://api.notion.com/v1"
const VER = "2022-06-28"

type RichText = { plain_text: string }
type Block = { type: string; [key: string]: unknown }
type PageResult = {
  id: string
  url: string
  properties?: Record<string, unknown>
  title?: RichText[]
}

export class NotionTool {
  constructor(private readonly key: string) {}

  private get h(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.key}`,
      "Notion-Version": VER,
      "Content-Type": "application/json",
    }
  }

  async searchPages(
    query: string,
    limit = 10,
  ): Promise<Array<{ id: string; title: string; url: string }>> {
    const r = await fetch(`${API}/search`, {
      method: "POST",
      headers: this.h,
      body: JSON.stringify({ query, page_size: limit }),
    })
    if (!r.ok) throw new Error(`Notion search failed: ${r.status}`)
    const d = (await r.json()) as { results: PageResult[] }
    return d.results.map((p) => ({
      id: p.id,
      title: this.title(p),
      url: p.url,
    }))
  }

  async getPage(
    id: string,
  ): Promise<{ title: string; content: string; url: string }> {
    const [page, blocks] = await Promise.all([
      fetch(`${API}/pages/${id}`, { headers: this.h }).then(
        (r) => r.json() as Promise<PageResult>,
      ),
      fetch(`${API}/blocks/${id}/children`, { headers: this.h }).then(
        (r) => r.json() as Promise<{ results: Block[] }>,
      ),
    ])
    return {
      title: this.title(page),
      content: this.blocksText(blocks.results),
      url: page.url,
    }
  }

  async appendToPage(id: string, text: string): Promise<void> {
    await fetch(`${API}/blocks/${id}/children`, {
      method: "PATCH",
      headers: this.h,
      body: JSON.stringify({
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: text } }],
            },
          },
        ],
      }),
    })
    log.debug("appended", { id, len: text.length })
  }

  async createPage(
    dbId: string,
    title: string,
    content: string,
  ): Promise<string> {
    const r = await fetch(`${API}/pages`, {
      method: "POST",
      headers: this.h,
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: { title: { title: [{ text: { content: title } }] } },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content } }],
            },
          },
        ],
      }),
    })
    if (!r.ok) throw new Error(`Notion create failed: ${r.status}`)
    return ((await r.json()) as { id: string }).id
  }

  private title(p: PageResult): string {
    if (p.properties) {
      for (const v of Object.values(p.properties)) {
        const prop = v as { type?: string; title?: RichText[] }
        if (prop.type === "title" && prop.title?.[0])
          return prop.title[0].plain_text
      }
    }
    return p.title?.[0]?.plain_text ?? "Untitled"
  }

  private blocksText(blocks: Block[]): string {
    return blocks
      .map((b) => {
        const content = b[b.type as string] as
          | { rich_text?: RichText[] }
          | undefined
        return content?.rich_text?.map((t) => t.plain_text).join("") ?? ""
      })
      .filter(Boolean)
      .join("\n")
  }
}
