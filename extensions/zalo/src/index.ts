/**
 * @file index.ts
 * @description Zalo integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Zalo OA (Official Account) messaging channel for Vietnamese users.
 *   Requires Zalo OA credentials and webhook configuration.
 */

import { createLogger } from "../../../src/logger.js"
import type { Hook } from "../../../src/hooks/registry.js"
import { ZaloChannel } from "./channel.js"

export { ZaloChannel } from "./channel.js"
export type { ZaloConfig, ZaloMessage } from "./channel.js"

export const name = "zalo"
export const version = "0.1.0"
export const description = "Zalo OA messaging channel for Vietnamese users"

const log = createLogger("ext.zalo")
let channel: ZaloChannel | null = null

export const hooks: Hook[] = []

export async function onLoad(): Promise<void> {
  const token = process.env.ZALO_ACCESS_TOKEN
  const oaId = process.env.ZALO_OA_ID
  if (!token || !oaId) {
    log.debug("ZALO_ACCESS_TOKEN or ZALO_OA_ID not set — skipping")
    return
  }
  channel = new ZaloChannel({
    accessToken: token,
    oaId,
    webhookSecret: process.env.ZALO_WEBHOOK_SECRET,
  })
  log.info("Zalo channel loaded", { oaId })
}

export function getChannel(): ZaloChannel | null {
  return channel
}
