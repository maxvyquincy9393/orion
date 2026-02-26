import config from "../config.js"
import { handleIncomingUserMessage } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import { multiUser } from "../multiuser/manager.js"
import type { BaseChannel } from "./base.js"
import { pollForConfirm, splitMessage } from "./base.js"

const log = createLogger("channels.telegram")

const TELEGRAM_API_BASE_URL = "https://api.telegram.org"
const TELEGRAM_SEND_TEXT_MAX = 3500
const TELEGRAM_POLL_TIMEOUT_SECONDS = 30
const TELEGRAM_POLL_HTTP_TIMEOUT_MS = 40_000
const TELEGRAM_API_TIMEOUT_MS = 15_000
const TELEGRAM_RETRY_DELAY_MS = 2000

interface TelegramApiEnvelope<T> {
  ok: boolean
  result: T
  description?: string
  error_code?: number
}

interface TelegramUser {
  id: number
  is_bot?: boolean
  username?: string
}

interface TelegramChat {
  id: number | string
  type?: string
}

interface TelegramMessage {
  message_id?: number
  chat?: TelegramChat
  from?: TelegramUser
  text?: string
}

interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
}

interface TelegramGetMeResult {
  id: number
  is_bot: boolean
  username?: string
}

interface InboundTelegramText {
  updateId: number
  chatId: string
  chatType: string
  fromIsBot: boolean
  text: string
}

interface QueuedReply {
  content: string
  ts: number
}

function parseAllowedTelegramChatIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function toTelegramChannelUserId(chatId: string): string {
  return `telegram:${chatId}`
}

function toTelegramChatId(userId: string): string {
  if (userId.startsWith("telegram:")) {
    return userId.slice("telegram:".length)
  }
  return userId
}

function normalizeTelegramCommand(text: string, botUsername: string | null): string | null {
  const firstToken = text.trim().split(/\s+/, 1)[0] ?? ""
  if (!firstToken.startsWith("/")) {
    return null
  }

  const [command, mention] = firstToken.slice(1).split("@", 2)
  if (!command) {
    return null
  }

  if (mention && botUsername && mention.toLowerCase() !== botUsername.toLowerCase()) {
    return null
  }

  return command.toLowerCase()
}

function extractInboundTelegramText(update: TelegramUpdate): InboundTelegramText | null {
  const updateId = typeof update.update_id === "number" ? update.update_id : null
  const message = update.message
  const text = typeof message?.text === "string" ? message.text : null
  const chatIdRaw = message?.chat?.id
  if (updateId === null || !text || chatIdRaw === undefined || chatIdRaw === null) {
    return null
  }

  return {
    updateId,
    chatId: String(chatIdRaw),
    chatType: typeof message?.chat?.type === "string" ? message.chat.type : "unknown",
    fromIsBot: Boolean(message?.from?.is_bot),
    text,
  }
}

function isTelegramEntityParseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return /parse entities|can't parse/i.test(error.message)
}

function stripTelegramHtml(rendered: string): string {
  return rendered
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
}

export class TelegramChannel implements BaseChannel {
  readonly name = "telegram"

  private running = false
  private connected = false
  private pollTask: Promise<void> | null = null
  private stopController: AbortController | null = null
  private nextUpdateOffset = 0
  private botUsername: string | null = null
  private readonly replies = new Map<string, QueuedReply[]>()
  private readonly inboundChains = new Map<string, Promise<void>>()
  private readonly deniedChatNoticeSent = new Set<string>()
  private readonly unsupportedChatNoticeSent = new Set<string>()
  private allowedChatIds = new Set<string>()

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    if (!config.TELEGRAM_BOT_TOKEN.trim()) {
      log.info("Telegram disabled: missing TELEGRAM_BOT_TOKEN")
      return
    }

    this.allowedChatIds = parseAllowedTelegramChatIds(config.TELEGRAM_CHAT_ID)
    this.stopController = new AbortController()

    try {
      const me = await this.apiCall<TelegramGetMeResult>("getMe")
      this.botUsername = me.username ?? null
      await this.apiCall<boolean>("deleteWebhook", { drop_pending_updates: false })
    } catch (error) {
      this.stopController.abort()
      this.stopController = null
      this.connected = false
      this.running = false
      log.error("Telegram failed to initialize", { error })
      return
    }

    this.running = true
    this.connected = true
    this.pollTask = this.pollLoop()
    log.info("Telegram channel started", {
      allowlistSize: this.allowedChatIds.size,
      botUsername: this.botUsername,
    })
  }

  async stop(): Promise<void> {
    this.running = false
    this.connected = false
    if (this.stopController) {
      this.stopController.abort()
      this.stopController = null
    }
    if (this.pollTask) {
      await this.pollTask.catch((error) => log.warn("Telegram poll loop stop wait failed", { error }))
      this.pollTask = null
    }
    this.inboundChains.clear()
  }

  isConnected(): boolean {
    return this.running && this.connected
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.isConnected()) {
      return false
    }

    const chatId = toTelegramChatId(userId)
    const rendered = markdownProcessor.process(message, "telegram")
    const chunks = splitMessage(rendered, TELEGRAM_SEND_TEXT_MAX)

    try {
      for (const chunk of chunks) {
        await this.apiCall("sendMessage", {
          chat_id: chatId,
          text: chunk,
          parse_mode: "HTML",
        })
      }
      return true
    } catch (error) {
      if (isTelegramEntityParseError(error)) {
        log.warn("Telegram HTML parse failed; retrying chunk(s) as plain text", { chatId })
        try {
          for (const chunk of chunks) {
            await this.apiCall("sendMessage", {
              chat_id: chatId,
              text: stripTelegramHtml(chunk),
            })
          }
          return true
        } catch (fallbackError) {
          log.error("Telegram plain text fallback send failed", { chatId, error: fallbackError })
          return false
        }
      }

      log.error("Telegram send failed", { chatId, error })
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    const chatId = toTelegramChatId(userId)
    await this.send(chatId, `${message}\n\n${action}\nReply YES or NO`)
    return pollForConfirm(async () => this.getLatestReply(chatId), 60_000, 3000)
  }

  private async pollLoop(): Promise<void> {
    while (this.running && this.stopController && !this.stopController.signal.aborted) {
      try {
        const updates = await this.apiCall<TelegramUpdate[]>(
          "getUpdates",
          {
            offset: this.nextUpdateOffset,
            timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
            allowed_updates: ["message"],
          },
          {
            signal: this.stopController.signal,
            timeoutMs: TELEGRAM_POLL_HTTP_TIMEOUT_MS,
          },
        )

        for (const update of updates) {
          const updateId = typeof update.update_id === "number" ? update.update_id : null
          if (updateId !== null) {
            this.nextUpdateOffset = Math.max(this.nextUpdateOffset, updateId + 1)
          }
          await this.handleUpdate(update)
        }
      } catch (error) {
        if (this.stopController?.signal.aborted) {
          break
        }
        log.warn("Telegram polling failed; retrying", { error })
        await this.delay(TELEGRAM_RETRY_DELAY_MS)
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const inbound = extractInboundTelegramText(update)
    if (!inbound || inbound.fromIsBot) {
      return
    }

    if (!this.isAllowedChat(inbound.chatId, inbound.chatType)) {
      await this.maybeNotifyDeniedChat(inbound.chatId)
      return
    }

    this.enqueueReply(inbound.chatId, inbound.text)

    const command = normalizeTelegramCommand(inbound.text, this.botUsername)
    if (command) {
      await this.handleCommand(inbound.chatId, command)
      return
    }

    this.enqueueInboundProcessing(inbound.chatId, inbound.text)
  }

  private isAllowedChat(chatId: string, chatType: string): boolean {
    if (this.allowedChatIds.size > 0) {
      return this.allowedChatIds.has(chatId)
    }

    // Safer default for first-time bot testing: accept only private chats unless explicitly allowlisted.
    if (chatType !== "private") {
      return false
    }
    return true
  }

  private async maybeNotifyDeniedChat(chatId: string): Promise<void> {
    if (this.deniedChatNoticeSent.has(chatId)) {
      return
    }
    this.deniedChatNoticeSent.add(chatId)

    const allowlistHint = this.allowedChatIds.size > 0
      ? "This chat is not in TELEGRAM_CHAT_ID allowlist."
      : "Only private chats are enabled by default. Add this chat id to TELEGRAM_CHAT_ID to allow groups."

    await this.apiCall("sendMessage", {
      chat_id: chatId,
      text: `${allowlistHint}\nUse /id in a private chat to see your chat id.`,
    }).catch((error) => log.warn("Telegram denied-chat notice failed", { chatId, error }))
  }

  private enqueueInboundProcessing(chatId: string, text: string): void {
    const current = this.inboundChains.get(chatId) ?? Promise.resolve()
    const next = current
      .catch(() => undefined)
      .then(async () => {
        await this.sendTyping(chatId)

        const userId = toTelegramChannelUserId(chatId)
        await multiUser.getOrCreate(userId, "telegram")

        try {
          const response = await handleIncomingUserMessage(userId, text, "telegram")
          const sent = await this.send(chatId, response)
          if (!sent) {
            log.warn("Telegram response send returned false", { chatId })
          }
        } catch (error) {
          log.error("Telegram inbound processing failed", { chatId, error })
          await this.apiCall("sendMessage", {
            chat_id: chatId,
            text: "Maaf, prosesnya gagal. Coba ulangi pesanmu atau kirim versi lebih singkat.",
          }).catch((sendError) => log.warn("Telegram error reply failed", { chatId, error: sendError }))
        }
      })
      .finally(() => {
        if (this.inboundChains.get(chatId) === next) {
          this.inboundChains.delete(chatId)
        }
      })

    this.inboundChains.set(chatId, next)
  }

  private async handleCommand(chatId: string, command: string): Promise<void> {
    if (command === "start" || command === "help") {
      await this.apiCall("sendMessage", {
        chat_id: chatId,
        text: [
          "Orion Telegram test channel ready.",
          "",
          "Commands:",
          "/help - show this help",
          "/id - show Telegram chat id (for TELEGRAM_CHAT_ID allowlist)",
          "/ping - health check",
          "",
          "Send any text message to chat with Orion.",
        ].join("\n"),
      }).catch((error) => log.warn("Telegram help command failed", { chatId, error }))
      return
    }

    if (command === "id") {
      await this.apiCall("sendMessage", {
        chat_id: chatId,
        text: `chat_id=${chatId}`,
      }).catch((error) => log.warn("Telegram id command failed", { chatId, error }))
      return
    }

    if (command === "ping") {
      await this.apiCall("sendMessage", {
        chat_id: chatId,
        text: "pong",
      }).catch((error) => log.warn("Telegram ping command failed", { chatId, error }))
      return
    }
  }

  private async sendTyping(chatId: string): Promise<void> {
    await this.apiCall("sendChatAction", {
      chat_id: chatId,
      action: "typing",
    }).catch((error) => log.debug("Telegram typing action failed", { chatId, error }))
  }

  private enqueueReply(chatId: string, content: string): void {
    const queue = this.replies.get(chatId) ?? []
    queue.push({ content, ts: Date.now() })
    if (queue.length > 50) {
      queue.splice(0, queue.length - 50)
    }
    this.replies.set(chatId, queue)
  }

  private async getLatestReply(chatId: string, sinceSeconds = 60): Promise<string | null> {
    const queue = this.replies.get(chatId)
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

  private async apiCall<T>(
    method: string,
    body?: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? TELEGRAM_API_TIMEOUT_MS
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const signals = [controller.signal, options.signal].filter(Boolean) as AbortSignal[]
    const onAbort = () => controller.abort()

    try {
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort()
          break
        }
        signal.addEventListener("abort", onAbort, { once: true })
      }

      const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : "{}",
        signal: controller.signal,
      })

      const payload = await response.json().catch(() => null) as TelegramApiEnvelope<T> | null
      if (!response.ok) {
        const description = payload?.description ?? `HTTP ${response.status}`
        throw new Error(`Telegram API ${method} failed: ${description}`)
      }

      if (!payload?.ok) {
        throw new Error(`Telegram API ${method} failed: ${payload?.description ?? "unknown error"}`)
      }

      return payload.result
    } finally {
      clearTimeout(timeout)
      for (const signal of signals) {
        signal.removeEventListener("abort", onAbort)
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}

export const telegramChannel = new TelegramChannel()

export const __telegramTestUtils = {
  parseAllowedTelegramChatIds,
  normalizeTelegramCommand,
  extractInboundTelegramText,
  toTelegramChannelUserId,
  toTelegramChatId,
  stripTelegramHtml,
}
