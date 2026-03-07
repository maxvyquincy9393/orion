import config from "../config.js"
import { handleIncomingUserMessage } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import { multiUser } from "../multiuser/manager.js"
import type { BaseChannel } from "./base.js"
import { pollForConfirm, splitMessage } from "./base.js"

const log = createLogger("channels.discord")

const DISCORD_MESSAGE_MAX_CHARS = 1900
const DISCORD_RETRY_DELAY_MS = 2000

type DiscordClientLike = {
  on: (event: string, listener: (...args: unknown[]) => void) => void
  once: (event: string, listener: (...args: unknown[]) => void) => void
  login: (token: string) => Promise<string>
  destroy: () => void
  user?: { tag?: string; id?: string } | null
  channels: {
    fetch: (id: string) => Promise<DiscordTextChannelLike | null>
  }
}

type DiscordTextChannelLike = {
  id?: string
  isTextBased?: () => boolean
  send: (payload: string | { content: string }) => Promise<unknown>
}

type DiscordMessageLike = {
  content?: string
  author?: {
    id?: string
    bot?: boolean
    username?: string
  }
  channel?: {
    id?: string
    isDMBased?: () => boolean
    send?: (payload: string | { content: string }) => Promise<unknown>
    sendTyping?: () => Promise<unknown>
  }
  channelId?: string
  guildId?: string | null
}

interface QueuedReply {
  content: string
  ts: number
}

interface DiscordInboundMessage {
  channelId: string
  authorId: string
  authorIsBot: boolean
  text: string
  isDm: boolean
}

function parseAllowedDiscordChannelIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function normalizeDiscordCommand(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const token = trimmed.split(/\s+/, 1)[0] ?? ""
  if (!token.startsWith("!") && !token.startsWith("/")) {
    return null
  }

  const command = token.slice(1).toLowerCase()
  return command || null
}

function toDiscordEdithUserId(authorId: string): string {
  return `discord:${authorId}`
}

function toDiscordChannelTargetId(channelId: string): string {
  return `discord:channel:${channelId}`
}

function parseDiscordChannelTargetId(userId: string): string | null {
  if (!userId) {
    return null
  }
  if (userId.startsWith("discord:channel:")) {
    const channelId = userId.slice("discord:channel:".length).trim()
    return channelId || null
  }
  return null
}

function extractDiscordInboundMessage(message: DiscordMessageLike): DiscordInboundMessage | null {
  const text = typeof message.content === "string" ? message.content.trim() : ""
  const authorId = typeof message.author?.id === "string" ? message.author.id : ""
  const channelId =
    (typeof message.channelId === "string" ? message.channelId : "") ||
    (typeof message.channel?.id === "string" ? message.channel.id : "")

  if (!text || !authorId || !channelId) {
    return null
  }

  return {
    channelId,
    authorId,
    authorIsBot: Boolean(message.author?.bot),
    text,
    isDm: typeof message.channel?.isDMBased === "function" ? Boolean(message.channel.isDMBased()) : !message.guildId,
  }
}

function isDiscordDmAllowed(channelId: string, isDm: boolean, allowlist: Set<string>): boolean {
  if (allowlist.size > 0) {
    return allowlist.has(channelId)
  }
  return isDm
}

export class DiscordChannel implements BaseChannel {
  readonly name = "discord"

  private running = false
  private connected = false
  private client: DiscordClientLike | null = null
  private readonly replies = new Map<string, QueuedReply[]>()
  private readonly inboundChains = new Map<string, Promise<void>>()
  private readonly deniedNoticeSent = new Set<string>()
  private allowlistedChannelIds = new Set<string>()
  private reconnectTimer: NodeJS.Timeout | null = null

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    if (!config.DISCORD_BOT_TOKEN.trim()) {
      log.info("Discord disabled: missing DISCORD_BOT_TOKEN")
      return
    }

    this.allowlistedChannelIds = parseAllowedDiscordChannelIds(config.DISCORD_CHANNEL_ID)

    try {
      const discord = await import("discord.js")
      const client = new discord.Client({
        intents: [
          discord.GatewayIntentBits.Guilds,
          discord.GatewayIntentBits.GuildMessages,
          discord.GatewayIntentBits.DirectMessages,
          discord.GatewayIntentBits.MessageContent,
        ],
        partials: [discord.Partials.Channel],
      }) as unknown as DiscordClientLike

      client.on("ready", () => {
        this.connected = true
        log.info("Discord channel connected", {
          botTag: client.user?.tag ?? null,
          allowlistSize: this.allowlistedChannelIds.size,
        })
      })

      client.on("error", (error) => {
        log.warn("Discord client error", { error })
      })

      client.on("messageCreate", (message) => {
        void this.handleDiscordMessage(message as DiscordMessageLike)
      })

      client.on("shardDisconnect", () => {
        this.connected = false
      })

      client.on("shardResume", () => {
        this.connected = true
      })

      client.on("invalidated", () => {
        this.connected = false
        log.error("Discord client session invalidated")
      })

      this.client = client
      this.running = true
      this.connected = false

      await client.login(config.DISCORD_BOT_TOKEN)
    } catch (error) {
      this.running = false
      this.connected = false
      this.client = null
      log.error("Discord failed to start", { error })
    }
  }

  async stop(): Promise<void> {
    this.running = false
    this.connected = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.client) {
      try {
        this.client.destroy()
      } catch (error) {
        log.warn("Discord destroy failed", { error })
      } finally {
        this.client = null
      }
    }
    this.inboundChains.clear()
  }

  isConnected(): boolean {
    return this.running && this.connected && this.client !== null
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.client || !this.running) {
      return false
    }

    const channelId = this.resolveSendChannelId(userId)
    if (!channelId) {
      log.warn("Discord send skipped: no target channel resolved", { userId })
      return false
    }

    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel || (typeof channel.isTextBased === "function" && !channel.isTextBased())) {
        log.warn("Discord send skipped: channel not text-based", { channelId })
        return false
      }

      const rendered = markdownProcessor.process(message, "discord")
      const chunks = splitMessage(rendered, DISCORD_MESSAGE_MAX_CHARS)
      for (const chunk of chunks) {
        await channel.send({ content: chunk })
      }
      return true
    } catch (error) {
      log.error("Discord send failed", { channelId, error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    const channelId = this.resolveSendChannelId(userId)
    if (!channelId) {
      return false
    }
    await this.send(toDiscordChannelTargetId(channelId), `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(channelId), 60_000, 3000)
  }

  private resolveSendChannelId(userId: string): string | null {
    const explicit = parseDiscordChannelTargetId(userId)
    if (explicit) {
      return explicit
    }

    if (config.DISCORD_CHANNEL_ID.trim()) {
      const firstConfigured = parseAllowedDiscordChannelIds(config.DISCORD_CHANNEL_ID)
      const [first] = firstConfigured
      if (first) {
        return first
      }
    }

    if (this.allowlistedChannelIds.size === 1) {
      const [only] = this.allowlistedChannelIds
      return only ?? null
    }

    return null
  }

  private async handleDiscordMessage(message: DiscordMessageLike): Promise<void> {
    const inbound = extractDiscordInboundMessage(message)
    if (!inbound || inbound.authorIsBot) {
      return
    }

    if (!isDiscordDmAllowed(inbound.channelId, inbound.isDm, this.allowlistedChannelIds)) {
      await this.maybeNotifyDeniedChannel(message, inbound.channelId)
      return
    }

    this.enqueueReply(inbound.channelId, inbound.text)

    const command = normalizeDiscordCommand(inbound.text)
    if (command) {
      await this.handleCommand(message, inbound.channelId, command)
      return
    }

    this.enqueueInboundProcessing(message, inbound)
  }

  private enqueueInboundProcessing(message: DiscordMessageLike, inbound: DiscordInboundMessage): void {
    const current = this.inboundChains.get(inbound.channelId) ?? Promise.resolve()
    const next = current
      .catch(() => undefined)
      .then(async () => {
        await this.sendTypingIndicator(message)

        const edithUserId = toDiscordEdithUserId(inbound.authorId)
        await multiUser.getOrCreate(edithUserId, "discord")

        try {
          const response = await handleIncomingUserMessage(edithUserId, inbound.text, "discord")
          await this.send(toDiscordChannelTargetId(inbound.channelId), response)
        } catch (error) {
          log.error("Discord inbound processing failed", { channelId: inbound.channelId, error })
          await this.safeChannelSend(message, "Maaf, prosesnya gagal. Coba kirim ulang pesanmu.")
        }
      })
      .finally(() => {
        if (this.inboundChains.get(inbound.channelId) === next) {
          this.inboundChains.delete(inbound.channelId)
        }
      })

    this.inboundChains.set(inbound.channelId, next)
  }

  private async handleCommand(message: DiscordMessageLike, channelId: string, command: string): Promise<void> {
    if (command === "help" || command === "start") {
      await this.safeChannelSend(message, [
        "EDITH Discord test channel ready.",
        "",
        "Commands:",
        "!help or /help",
        "!id or /id",
        "!ping or /ping",
        "",
        "Send any text message to chat with EDITH.",
      ].join("\n"))
      return
    }

    if (command === "id") {
      await this.safeChannelSend(message, `channel_id=${channelId}`)
      return
    }

    if (command === "ping") {
      await this.safeChannelSend(message, "pong")
      return
    }
  }

  private async maybeNotifyDeniedChannel(message: DiscordMessageLike, channelId: string): Promise<void> {
    if (this.deniedNoticeSent.has(channelId)) {
      return
    }
    this.deniedNoticeSent.add(channelId)

    const hint = this.allowlistedChannelIds.size > 0
      ? "This channel is not in DISCORD_CHANNEL_ID allowlist."
      : "Discord guild channels are disabled by default. Add channel id to DISCORD_CHANNEL_ID or use a DM."

    await this.safeChannelSend(message, `${hint}\nUse !id in an allowed channel/DM to copy the channel id.`)
  }

  private async safeChannelSend(message: DiscordMessageLike, content: string): Promise<void> {
    if (typeof message.channel?.send !== "function") {
      return
    }
    try {
      const chunks = splitMessage(content, DISCORD_MESSAGE_MAX_CHARS)
      for (const chunk of chunks) {
        await message.channel.send({ content: chunk })
      }
    } catch (error) {
      if (!this.running) {
        return
      }
      log.warn("Discord channel send failed", { error })
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
        }, DISCORD_RETRY_DELAY_MS)
      }
    }
  }

  private async sendTypingIndicator(message: DiscordMessageLike): Promise<void> {
    if (typeof message.channel?.sendTyping !== "function") {
      return
    }

    try {
      await message.channel.sendTyping()
    } catch (error) {
      log.debug("Discord typing indicator failed", { error })
    }
  }

  private enqueueReply(channelId: string, content: string): void {
    const queue = this.replies.get(channelId) ?? []
    queue.push({ content, ts: Date.now() })
    if (queue.length > 50) {
      queue.splice(0, queue.length - 50)
    }
    this.replies.set(channelId, queue)
  }

  private async getLatestReply(channelId: string, sinceSeconds = 60): Promise<string | null> {
    const queue = this.replies.get(channelId)
    if (!queue || queue.length === 0) {
      return null
    }

    const cutoff = Date.now() - (sinceSeconds * 1000)
    const recent = queue.filter((entry) => entry.ts >= cutoff)
    if (recent.length === 0) {
      return null
    }

    const latest = recent[recent.length - 1]
    const index = queue.indexOf(latest)
    if (index >= 0) {
      queue.splice(index, 1)
    }
    return latest.content
  }
}

export const discordChannel = new DiscordChannel()

export const __discordTestUtils = {
  parseAllowedDiscordChannelIds,
  normalizeDiscordCommand,
  toDiscordEdithUserId,
  toDiscordChannelTargetId,
  parseDiscordChannelTargetId,
  extractDiscordInboundMessage,
  isDiscordDmAllowed,
}
