/**
 * @file index.ts
 * @description Home Assistant integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Connects to a Home Assistant instance via the REST API.
 *   Provides entity state queries, service calls, and automation triggers.
 */

import { createLogger } from "../../../src/logger.js"
import type { Hook } from "../../../src/hooks/registry.js"
import { HomeAssistantTool } from "./tool.js"

export { HomeAssistantTool } from "./tool.js"
export type { HAEntity, HAConfig, HAServiceCall } from "./tool.js"

export const name = "home-assistant"
export const version = "0.1.0"
export const description = "Home Assistant — entity states, service calls, automation"

const log = createLogger("ext.home-assistant")
let tool: HomeAssistantTool | null = null

export const hooks: Hook[] = []

export async function onLoad(): Promise<void> {
  const url = process.env.HA_BASE_URL
  const token = process.env.HA_TOKEN
  if (!url || !token) {
    log.debug("HA_BASE_URL or HA_TOKEN not set — skipping")
    return
  }
  tool = new HomeAssistantTool({ baseUrl: url, token })
  const online = await tool.isOnline()
  log.info(online ? "Home Assistant connected" : "Home Assistant unreachable", {
    url,
  })
}

export function getTool(): HomeAssistantTool | null {
  return tool
}
