import { createRequire } from "node:module"
import path from "node:path"

import config from "../config.js"
import { handleIncomingUserMessage } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { markdownProcessor } from "../markdown/processor.js"
import { multiUser } from "../multiuser/manager.js"
import type { BaseChannel } from "./base.js"
import { pollForConfirm, splitMessage } from "./base.js"

const log = createLogger("whatsapp-channel")
const optionalRequire = createRequire(import.meta.url)

const WHATSAPP_CLOUD_GRAPH_BASE_URL = "https://graph.facebook.com"
const WHATSAPP_CLOUD_SEND_TIMEOUT_MS = 15_000
const WHATSAPP_CLOUD_MAX_TEXT_CHARS = 3500
const RECENT_MESSAGE_ID_TTL_MS = 10 * 60_000
const RECENT_MESSAGE_ID_MAX = 1000

interface BaileysSocket {
  user: { id: string } | null
  ev: {
    on(event: string, callback: (...args: unknown[]) => void): void
  }
  sendMessage(jid: string, content: { text: string }): Promise<unknown>
  end(): void
}

interface BaileysModule {
  makeWASocket: (config: {
    auth: unknown
    printQRInTerminal: boolean
    getMessage: (key: unknown) => Promise<unknown>
  }) => BaileysSocket
  useMultiFileAuthState: (path: string) => Promise<{
    state: unknown
    saveCreds: () => Promise<void>
  }>
}

interface QueuedMessage {
  content: string
  ts: number
}

interface CloudWebhookVerifyQuery {
  mode: string | null
  verifyToken: string | null
  challenge: string | null
}

interface CloudInboundMessage {
  messageId: string
  waId: string
  text: string
}

interface CloudWebhookVerifyResult {
  ok: boolean
  statusCode: number
  challenge?: string
  error?: string
}

interface CloudWebhookIngestResult {
  accepted: boolean
  processed: number
  ignored: number
  reason?: string
}

interface MetaGraphApiErrorPayload {
  error?: {
    message?: string
    type?: string
    code?: number
  }
}

type WhatsAppMode = "baileys" | "cloud"
type QrTerminalRenderer = {
  generate(input: string, options?: { small?: boolean }): void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function parseAllowedWhatsAppIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,\n]/)
      .map((value) => normalizeWhatsAppWaId(value))
      .filter(Boolean),
  )
}

function normalizeWhatsAppWaId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }

  const withoutPrefix = trimmed.startsWith("whatsapp:")
    ? trimmed.slice("whatsapp:".length)
    : trimmed
  const bare = withoutPrefix.includes("@")
    ? withoutPrefix.slice(0, withoutPrefix.indexOf("@"))
    : withoutPrefix

  return bare.replace(/[^\d]/g, "")
}

function toWhatsAppEdithUserId(waId: string): string {
  return `whatsapp:${normalizeWhatsAppWaId(waId)}`
}

function toWhatsAppCloudRecipient(userId: string): string | null {
  const normalized = normalizeWhatsAppWaId(userId)
  return normalized || null
}

function toBaileysJid(userId: string): string | null {
  const trimmed = userId.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.includes("@")) {
    return trimmed
  }

  const waId = normalizeWhatsAppWaId(trimmed)
  if (!waId) {
    return null
  }
  return `${waId}@s.whatsapp.net`
}

function normalizeWhatsAppCommand(text: string): string | null {
  const token = text.trim().split(/\s+/, 1)[0] ?? ""
  if (!token.startsWith("/") && !token.startsWith("!")) {
    return null
  }
  const command = token.slice(1).toLowerCase()
  return command || null
}

function resolveWhatsAppAuthStateDir(): string {
  const stateDir = typeof process.env.EDITH_STATE_DIR === "string" && process.env.EDITH_STATE_DIR.trim().length > 0
    ? process.env.EDITH_STATE_DIR.trim()
    : ".edith"
  return path.join(stateDir, "whatsapp-auth")
}

function parseWhatsAppWebhookVerifyQuery(input: unknown): CloudWebhookVerifyQuery {
  const query = asRecord(input) ?? {}
  const mode = asString(query["hub.mode"])
  const verifyToken = asString(query["hub.verify_token"])
  const challenge = asString(query["hub.challenge"])
  return { mode, verifyToken, challenge }
}

function extractTextFromCloudMessage(message: Record<string, unknown>): string | null {
  const type = asString(message.type)
  if (!type) {
    return null
  }

  if (type === "text") {
    const text = asRecord(message.text)
    return asString(text?.body)
  }

  if (type === "button") {
    const button = asRecord(message.button)
    return asString(button?.text)
  }

  if (type === "interactive") {
    const interactive = asRecord(message.interactive)
    const buttonReply = asRecord(interactive?.button_reply)
    const listReply = asRecord(interactive?.list_reply)
    return asString(buttonReply?.title) ?? asString(listReply?.title)
  }

  return null
}

function extractInboundWhatsAppCloudMessages(payload: unknown): CloudInboundMessage[] {
  const root = asRecord(payload)
  if (!root || root.object !== "whatsapp_business_account") {
    return []
  }

  const entries = Array.isArray(root.entry) ? root.entry : []
  const extracted: CloudInboundMessage[] = []

  for (const entry of entries) {
    const entryRecord = asRecord(entry)
    const changes = Array.isArray(entryRecord?.changes) ? entryRecord.changes : []

    for (const change of changes) {
      const changeRecord = asRecord(change)
      if (changeRecord?.field !== "messages") {
        continue
      }

      const value = asRecord(changeRecord.value)
      const messages = Array.isArray(value?.messages) ? value.messages : []
      for (const candidate of messages) {
        const message = asRecord(candidate)
        if (!message) {
          continue
        }

        const messageId = asString(message.id)
        const waId = normalizeWhatsAppWaId(asString(message.from) ?? "")
        const text = extractTextFromCloudMessage(message)
        if (!messageId || !waId || !text) {
          continue
        }

        extracted.push({
          messageId,
          waId,
          text,
        })
      }
    }
  }

  return extracted
}

function extractBaileysMessageText(value: unknown): string | null {
  const message = asRecord(value)
  if (!message) {
    return null
  }

  const directConversation = asString(message.conversation)
  if (directConversation) {
    return directConversation
  }

  const extendedText = asRecord(message.extendedTextMessage)
  const extendedTextValue = asString(extendedText?.text)
  if (extendedTextValue) {
    return extendedTextValue
  }

  const imageMessage = asRecord(message.imageMessage)
  const imageCaption = asString(imageMessage?.caption)
  if (imageCaption) {
    return imageCaption
  }

  const videoMessage = asRecord(message.videoMessage)
  const videoCaption = asString(videoMessage?.caption)
  if (videoCaption) {
    return videoCaption
  }

  const ephemeral = asRecord(message.ephemeralMessage)
  if (ephemeral?.message) {
    return extractBaileysMessageText(ephemeral.message)
  }

  const viewOnce = asRecord(message.viewOnceMessage)
  if (viewOnce?.message) {
    return extractBaileysMessageText(viewOnce.message)
  }

  return null
}

export class WhatsAppChannel implements BaseChannel {
  readonly name = "whatsapp"

  private socket: BaileysSocket | null = null
  private baileys: BaileysModule | null = null
  private messageQueue = new Map<string, QueuedMessage[]>()
  private inboundChains = new Map<string, Promise<void>>()
  private deniedSenderNoticeSent = new Set<string>()
  private recentCloudMessageIds = new Map<string, number>()
  private cloudAllowedWaIds = new Set<string>()
  private running = false
  private connected = false
  private qrRenderer: QrTerminalRenderer | null = null
  private qrRendererLoadAttempted = false
  private lastPrintedQr: string | null = null

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    if (!config.WHATSAPP_ENABLED) {
      log.info("WhatsApp channel disabled")
      return
    }

    this.cloudAllowedWaIds = parseAllowedWhatsAppIds(config.WHATSAPP_CLOUD_ALLOWED_WA_IDS)

    if (this.getMode() === "cloud") {
      if (!this.hasCloudSendConfig()) {
        log.warn("WhatsApp Cloud API mode enabled but missing access token or phone number id")
        return
      }

      this.running = true
      this.connected = true
      log.info("WhatsApp Cloud API mode ready", {
        webhookVerifyConfigured: Boolean(config.WHATSAPP_CLOUD_VERIFY_TOKEN.trim()),
        allowlistSize: this.cloudAllowedWaIds.size,
        apiVersion: config.WHATSAPP_CLOUD_API_VERSION,
      })
      return
    }

    try {
      this.baileys = await this.loadBaileys()
      if (!this.baileys) {
        log.warn("Baileys package not available, WhatsApp channel not started")
        return
      }

      const { state, saveCreds } = await this.baileys.useMultiFileAuthState(resolveWhatsAppAuthStateDir())

      this.socket = this.baileys.makeWASocket({
        // Baileys expects the raw auth state object (`{ creds, keys }`), not the wrapper returned by
        // useMultiFileAuthState. Passing the wrapper causes `auth.creds` to be undefined and crashes at startup.
        auth: state,
        printQRInTerminal: false,
        getMessage: async () => undefined,
      })
      this.running = true

      this.socket.ev.on("creds.update", () => {
        void saveCreds().catch((error) => {
          log.warn("WhatsApp (Baileys) failed to persist updated creds", { error })
        })
      })

      this.socket.ev.on("connection.update", (update: unknown) => {
        const connUpdate = update as {
          connection?: string
          qr?: string
          lastDisconnect?: { error?: { output?: { statusCode?: number } } }
        }

        if (typeof connUpdate.qr === "string" && connUpdate.qr.trim().length > 0) {
          void this.printQr(connUpdate.qr)
        }

        if (connUpdate.connection === "close") {
          const statusCode = connUpdate.lastDisconnect?.error?.output?.statusCode
          const shouldReconnect = statusCode !== 401 && statusCode !== 403

          log.info("WhatsApp (Baileys) disconnected", { statusCode, shouldReconnect })
          this.connected = false
          this.running = false

          if (shouldReconnect && config.WHATSAPP_ENABLED && this.getMode() === "baileys") {
            setTimeout(() => {
              void this.start()
            }, 5000)
          }
        } else if (connUpdate.connection === "open") {
          log.info("WhatsApp (Baileys) connected")
          this.connected = true
          this.running = true
        }
      })

      this.socket.ev.on("messages.upsert", (msgUpdate: unknown) => {
        const updates = this.extractBaileysInboundMessages(msgUpdate)
        for (const inbound of updates) {
          this.handleInboundText(inbound.sourceId, inbound.waId, inbound.text)
        }
      })
    } catch (error) {
      this.running = false
      this.connected = false
      log.error("failed to start WhatsApp channel", { error })
    }
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (this.getMode() === "cloud") {
      return this.sendCloud(userId, message)
    }
    return this.sendBaileys(userId, message)
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    const prompt = `${message}\n\n${action}\nReply YES or NO`
    await this.send(userId, prompt)

    return pollForConfirm(
      async () => this.getLatestReply(this.resolveReplyQueueKey(userId), 60),
      60_000,
      3000,
    )
  }

  async getLatestReply(userId: string, sinceSeconds = 60): Promise<string | null> {
    const queueKey = this.resolveReplyQueueKey(userId)
    const messages = this.messageQueue.get(queueKey)
    if (!messages || messages.length === 0) {
      return null
    }

    const cutoff = Date.now() - (sinceSeconds * 1000)
    const recent = messages.filter((entry) => entry.ts >= cutoff)
    if (recent.length === 0) {
      return null
    }

    const latest = recent[recent.length - 1]
    const index = messages.indexOf(latest)
    if (index >= 0) {
      messages.splice(index, 1)
    }
    return latest.content
  }

  async stop(): Promise<void> {
    if (this.socket) {
      try {
        this.socket.end()
      } catch (error) {
        log.warn("error closing WhatsApp socket", { error })
      }
      this.socket = null
    }

    this.baileys = null
    this.running = false
    this.connected = false
    this.inboundChains.clear()
    log.info("WhatsApp channel stopped")
  }

  isConnected(): boolean {
    if (!config.WHATSAPP_ENABLED) {
      return false
    }

    if (this.getMode() === "cloud") {
      return this.hasCloudSendConfig()
    }

    return this.running && this.connected && this.socket !== null
  }

  isCloudWebhookEnabled(): boolean {
    return config.WHATSAPP_ENABLED
      && this.getMode() === "cloud"
      && this.hasCloudSendConfig()
      && config.WHATSAPP_CLOUD_VERIFY_TOKEN.trim().length > 0
  }

  verifyCloudWebhook(query: unknown): CloudWebhookVerifyResult {
    if (!this.isCloudWebhookEnabled()) {
      return {
        ok: false,
        statusCode: 503,
        error: "WhatsApp Cloud webhook is not configured",
      }
    }

    const parsed = parseWhatsAppWebhookVerifyQuery(query)
    if (parsed.mode !== "subscribe" || !parsed.challenge) {
      return {
        ok: false,
        statusCode: 400,
        error: "Invalid WhatsApp webhook verification query",
      }
    }

    if (parsed.verifyToken !== config.WHATSAPP_CLOUD_VERIFY_TOKEN.trim()) {
      return {
        ok: false,
        statusCode: 403,
        error: "Invalid WhatsApp webhook verify token",
      }
    }

    return {
      ok: true,
      statusCode: 200,
      challenge: parsed.challenge,
    }
  }

  async handleCloudWebhookPayload(payload: unknown): Promise<CloudWebhookIngestResult> {
    if (!this.isCloudWebhookEnabled()) {
      return {
        accepted: false,
        processed: 0,
        ignored: 0,
        reason: "cloud webhook disabled or incomplete config",
      }
    }

    const inboundMessages = extractInboundWhatsAppCloudMessages(payload)
    if (inboundMessages.length === 0) {
      return {
        accepted: true,
        processed: 0,
        ignored: 0,
      }
    }

    let processed = 0
    let ignored = 0

    for (const inbound of inboundMessages) {
      if (this.seenCloudMessageId(inbound.messageId)) {
        ignored += 1
        continue
      }

      this.markCloudMessageIdSeen(inbound.messageId)
      processed += 1
      this.handleInboundText(inbound.waId, inbound.waId, inbound.text)
    }

    return {
      accepted: true,
      processed,
      ignored,
    }
  }

  private getMode(): WhatsAppMode {
    return config.WHATSAPP_MODE
  }

  private hasCloudSendConfig(): boolean {
    return config.WHATSAPP_CLOUD_ACCESS_TOKEN.trim().length > 0
      && config.WHATSAPP_CLOUD_PHONE_NUMBER_ID.trim().length > 0
  }

  private async loadBaileys(): Promise<BaileysModule | null> {
    try {
      const baileys = await import("baileys")
      return baileys as unknown as BaileysModule
    } catch (error) {
      log.warn("Baileys package not installed", error)
      return null
    }
  }

  private extractBaileysInboundMessages(
    msgUpdate: unknown,
  ): Array<{ sourceId: string; waId: string; text: string }> {
    const updateRecord = asRecord(msgUpdate)
    const messages = Array.isArray(updateRecord?.messages) ? updateRecord.messages : []
    const inbound: Array<{ sourceId: string; waId: string; text: string }> = []

    for (const candidate of messages) {
      const msg = asRecord(candidate)
      const key = asRecord(msg?.key)
      const fromMe = Boolean(key?.fromMe)
      const sourceId = asString(key?.remoteJid)
      const text = extractBaileysMessageText(msg?.message)
      const waId = normalizeWhatsAppWaId(sourceId ?? "")

      if (fromMe || !sourceId || !text || !waId) {
        continue
      }

      inbound.push({ sourceId, waId, text })
    }

    return inbound
  }

  private handleInboundText(sourceId: string, waId: string, text: string): void {
    this.enqueueReply(sourceId, text)

    if (this.getMode() === "cloud" && !this.isAllowedCloudSender(waId)) {
      this.enqueueSerializedTask(sourceId, async () => {
        await this.maybeNotifyDeniedCloudSender(waId)
      })
      return
    }

    const command = normalizeWhatsAppCommand(text)
    if (command) {
      this.enqueueSerializedTask(sourceId, async () => {
        await this.handleCommand(sourceId, waId, command)
      })
      return
    }

    this.enqueueSerializedTask(sourceId, async () => {
      const edithUserId = toWhatsAppEdithUserId(waId)
      await multiUser.getOrCreate(edithUserId, "whatsapp")

      try {
        const response = await handleIncomingUserMessage(edithUserId, text, "whatsapp")
        const sent = await this.send(sourceId, response)
        if (!sent) {
          log.warn("WhatsApp response send returned false", { sourceId, mode: this.getMode() })
        }
      } catch (error) {
        log.error("WhatsApp inbound processing failed", { sourceId, error })
        await this.send(sourceId, "Maaf, prosesnya gagal. Coba kirim ulang pesanmu.")
          .catch((sendError) => log.warn("WhatsApp error reply failed", { sourceId, error: sendError }))
      }
    })
  }

  private enqueueSerializedTask(sourceId: string, task: () => Promise<void>): void {
    const current = this.inboundChains.get(sourceId) ?? Promise.resolve()
    const next = current
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.inboundChains.get(sourceId) === next) {
          this.inboundChains.delete(sourceId)
        }
      })

    this.inboundChains.set(sourceId, next)
  }

  private async handleCommand(sourceId: string, waId: string, command: string): Promise<void> {
    if (command === "help" || command === "start") {
      await this.send(sourceId, [
        "EDITH WhatsApp test channel ready.",
        "",
        "Commands:",
        "/help or !help",
        "/id or !id",
        "/ping or !ping",
        "",
        "Send any text message to chat with EDITH.",
      ].join("\n"))
      return
    }

    if (command === "id") {
      await this.send(sourceId, `wa_id=${waId}`)
      return
    }

    if (command === "ping") {
      await this.send(sourceId, "pong")
    }
  }

  private isAllowedCloudSender(waId: string): boolean {
    if (this.cloudAllowedWaIds.size === 0) {
      return true
    }
    return this.cloudAllowedWaIds.has(normalizeWhatsAppWaId(waId))
  }

  private async maybeNotifyDeniedCloudSender(waId: string): Promise<void> {
    if (this.deniedSenderNoticeSent.has(waId)) {
      return
    }
    this.deniedSenderNoticeSent.add(waId)

    const hint = "This number is not in WHATSAPP_CLOUD_ALLOWED_WA_IDS allowlist."
    await this.send(waId, `${hint}\nReply /id from an allowlisted number to verify your wa_id.`)
      .catch((error) => log.warn("WhatsApp denied-sender notice failed", { waId, error }))
  }

  private async sendBaileys(userId: string, message: string): Promise<boolean> {
    if (!this.socket || !this.connected) {
      return false
    }

    const jid = toBaileysJid(userId)
    if (!jid) {
      log.warn("WhatsApp (Baileys) send skipped: invalid jid", { userId })
      return false
    }

    try {
      const rendered = markdownProcessor.process(message, "whatsapp")
      const chunks = splitMessage(rendered, 4096)
      for (const chunk of chunks) {
        await this.socket.sendMessage(jid, { text: chunk })
      }
      return true
    } catch (error) {
      log.error("failed to send WhatsApp message via Baileys", { jid, error })
      return false
    }
  }

  private async sendCloud(userId: string, message: string): Promise<boolean> {
    if (!this.hasCloudSendConfig()) {
      return false
    }

    const recipient = toWhatsAppCloudRecipient(userId)
    if (!recipient) {
      log.warn("WhatsApp Cloud send skipped: invalid recipient", { userId })
      return false
    }

    const rendered = markdownProcessor.process(message, "whatsapp")
    const chunks = splitMessage(rendered, WHATSAPP_CLOUD_MAX_TEXT_CHARS)

    try {
      for (const chunk of chunks) {
        await this.cloudApiCall("messages", {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "text",
          text: {
            body: chunk,
            preview_url: false,
          },
        })
      }
      return true
    } catch (error) {
      log.error("WhatsApp Cloud send failed", { recipient, error })
      return false
    }
  }

  private async printQr(qr: string): Promise<void> {
    if (!qr || qr === this.lastPrintedQr) {
      return
    }
    this.lastPrintedQr = qr

    const renderer = await this.loadQrRenderer()
    if (renderer) {
      console.log("")
      console.log("WhatsApp QR (scan from WhatsApp > Linked Devices > Link a Device):")
      renderer.generate(qr, { small: true })
      console.log("")
      return
    }

    log.warn("WhatsApp QR received but terminal QR renderer is unavailable", {
      hint: "Install `qrcode-terminal` for in-terminal QR rendering, or use WhatsApp Cloud mode.",
    })
    console.log("")
    console.log("WhatsApp QR payload (renderer missing):")
    console.log(qr)
    console.log("")
  }

  private async loadQrRenderer(): Promise<QrTerminalRenderer | null> {
    if (this.qrRendererLoadAttempted) {
      return this.qrRenderer
    }
    this.qrRendererLoadAttempted = true

    try {
      const mod = optionalRequire("qrcode-terminal") as unknown
      const candidate = (mod as { default?: unknown }).default ?? mod
      if (candidate && typeof (candidate as { generate?: unknown }).generate === "function") {
        this.qrRenderer = candidate as QrTerminalRenderer
        return this.qrRenderer
      }
    } catch {
      // Optional dependency; fallback handled by caller.
    }

    this.qrRenderer = null
    return null
  }

  private async cloudApiCall(path: string, body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WHATSAPP_CLOUD_SEND_TIMEOUT_MS)
    const baseUrl = `${WHATSAPP_CLOUD_GRAPH_BASE_URL}/${config.WHATSAPP_CLOUD_API_VERSION}/${config.WHATSAPP_CLOUD_PHONE_NUMBER_ID}`

    try {
      const response = await fetch(`${baseUrl}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const payload = await response.json().catch(() => null) as MetaGraphApiErrorPayload | null
      if (!response.ok) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`
        throw new Error(`WhatsApp Cloud API error: ${message}`)
      }

      return payload
    } finally {
      clearTimeout(timeout)
    }
  }

  private resolveReplyQueueKey(userId: string): string {
    if (this.getMode() === "cloud") {
      return toWhatsAppCloudRecipient(userId) ?? userId
    }
    return toBaileysJid(userId) ?? userId
  }

  private enqueueReply(sourceId: string, content: string): void {
    const queue = this.messageQueue.get(sourceId) ?? []
    queue.push({ content, ts: Date.now() })
    if (queue.length > 50) {
      queue.splice(0, queue.length - 50)
    }
    this.messageQueue.set(sourceId, queue)
  }

  private seenCloudMessageId(messageId: string): boolean {
    this.pruneRecentCloudMessageIds()
    return this.recentCloudMessageIds.has(messageId)
  }

  private markCloudMessageIdSeen(messageId: string): void {
    this.pruneRecentCloudMessageIds()
    this.recentCloudMessageIds.set(messageId, Date.now())

    if (this.recentCloudMessageIds.size <= RECENT_MESSAGE_ID_MAX) {
      return
    }

    const entries = Array.from(this.recentCloudMessageIds.entries())
      .sort((a, b) => a[1] - b[1])
    const overflow = entries.length - RECENT_MESSAGE_ID_MAX
    for (let i = 0; i < overflow; i += 1) {
      const messageIdToDelete = entries[i]?.[0]
      if (messageIdToDelete) {
        this.recentCloudMessageIds.delete(messageIdToDelete)
      }
    }
  }

  private pruneRecentCloudMessageIds(): void {
    const cutoff = Date.now() - RECENT_MESSAGE_ID_TTL_MS
    for (const [messageId, ts] of this.recentCloudMessageIds.entries()) {
      if (ts < cutoff) {
        this.recentCloudMessageIds.delete(messageId)
      }
    }
  }
}

export const whatsAppChannel = new WhatsAppChannel()

export const __whatsAppTestUtils = {
  parseAllowedWhatsAppIds,
  normalizeWhatsAppWaId,
  toWhatsAppEdithUserId,
  toWhatsAppCloudRecipient,
  toBaileysJid,
  normalizeWhatsAppCommand,
  resolveWhatsAppAuthStateDir,
  parseWhatsAppWebhookVerifyQuery,
  extractInboundWhatsAppCloudMessages,
  // Regression guard: Baileys startup must pass raw auth state to makeWASocket, not `{ state, saveCreds }`.
  buildBaileysSocketConfigPreview: (state: unknown) => ({
    auth: state,
    printQRInTerminal: false,
  }),
}
