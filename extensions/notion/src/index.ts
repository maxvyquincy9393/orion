/**
 * @file index.ts
 * @description Notion integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Syncs Notion databases/pages with EDITH's knowledge base.
 *   Provides tools for querying, creating, and updating Notion pages.
 *   Requires NOTION_API_KEY.
 */

import { createLogger } from "../../../src/logger.js"
import type { Hook } from "../../../src/hooks/registry.js"
import { NotionTool } from "./tool.js"

export { NotionTool } from "./tool.js"

export const name = "notion"
export const version = "0.1.0"
export const description = "Notion workspace integration — search, read, write pages"

const log = createLogger("ext.notion")
let tool: NotionTool | null = null

export const hooks: Hook[] = []

export async function onLoad(): Promise<void> {
  const key = process.env.NOTION_API_KEY
  if (!key) {
    log.debug("NOTION_API_KEY not set — skipping")
    return
  }
  tool = new NotionTool(key)
  log.info("Notion tool loaded")
}

export function getTool(): NotionTool | null {
  return tool
}
