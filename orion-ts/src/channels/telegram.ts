import { Bot, InlineKeyboard } from "grammy"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { BaseChannel } from "./base.js"

type StoredMessage = { content: string; ts: number }

const logger = createLogger("telegram-channel")

function splitMessage(message: string, maxLength: number): string[] {
  if (message.length <= maxLength) {
    return [message]
  }

  const chunks: string[] = []
  let start = 0
  while (start < message.length) {
    chunks.push(message.slice(start, start + maxLength))
    start += maxLength
  }
  return chunks
}

export class TelegramChannel implements BaseChannel {
  readonly name = "telegram"
  private readonly bot: Bot
  private readonly latestMessages = new Map<string, StoredMessage>()
  private running = false

  constructor() {
    const token = config.TELEGRAM_BOT_TOKEN
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN is missing")
    }

    this.bot = new Bot(token)

    this.bot.on("message:text", (ctx) => {
      const userId = ctx.from?.id?.toString() ?? "unknown"
      this.latestMessages.set(userId, {
        content: ctx.message.text,
        ts: Date.now(),
      })
    })
  }

  async start(): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
    this.bot.start()
    logger.info("Telegram bot started")
  }

  isConnected(): boolean {
    return this.running
  }

  async send(userId: string, message: string): Promise<boolean> {
    try {
      const chatId = config.TELEGRAM_CHAT_ID
      if (!chatId) {
        throw new Error("TELEGRAM_CHAT_ID is missing")
      }

      const chunks = splitMessage(message, 4096)
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(chatId, chunk)
      }
      return true
    } catch (error) {
      logger.error("Failed to send Telegram message", error)
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    const chatId = config.TELEGRAM_CHAT_ID
    if (!chatId) {
      throw new Error("TELEGRAM_CHAT_ID is missing")
    }

    const keyboard = new InlineKeyboard()
      .text("YES", "confirm_yes")
      .text("NO", "confirm_no")

    await this.bot.api.sendMessage(chatId, message, { reply_markup: keyboard })

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup()
        resolve(false)
      }, 60_000)

      const handler = async (ctx: any) => {
        const data = ctx.callbackQuery?.data
        if (!data) {
          return
        }

        if (data === "confirm_yes") {
          await ctx.answerCallbackQuery({ text: "Confirmed" })
          logger.info(`Telegram action confirmed: ${action}`)
          cleanup()
          resolve(true)
          return
        }

        if (data === "confirm_no") {
          await ctx.answerCallbackQuery({ text: "Canceled" })
          logger.info(`Telegram action canceled: ${action}`)
          cleanup()
          resolve(false)
        }
      }

      const cleanup = () => {
        clearTimeout(timeout)
        if (typeof (this.bot as any).off === "function") {
          ;(this.bot as any).off("callback_query:data", handler)
        }
      }

      this.bot.on("callback_query:data", handler)
    })
  }

  async getLatestReply(userId: string, sinceSeconds = 60): Promise<string | null> {
    const entry = this.latestMessages.get(userId)
    if (!entry) {
      return null
    }

    const cutoff = Date.now() - sinceSeconds * 1000
    if (entry.ts < cutoff) {
      return null
    }

    return entry.content
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return
    }
    this.bot.stop()
    this.running = false
  }
}

export default TelegramChannel
