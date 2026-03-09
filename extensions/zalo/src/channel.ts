/**
 * @file channel.ts
 * @description Zalo OA (Official Account) channel — Vietnamese messaging platform.
 *
 * ARCHITECTURE / INTEGRATION:
 *   API: https://developers.zalo.me/docs/api/official-account-api
 *   Provides send, getUserProfile, webhook verification and parsing.
 */

import { createHmac } from "node:crypto"

import { createLogger } from "../../../src/logger.js"

const log = createLogger("ext.zalo")

export interface ZaloConfig {
  accessToken: string
  oaId: string
  webhookSecret?: string
}

export interface ZaloMessage {
  sender: { id: string }
  message: { text: string; mid: string }
  timestamp: number
}

export class ZaloChannel {
  private readonly BASE = "https://openapi.zalo.me/v3.0"

  constructor(private readonly cfg: ZaloConfig) {}

  private get headers(): Record<string, string> {
    return {
      access_token: this.cfg.accessToken,
      "Content-Type": "application/json",
    }
  }

  async send(recipientId: string, text: string): Promise<void> {
    const res = await fetch(`${this.BASE}/oa/message/cs`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        recipient: { user_id: recipientId },
        message: { text },
      }),
    })
    if (!res.ok) throw new Error(`Zalo send failed: ${res.status}`)
    log.debug("sent", { recipientId, len: text.length })
  }

  async getUserProfile(
    userId: string,
  ): Promise<{ name: string; avatar: string } | null> {
    try {
      const res = await fetch(
        `${this.BASE}/oa/getprofile?user_id=${encodeURIComponent(userId)}`,
        { headers: this.headers },
      )
      if (!res.ok) return null
      const d = (await res.json()) as {
        data?: { display_name: string; avatar: string }
      }
      return d.data
        ? { name: d.data.display_name, avatar: d.data.avatar }
        : null
    } catch {
      return null
    }
  }

  verifyWebhook(body: string, sig: string): boolean {
    if (!this.cfg.webhookSecret) return true
    const expected = createHmac("sha256", this.cfg.webhookSecret)
      .update(body)
      .digest("hex")
    return expected === sig
  }

  parseWebhook(body: unknown): ZaloMessage | null {
    try {
      const p = body as {
        entry?: Array<{ messaging?: ZaloMessage[] }>
      }
      return p?.entry?.[0]?.messaging?.[0] ?? null
    } catch {
      return null
    }
  }
}
