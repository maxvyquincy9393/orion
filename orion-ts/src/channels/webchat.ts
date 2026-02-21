import fastify from "fastify"
import websocket from "@fastify/websocket"
import staticPlugin from "@fastify/static"
import type { WebSocket } from "ws"
import path from "node:path"
import { fileURLToPath } from "node:url"

import config from "../config.js"
import { createLogger } from "../logger.js"
import type { BaseChannel } from "./base.js"
import { pollForConfirm } from "./base.js"

const logger = createLogger("webchat-channel")

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface QueuedMessage {
  content: string
  ts: number
}

export class WebChatChannel implements BaseChannel {
  readonly name = "webchat"
  private app = fastify()
  private connections = new Map<string, WebSocket>()
  private messageQueue = new Map<string, QueuedMessage[]>()
  private running = false
  private host: string
  private port: number

  constructor(host = "127.0.0.1", port = config.WEBCHAT_PORT) {
    this.host = host
    this.port = port
  }

  async start(): Promise<void> {
    await this.app.register(websocket)
    
    await this.app.register(staticPlugin, {
      root: path.join(__dirname, "webchat-ui"),
      prefix: "/",
    })

    this.app.get("/", async (_request, reply) => {
      return reply.sendFile("index.html")
    })

    this.app.get("/ws/:userId", { websocket: true }, (connection: any, req) => {
      const userId = (req.params as { userId: string }).userId
      this.handleWebSocket(connection.socket as WebSocket, userId)
    })

    await this.app.listen({ host: this.host, port: this.port })
    logger.info(`WebChat ready at http://${this.host}:${this.port}`)
    this.running = true
  }

  private handleWebSocket(ws: WebSocket, userId: string): void {
    this.connections.set(userId, ws)

    const queued = this.messageQueue.get(userId) ?? []
    for (const msg of queued) {
      ws.send(JSON.stringify({
        type: "message",
        role: "assistant",
        content: msg.content,
      }))
    }
    this.messageQueue.delete(userId)

    ws.on("message", (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === "message" && parsed.content) {
          const messages = this.messageQueue.get(userId) ?? []
          messages.push({ content: parsed.content, ts: Date.now() })
          this.messageQueue.set(userId, messages)
        }
      } catch (error) {
        logger.warn("Failed to parse WebSocket message", error)
      }
    })

    ws.on("close", () => {
      this.connections.delete(userId)
    })

    ws.on("error", (error: Error) => {
      logger.error("WebSocket error", error)
      this.connections.delete(userId)
    })
  }

  async send(userId: string, message: string): Promise<boolean> {
    const ws = this.connections.get(userId)
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: "message",
        role: "assistant",
        content: message,
      }))
      return true
    }

    const queued = this.messageQueue.get(userId) ?? []
    queued.push({ content: message, ts: Date.now() })
    this.messageQueue.set(userId, queued)
    return true
  }

  async sendWithConfirm(userId: string, message: string, action: string): Promise<boolean> {
    const prompt = `${message}\n\n${action}\nType YES or NO`
    await this.send(userId, prompt)

    const startTime = Date.now()
    const timeoutMs = 60_000

    while (Date.now() - startTime < timeoutMs) {
      const reply = await this.getLatestReply(userId, 60)
      if (reply) {
        const normalized = reply.trim().toLowerCase()
        if (normalized.includes("yes")) {
          logger.info(`WebChat action confirmed: ${action}`)
          return true
        }
        if (normalized.includes("no")) {
          logger.info(`WebChat action canceled: ${action}`)
          return false
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    return false
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
    messages.splice(messages.indexOf(latest), 1)
    return latest.content
  }

  async stop(): Promise<void> {
    await this.app.close()
    this.running = false
  }

  isConnected(): boolean {
    return this.running
  }
}

export default WebChatChannel
