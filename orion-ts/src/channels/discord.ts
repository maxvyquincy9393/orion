import { Client, GatewayIntentBits, Partials, TextChannel } from "discord.js"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { BaseChannel } from "./base.js"

type StoredMessage = { content: string; ts: number }

const logger = createLogger("discord-channel")

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

export class DiscordChannel implements BaseChannel {
  readonly name = "discord"
  private readonly client: Client
  private readonly latestMessages = new Map<string, StoredMessage[]>()
  private ready = false

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    })

    this.client.on("ready", () => {
      this.ready = true
      const username = this.client.user?.username ?? "unknown"
      logger.info(`Discord bot ready as ${username}`)
    })

    this.client.on("messageCreate", (message) => {
      if (message.author?.bot) {
        return
      }

      const userId = message.author?.id
      if (!userId) {
        return
      }

      const current = this.latestMessages.get(userId) ?? []
      current.push({ content: message.content, ts: Date.now() })
      this.latestMessages.set(userId, current)
    })
  }

  async start(): Promise<void> {
    const token = config.DISCORD_BOT_TOKEN
    if (!token) {
      throw new Error("DISCORD_BOT_TOKEN is missing")
    }

    await this.client.login(token)

    await new Promise<void>((resolve) => {
      if (this.ready) {
        resolve()
        return
      }
      this.client.once("ready", () => resolve())
    })
  }

  isConnected(): boolean {
    return this.ready
  }

  async send(userId: string, message: string): Promise<boolean> {
    try {
      const chunks = splitMessage(message, 2000)
      let sent = false

      try {
        const user = await this.client.users.fetch(userId)
        const dm = await user.createDM()
        for (const chunk of chunks) {
          await dm.send(chunk)
        }
        sent = true
      } catch (error) {
        logger.warn("Failed to DM user, falling back to channel", error)
      }

      if (!sent) {
        const channelId = config.DISCORD_CHANNEL_ID
        if (!channelId) {
          throw new Error("DISCORD_CHANNEL_ID is missing")
        }

        const channel = await this.client.channels.fetch(channelId)
        if (!channel || !(channel instanceof TextChannel)) {
          throw new Error("Discord channel is not a text channel")
        }

        for (const chunk of chunks) {
          await channel.send(chunk)
        }
      }

      return true
    } catch (error) {
      logger.error("Failed to send Discord message", error)
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    const prompt = `${message}\n\nReply YES to confirm or NO to cancel.`
    await this.send(userId, prompt)

    const startTime = Date.now()
    const timeoutMs = 60_000

    while (Date.now() - startTime < timeoutMs) {
      const reply = await this.getLatestReply(userId, 60)
      if (reply) {
        const normalized = reply.trim().toLowerCase()
        if (normalized.includes("yes")) {
          logger.info(`Discord action confirmed: ${action}`)
          return true
        }
        if (normalized.includes("no")) {
          logger.info(`Discord action canceled: ${action}`)
          return false
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    return false
  }

  async getLatestReply(userId: string, sinceSeconds = 60): Promise<string | null> {
    const messages = this.latestMessages.get(userId)
    if (!messages || messages.length === 0) {
      return null
    }

    const cutoff = Date.now() - sinceSeconds * 1000
    const recent = messages.filter((entry) => entry.ts >= cutoff)
    if (recent.length === 0) {
      return null
    }

    return recent[recent.length - 1].content
  }

  async stop(): Promise<void> {
    this.ready = false
    this.client.destroy()
  }
}

export default DiscordChannel
