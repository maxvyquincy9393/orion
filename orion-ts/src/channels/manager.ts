import type { BaseChannel } from "./base.js"
import { WebChatChannel } from "./webchat.js"
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

    await webchat.start()

    sandbox.setChannelManager({
      sendWithConfirm: async (userId: string, message: string, action: string) => {
        const channel = this.channels.get("webchat")
        if (channel) {
          return channel.sendWithConfirm(userId, message, action)
        }
        return false
      },
    })

    this.initialized = true
    log.info("channel manager initialized")
  }

  async send(userId: string, message: string): Promise<boolean> {
    const webchat = this.channels.get("webchat")
    if (webchat) {
      return webchat.send(userId, message)
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
