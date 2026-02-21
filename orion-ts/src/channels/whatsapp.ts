import type { WebSocket } from "ws"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { BaseChannel } from "./base.js"
import { splitMessage, pollForConfirm } from "./base.js"
import { markdownProcessor } from "../markdown/processor.js"

const log = createLogger("whatsapp-channel")

interface BaileysSocket {
  user: { id: string } | null
  on(event: string, callback: (...args: unknown[]) => void): void
  sendMessage(jid: string, content: { text: string }): Promise<unknown>
  end(): void
}

interface BaileysModule {
  makeWASocket: (config: {
    auth: { state: unknown; saveCreds: () => Promise<void> }
    printQRInTerminal: boolean
    getMessage: (key: unknown) => Promise<unknown>
  }) => BaileysSocket
  useMultiFileAuthState: (path: string) => Promise<{
    state: unknown
    saveCreds: () => Promise<void>
  }>
  DisconnectReason: Record<string, unknown>
}

interface QueuedMessage {
  content: string
  ts: number
}

export class WhatsAppChannel implements BaseChannel {
  readonly name = "whatsapp"
  private socket: BaileysSocket | null = null
  private baileys: BaileysModule | null = null
  private messageQueue = new Map<string, QueuedMessage[]>()
  private running = false

  async start(): Promise<void> {
    if (!config.WHATSAPP_ENABLED) {
      log.info("WhatsApp channel disabled")
      return
    }

    try {
      this.baileys = await this.loadBaileys()
      if (!this.baileys) {
        log.warn("Baileys package not available, WhatsApp channel not started")
        return
      }

      const { state, saveCreds } = await this.baileys.useMultiFileAuthState(
        ".orion/whatsapp-auth"
      )

      this.socket = this.baileys.makeWASocket({
        auth: { state, saveCreds },
        printQRInTerminal: true,
        getMessage: async () => undefined,
      })

      this.socket.on("connection.update", (update: unknown) => {
        const connUpdate = update as { connection?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } }
        
        if (connUpdate.connection === "close") {
          const statusCode = connUpdate.lastDisconnect?.error?.output?.statusCode
          const shouldReconnect = statusCode !== 401 && statusCode !== 403
          
          log.info("WhatsApp disconnected", { statusCode, shouldReconnect })
          
          if (shouldReconnect) {
            setTimeout(() => this.start(), 5000)
          }
          this.running = false
        } else if (connUpdate.connection === "open") {
          log.info("WhatsApp connected")
          this.running = true
        }
      })

      this.socket.on("messages.upsert", (msgUpdate: unknown) => {
        const messages = (msgUpdate as { messages?: Array<{ key?: { remoteJid?: string; fromMe?: boolean }; message?: { conversation?: string } }> }).messages ?? []
        
        for (const msg of messages) {
          if (msg.key?.fromMe) continue
          
          const from = msg.key?.remoteJid
          const text = msg.message?.conversation
          
          if (from && text) {
            const queue = this.messageQueue.get(from) ?? []
            queue.push({ content: text, ts: Date.now() })
            this.messageQueue.set(from, queue)
          }
        }
      })
    } catch (error) {
      log.error("failed to start WhatsApp channel", error)
    }
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

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.socket || !this.running) {
      return false
    }

    try {
      const rendered = markdownProcessor.process(message, "whatsapp")
      const chunks = splitMessage(rendered, 4096)
      
      for (const chunk of chunks) {
        await this.socket.sendMessage(userId, { text: chunk })
      }
      
      return true
    } catch (error) {
      log.error("failed to send WhatsApp message", error)
      return false
    }
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    const prompt = `${message}\n\n${action}\nReply YES or NO`
    await this.send(userId, prompt)

    return pollForConfirm(
      async () => this.getLatestReply(userId, 60),
      60_000,
      3000
    )
  }

  async getLatestReply(userId: string, sinceSeconds = 60): Promise<string | null> {
    const messages = this.messageQueue.get(userId)
    if (!messages || messages.length === 0) {
      return null
    }

    const cutoff = Date.now() - sinceSeconds * 1000
    const recent = messages.filter((entry) => entry.ts >= cutoff)
    if (recent.length === 0) {
      return null
    }

    const latest = recent[recent.length - 1]
    return latest.content
  }

  async stop(): Promise<void> {
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
    this.running = false
    log.info("WhatsApp channel stopped")
  }

  isConnected(): boolean {
    return this.running && this.socket !== null
  }
}

export const whatsAppChannel = new WhatsAppChannel()
