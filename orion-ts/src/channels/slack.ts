import { App, SocketModeHandler } from "@slack/bolt"
import { BaseChannel } from "./base"
import config from "../config"

interface StoredMessage {
  content: string
  ts: number
}

export class SlackChannel implements BaseChannel {
  readonly name = "slack"
  private app: App
  private handler: SocketModeHandler | null = null
  private latestMessages: Map<string, StoredMessage> = new Map()
  private running = false

  constructor() {
    this.app = new App({
      token: config.SLACK_BOT_TOKEN,
      appToken: config.SLACK_APP_TOKEN,
    })

    this.app.message(async ({ message, say }) => {
      if (message.channel_type === "im" && message.text) {
        this.latestMessages.set(message.channel, {
          content: message.text,
          ts: Date.now(),
        })
      }
    })
  }

  async start(): Promise<void> {
    this.handler = new SocketModeHandler(this.app, config.SLACK_APP_TOKEN)
    this.handler.start().catch((err) => {
      console.error("[SlackChannel] Handler error:", err)
      this.running = false
    })
    this.running = true
  }

  async send(userId: string, message: string): Promise<boolean> {
    const chunks = this.splitMessage(message, 3000)
    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({
        channel: userId,
        text: chunk,
      })
    }
    return true
  }

  async sendWithConfirm(
    userId: string,
    message: string,
    action: string
  ): Promise<boolean> {
    const promptText = `${message}\n\n${action}\nReply with YES to confirm or NO to cancel.`
    await this.send(userId, promptText)

    const startTime = Date.now()
    const timeout = 60000

    while (Date.now() - startTime < timeout) {
      await this.sleep(2000)
      const reply = await this.getLatestReply(userId, 60)
      if (reply) {
        const normalized = reply.trim().toLowerCase()
        if (normalized.startsWith("yes")) {
          return true
        }
        if (normalized.startsWith("no")) {
          return false
        }
      }
    }
    return false
  }

  async getLatestReply(userId: string, sinceSeconds = 60): Promise<string | null> {
    const stored = this.latestMessages.get(userId)
    if (!stored) {
      return null
    }
    const cutoff = Date.now() - sinceSeconds * 1000
    if (stored.ts < cutoff) {
      return null
    }
    return stored.content
  }

  async stop(): Promise<void> {
    if (this.handler) {
      await this.handler.stop()
    }
    this.running = false
  }

  isConnected(): boolean {
    return this.running
  }

  private splitMessage(message: string, maxLength: number): string[] {
    if (message.length <= maxLength) {
      return [message]
    }
    const chunks: string[] = []
    let remaining = message
    while (remaining.length > maxLength) {
      chunks.push(remaining.slice(0, maxLength))
      remaining = remaining.slice(maxLength)
    }
    if (remaining.length > 0) {
      chunks.push(remaining)
    }
    return chunks
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
