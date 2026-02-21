import crypto from "node:crypto"

import config from "../config.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.matrix")

export class MatrixChannel implements BaseChannel {
  readonly name = "matrix"
  private running = false
  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  async start(): Promise<void> {
    if (!config.MATRIX_HOMESERVER.trim() || !config.MATRIX_ACCESS_TOKEN.trim() || !config.MATRIX_ROOM_ID.trim()) {
      log.info("Matrix disabled: missing MATRIX_HOMESERVER/MATRIX_ACCESS_TOKEN/MATRIX_ROOM_ID")
      return
    }

    this.running = true
    log.info("Matrix channel started")
  }

  async stop(): Promise<void> {
    this.running = false
  }

  isConnected(): boolean {
    return this.running
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.running) {
      return false
    }

    try {
      const rendered = markdownProcessor.process(message, "matrix")
      const roomId = userId || config.MATRIX_ROOM_ID
      const txnId = crypto.randomUUID()
      const endpoint = `${config.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`

      const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.MATRIX_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          msgtype: "m.text",
          body: rendered,
        }),
      })

      if (!response.ok) {
        log.warn("Matrix send failed", { status: response.status, roomId })
        return false
      }

      return true
    } catch (error) {
      log.error("Matrix send error", { error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(userId), 60_000, 3000)
  }

  private async getLatestReply(userId: string): Promise<string | null> {
    const queue = this.replies.get(userId)
    if (!queue || queue.length === 0) {
      return null
    }

    const latest = queue.pop()
    return latest?.content ?? null
  }
}

export const matrixChannel = new MatrixChannel()
