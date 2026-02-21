import crypto from "node:crypto"

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import { orchestrator } from "../engines/orchestrator.js"
import { channelManager } from "../channels/manager.js"
import { memory } from "../memory/store.js"
import { daemon } from "../background/daemon.js"
import { multiUser } from "../multiuser/manager.js"
import { filterPrompt } from "../security/prompt-filter.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const logger = createLogger("gateway")

export class GatewayServer {
  private app = Fastify({ logger: false })
  private clients = new Map<string, any>()

  constructor(private port = 18789) {
    this.registerRoutes()
  }

  private registerRoutes(): void {
    this.app.register(websocketPlugin)

    this.app.register(async (app) => {
      app.get("/ws", { websocket: true }, (socket) => {
        const clientId = crypto.randomUUID()
        this.clients.set(clientId, socket)
        logger.info(`client connected: ${clientId}`)

        socket.send(
          JSON.stringify({
            type: "connected",
            clientId,
            engines: orchestrator.getAvailableEngines(),
            channels: channelManager.getConnectedChannels(),
            daemon: daemon.healthCheck(),
          }),
        )

        socket.on("message", async (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString())
            const res = await this.handle(msg)
            socket.send(JSON.stringify(res))
          } catch (err) {
            socket.send(JSON.stringify({ type: "error", message: String(err) }))
          }
        })

        socket.on("close", () => {
          this.clients.delete(clientId)
        })
      })

      app.get("/health", async () => ({
        status: "ok",
        uptime: process.uptime(),
        engines: orchestrator.getAvailableEngines(),
        channels: channelManager.getConnectedChannels(),
        users: multiUser.listUsers().length,
      }))

      app.post<{ Body: { message: string; userId?: string } }>(
        "/message",
        async (req) => {
          const { message, userId = config.DEFAULT_USER_ID } = req.body
          const filtered = filterPrompt(message, userId)
          const safePrompt = filtered.sanitized
          const { messages, systemContext } = await memory.buildContext(userId, safePrompt)
          const response = await orchestrator.generate("reasoning", {
            prompt: systemContext ? `${systemContext}\n\nUser: ${safePrompt}` : safePrompt,
            context: messages,
          })

          await memory.save(userId, safePrompt, { role: "user" })
          await memory.save(userId, response, { role: "assistant" })

          return { response }
        },
      )
    })
  }

  private async handle(msg: any): Promise<any> {
    const userId = msg.userId ?? config.DEFAULT_USER_ID

    await multiUser.getOrCreate(userId, "gateway")

    if (!multiUser.isOwner(userId) && msg.type !== "message") {
      return { type: "error", message: "Unauthorized for this action" }
    }

    switch (msg.type) {
      case "message": {
        const filtered = filterPrompt(msg.content, userId)
        const safePrompt = filtered.sanitized
        const { messages, systemContext } = await memory.buildContext(userId, safePrompt)
        const response = await orchestrator.generate("reasoning", {
          prompt: systemContext ? `${systemContext}\n\nUser: ${safePrompt}` : safePrompt,
          context: messages,
        })
        await memory.save(userId, safePrompt, { role: "user" })
        await memory.save(userId, response, { role: "assistant" })
        return { type: "response", content: response, requestId: msg.requestId }
      }
      case "status":
        return {
          type: "status",
          engines: orchestrator.getAvailableEngines(),
          channels: channelManager.getConnectedChannels(),
          daemon: daemon.healthCheck(),
          requestId: msg.requestId,
        }
      case "broadcast":
        await channelManager.broadcast(msg.content)
        return { type: "ok", requestId: msg.requestId }
      default:
        return { type: "error", message: `unknown type: ${msg.type}` }
    }
  }

  async start(): Promise<void> {
    await this.app.listen({ port: this.port, host: "127.0.0.1" })
    logger.info(`gateway running at ws://127.0.0.1:${this.port}`)
  }

  async stop(): Promise<void> {
    await this.app.close()
  }

  broadcast(payload: unknown): void {
    const raw = JSON.stringify(payload)
    for (const [, socket] of this.clients) {
      try {
        socket.send(raw)
      } catch {
        continue
      }
    }
  }
}

export const gateway = new GatewayServer()
