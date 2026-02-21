import config from "../config.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.imessage")

export class IMessageChannel implements BaseChannel {
  readonly name = "imessage"
  private running = false
  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  async start(): Promise<void> {
    if (!config.BLUEBUBBLES_URL.trim() || !config.BLUEBUBBLES_PASSWORD.trim()) {
      log.info("iMessage disabled: missing BLUEBUBBLES_URL or BLUEBUBBLES_PASSWORD")
      return
    }

    this.running = true
    log.info("iMessage channel started")
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
      const rendered = markdownProcessor.process(message, "imessage")
      const endpoint = `${config.BLUEBUBBLES_URL.replace(/\/$/, "")}/api/v1/message/send`

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.BLUEBUBBLES_PASSWORD}`,
        },
        body: JSON.stringify({
          chatGuid: userId,
          message: rendered,
        }),
      })

      if (!response.ok) {
        log.warn("iMessage send failed", { status: response.status })
        return false
      }

      return true
    } catch (error) {
      log.error("iMessage send error", { error })
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

export const iMessageChannel = new IMessageChannel()
