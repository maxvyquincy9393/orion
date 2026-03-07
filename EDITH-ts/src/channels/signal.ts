import { execa } from "execa"

import config from "../config.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"

const log = createLogger("channels.signal")

export class SignalChannel implements BaseChannel {
  readonly name = "signal"
  private running = false
  private readonly replies = new Map<string, Array<{ content: string; ts: number }>>()

  async start(): Promise<void> {
    if (!config.SIGNAL_CLI_PATH.trim() || !config.SIGNAL_PHONE_NUMBER.trim()) {
      log.info("Signal disabled: missing SIGNAL_CLI_PATH or SIGNAL_PHONE_NUMBER")
      return
    }

    this.running = true
    log.info("Signal channel started")
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
      const rendered = markdownProcessor.process(message, "signal")
      const chunks = splitMessage(rendered, 1800)
      for (const chunk of chunks) {
        await execa(config.SIGNAL_CLI_PATH, ["-a", config.SIGNAL_PHONE_NUMBER, "send", "-m", chunk, userId], {
          timeout: 20_000,
        })
      }
      return true
    } catch (error) {
      log.error("Signal send failed", { userId, error })
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

export const signalChannel = new SignalChannel()
