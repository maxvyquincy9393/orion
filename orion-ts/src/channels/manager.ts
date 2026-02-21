import config from "../config.js"
import { createLogger } from "../logger.js"
import type { BaseChannel } from "./base.js"
import { DiscordChannel } from "./discord.js"
import { SlackChannel } from "./slack.js"
import { TelegramChannel } from "./telegram.js"
import { WhatsAppChannel } from "./whatsapp.js"

const logger = createLogger("channel-manager")

class WebChatChannel implements BaseChannel {
  readonly name = "webchat"
  private connected = false

  async start(): Promise<void> {
    this.connected = true
  }

  async stop(): Promise<void> {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  async send(userId: string, message: string): Promise<boolean> {
    return true
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    await this.send(userId, `${message}\n\n${action}`)
    return false
  }

  async getLatestReply(userId: string, sinceSeconds = 60): Promise<string | null> {
    return null
  }
}

export class ChannelManager {
  private channels = new Map<string, BaseChannel>()

  async init(): Promise<void> {
    await this.addChannel(new WebChatChannel())

    if (config.DISCORD_BOT_TOKEN) {
      await this.addChannel(new DiscordChannel())
    }

    if (config.TELEGRAM_BOT_TOKEN) {
      await this.addChannel(new TelegramChannel())
    }

    if (config.SLACK_BOT_TOKEN && config.SLACK_APP_TOKEN) {
      await this.addChannel(new SlackChannel())
    }

    if (config.WHATSAPP_ENABLED) {
      await this.addChannel(new WhatsAppChannel())
    }

    logger.info(`Connected channels: ${this.getConnectedChannels().join(", ")}`)
  }

  async send(userId: string, message: string, channel?: string): Promise<boolean> {
    if (channel) {
      const target = this.channels.get(channel)
      if (!target || !target.isConnected()) {
        return false
      }
      return target.send(userId, message)
    }

    const results = await Promise.all(
      this.getConnectedChannelInstances().map((target) => target.send(userId, message)),
    )
    return results.some(Boolean)
  }

  async sendWithConfirm(
    userId: string,
    message: string,
    action: string,
    channel?: string,
  ): Promise<boolean> {
    if (channel) {
      const target = this.channels.get(channel)
      if (!target || !target.isConnected()) {
        return false
      }
      return target.sendWithConfirm(userId, message, action)
    }

    for (const target of this.getConnectedChannelInstances()) {
      const result = await target.sendWithConfirm(userId, message, action)
      if (result) {
        return true
      }
    }

    return false
  }

  async getLatestReply(
    userId: string,
    sinceSeconds = 60,
    channel?: string,
  ): Promise<string | null> {
    if (channel) {
      const target = this.channels.get(channel)
      if (!target || !target.isConnected()) {
        return null
      }
      return target.getLatestReply(userId, sinceSeconds)
    }

    for (const target of this.getConnectedChannelInstances()) {
      const reply = await target.getLatestReply(userId, sinceSeconds)
      if (reply) {
        return reply
      }
    }

    return null
  }

  getConnectedChannels(): string[] {
    return this.getConnectedChannelInstances().map((channel) => channel.name)
  }

  async broadcast(message: string): Promise<boolean> {
    return this.send(config.DEFAULT_USER_ID, message)
  }

  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop()
    }
  }

  private async addChannel(channel: BaseChannel): Promise<void> {
    try {
      await channel.start()
      if (channel.isConnected()) {
        this.channels.set(channel.name, channel)
      }
    } catch (error) {
      logger.warn(`Failed to start channel ${channel.name}`, error)
    }
  }

  private getConnectedChannelInstances(): BaseChannel[] {
    return Array.from(this.channels.values()).filter((channel) => channel.isConnected())
  }
}

export const channelManager = new ChannelManager()
