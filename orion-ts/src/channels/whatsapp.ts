import { BaseChannel } from "./base"
import config from "../config"

interface StoredMessage {
  content: string
  ts: number
}

let baileysLoaded = false
let makeWASocket: any = null
let useMultiFileAuthState: any = null
let DisconnectReason: any = null

try {
  const baileys = require("@whiskeysockets/baileys")
  makeWASocket = baileys.makeWASocket
  useMultiFileAuthState = baileys.useMultiFileAuthState
  DisconnectReason = baileys.DisconnectReason
  baileysLoaded = true
} catch (err) {
  console.warn("[WhatsAppChannel] Baileys not available. WhatsApp channel will be disabled.")
}

export class WhatsAppChannel implements BaseChannel {
  readonly name = "whatsapp"
  private sock: any = null
  private latestMessages: Map<string, StoredMessage> = new Map()
  private connected = false
  private authPath = ".orion/auth/whatsapp"

  constructor() {
    if (!baileysLoaded) {
      this.connected = false
    }
  }

  async start(): Promise<void> {
    if (!baileysLoaded) {
      console.warn("[WhatsAppChannel] Cannot start: Baileys not loaded")
      return
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath)

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
      })

      this.sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          console.log("[WhatsAppChannel] QR code generated. Scan with WhatsApp app.")
        }

        if (connection === "close") {
          const shouldReconnect =
            lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
          this.connected = false
          if (shouldReconnect) {
            await this.start()
          }
        } else if (connection === "open") {
          this.connected = true
          console.log("[WhatsAppChannel] Connected successfully")
        }
      })

      this.sock.ev.on("messages.upsert", (msgUpdate: any) => {
        for (const msg of msgUpdate.messages) {
          if (!msg.key.fromMe && msg.message?.conversation) {
            const jid = msg.key.remoteJid
            this.latestMessages.set(jid, {
              content: msg.message.conversation,
              ts: Date.now(),
            })
          }
        }
      })

      this.sock.ev.on("creds.update", saveCreds)
    } catch (err) {
      console.error("[WhatsAppChannel] Failed to start:", err)
      this.connected = false
    }
  }

  async send(userId: string, message: string): Promise<boolean> {
    if (!this.sock || !this.connected) {
      return false
    }

    try {
      await this.sock.sendMessage(userId, { text: message })
      return true
    } catch (err) {
      console.error("[WhatsAppChannel] Failed to send message:", err)
      return false
    }
  }

  async sendWithConfirm(
    userId: string,
    message: string,
    action: string
  ): Promise<boolean> {
    const promptText = `${message}\n\n${action}\nReply with YES to confirm or NO to cancel.`
    await this.send(userId, promptText)

    const startTime = Date.now()
    const timeout = 60000

    while (Date.now() - startTime < timeout) {
      await this.sleep(2000)
      const reply = await this.getLatestReply(userId, 60)
      if (reply) {
        const normalized = reply.trim().toLowerCase()
        if (normalized.startsWith("yes")) {
          return true
        }
        if (normalized.startsWith("no")) {
          return false
        }
      }
    }
    return false
  }

  async getLatestReply(userId: string, sinceSeconds = 60): Promise<string | null> {
    const stored = this.latestMessages.get(userId)
    if (!stored) {
      return null
    }
    const cutoff = Date.now() - sinceSeconds * 1000
    if (stored.ts < cutoff) {
      return null
    }
    return stored.content
  }

  async stop(): Promise<void> {
    if (this.sock) {
      this.sock.end()
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
