import type { BaseChannel } from "./base.js"
import { WebChatChannel } from "./webchat.js"
import { whatsAppChannel } from "./whatsapp.js"
import { signalChannel } from "./signal.js"
import { lineChannel } from "./line.js"
import { matrixChannel } from "./matrix.js"
import { teamsChannel } from "./teams.js"
import { iMessageChannel } from "./imessage.js"
import { createLogger } from "../logger.js"
import config from "../config.js"
import { sandbox } from "../permissions/sandbox.js"

const log = createLogger("channels.manager")

export class ChannelManager {
  private channels = new Map<string, BaseChannel>()
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    const webchat = new WebChatChannel()
    this.channels.set("webchat", webchat)
    this.channels.set("whatsapp", whatsAppChannel)
    this.channels.set("signal", signalChannel)
    this.channels.set("line", lineChannel)
    this.channels.set("matrix", matrixChannel)
    this.channels.set("teams", teamsChannel)
    this.channels.set("imessage", iMessageChannel)

    for (const [name, channel] of this.channels) {
      try {
        await channel.start()
      } catch (error) {
        log.warn("channel failed to start", { name, error })
      }
    }

    sandbox.setChannelManager({
      sendWithConfirm: async (userId: string, message: string, action: string) => {
        for (const [, channel] of this.channels) {
          if (channel.isConnected()) {
            return channel.sendWithConfirm(userId, message, action)
          }
        }
        return false
      },
    })

    this.initialized = true
    log.info("channel manager initialized")
  }

  async send(userId: string, message: string): Promise<boolean> {
    const priorityOrder = ["webchat", "whatsapp", "signal", "line", "matrix", "teams", "imessage"]
    for (const name of priorityOrder) {
      const channel = this.channels.get(name)
      if (!channel || !channel.isConnected()) {
        continue
      }

      const sent = await channel.send(userId, message)
      if (sent) {
        return true
      }
    }

    return false
  }

  async broadcast(message: string): Promise<void> {
    for (const [, channel] of this.channels) {
      try {
        await channel.send(config.DEFAULT_USER_ID, message)
      } catch (error) {
        log.error("broadcast failed for channel", error)
      }
    }
  }

  getConnectedChannels(): string[] {
    const connected: string[] = []
    for (const [name, channel] of this.channels) {
      if (channel.isConnected()) {
        connected.push(name)
      }
    }
    return connected
  }

  getChannel(name: string): BaseChannel | undefined {
    return this.channels.get(name)
  }

  async stop(): Promise<void> {
    for (const [, channel] of this.channels) {
      try {
        await channel.stop()
      } catch (error) {
        log.error("failed to stop channel", error)
      }
    }
    this.channels.clear()
    this.initialized = false
    log.info("all channels stopped")
  }
}

export const channelManager = new ChannelManager()
