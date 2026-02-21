import crypto from "node:crypto"

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import { orchestrator } from "../engines/orchestrator.js"
import { channelManager } from "../channels/manager.js"
import { memory } from "../memory/store.js"
import { saveMessage } from "../database/index.js"
import { daemon } from "../background/daemon.js"
import { multiUser } from "../multiuser/manager.js"
import { filterPrompt } from "../security/prompt-filter.js"
import { createLogger } from "../logger.js"
import { sessionStore } from "../sessions/session-store.js"
import { causalGraph } from "../memory/causal-graph.js"
import { profiler } from "../memory/profiler.js"
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
          const response = await this.handleUserMessage(userId, message, "webchat")
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
        const response = await this.handleUserMessage(userId, msg.content, "webchat")
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

  private async handleUserMessage(userId: string, rawMessage: string, channel: string): Promise<string> {
    const filtered = filterPrompt(rawMessage, userId)
    const safePrompt = filtered.sanitized
    const { messages, systemContext } = await memory.buildContext(userId, safePrompt)
    const response = await orchestrator.generate("reasoning", {
      prompt: systemContext ? `${systemContext}\n\nUser: ${safePrompt}` : safePrompt,
      context: messages,
    })

    const now = Date.now()
    const userMeta = { role: "user", channel, category: "event", level: 0 }
    const assistantMeta = { role: "assistant", channel, category: "summary", level: 0 }

    await Promise.all([
      saveMessage(userId, "user", safePrompt, channel, userMeta),
      memory.save(userId, safePrompt, userMeta),
    ])
    sessionStore.addMessage(userId, channel, { role: "user", content: safePrompt, timestamp: now })
    void this.runAsyncExtractors(userId, safePrompt, "user")

    await Promise.all([
      saveMessage(userId, "assistant", response, channel, assistantMeta),
      memory.save(userId, response, assistantMeta),
    ])
    sessionStore.addMessage(userId, channel, { role: "assistant", content: response, timestamp: Date.now() })

    return response
  }

  private runAsyncExtractors(userId: string, message: string, role: "user" | "assistant"): void {
    void profiler
      .extractFromMessage(userId, message, role)
      .then(({ facts, opinions }) => profiler.updateProfile(userId, facts, opinions))
      .catch((error) => logger.warn("Profiler async extraction failed", { userId, error }))

    if (role === "user") {
      void causalGraph
        .extractAndUpdate(userId, message)
        .catch((error) => logger.warn("Causal graph async update failed", { userId, error }))
    }
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
