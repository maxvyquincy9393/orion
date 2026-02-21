import config from "../config.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.line")

export class LineChannel implements BaseChannel {
  readonly name = "line"
  private running = false
  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  async start(): Promise<void> {
    if (!config.LINE_CHANNEL_TOKEN.trim() || !config.LINE_CHANNEL_SECRET.trim()) {
      log.info("LINE disabled: missing LINE_CHANNEL_TOKEN or LINE_CHANNEL_SECRET")
      return
    }
    this.running = true
    log.info("LINE channel started")
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
      const rendered = markdownProcessor.process(message, "line")
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.LINE_CHANNEL_TOKEN}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: "text", text: rendered.slice(0, 4000) }],
        }),
      })

      if (!response.ok) {
        log.warn("LINE send failed", { status: response.status, userId })
        return false
      }

      return true
    } catch (error) {
      log.error("LINE send error", { userId, error })
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

export const lineChannel = new LineChannel()
