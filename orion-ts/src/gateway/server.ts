/**
 * Gateway server - WebSocket + HTTP transport layer.
 *
 * Handles incoming connections from WebChat, external webhooks, and the REST API.
 * All message processing is delegated to MessagePipeline.
 *
 * Responsibilities:
 * - WebSocket connection lifecycle (connect, disconnect)
 * - HTTP route definitions
 * - Auth/pairing checks (before message reaches pipeline)
 * - Transport-level validation/normalization
 * - Usage summary API endpoints
 */

import crypto from "node:crypto"

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import { daemon } from "../background/daemon.js"
import { channelManager } from "../channels/manager.js"
import config from "../config.js"
import { handleIncomingUserMessage, estimateTokensFromText } from "../core/incoming-message-service.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
import { multiUser } from "../multiuser/manager.js"
import { usageTracker } from "../observability/usage-tracker.js"
import { voice } from "../voice/bridge.js"
import {
  authenticateWebSocket,
  getAuthFailure,
  type AuthContext,
} from "./auth-middleware.js"

const logger = createLogger("gateway")

const MAX_USAGE_DAYS = 30
const DEFAULT_USAGE_DAYS = 7

type SocketLike = {
  send: (payload: string) => void
  close: (code?: number) => void
  on: (event: "message" | "close", handler: (...args: any[]) => void) => void
}

interface GatewayClientMessage {
  type: string
  requestId?: unknown
  userId?: string
  content?: string
  keyword?: string
  windowSeconds?: number
}

function safeSend(socket: Pick<SocketLike, "send">, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function parseDaysParam(raw: unknown, fallback = DEFAULT_USAGE_DAYS): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(MAX_USAGE_DAYS, Math.max(1, parsed))
}

function buildDateRange(days: number): { startDate: Date; endDate: Date } {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days)
  return { startDate, endDate }
}

function isConfiguredAdminToken(token: string | undefined): token is string {
  return typeof token === "string" && token.trim().length > 0
}

function isAdminTokenAuthorized(candidate: unknown, configuredToken: string | undefined): boolean {
  if (!isConfiguredAdminToken(configuredToken)) {
    return false
  }

  return typeof candidate === "string" && candidate === configuredToken
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  return value
}

function normalizeIncomingClientMessage(input: unknown): GatewayClientMessage {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid message payload: expected object")
  }

  const raw = input as Record<string, unknown>
  const type = asNonEmptyString(raw.type)
  if (!type) {
    throw new Error("Invalid message payload: missing 'type'")
  }

  const userId = asString(raw.userId) ?? undefined
  const content = asString(raw.content) ?? undefined
  const keyword = asString(raw.keyword) ?? undefined
  const windowSecondsRaw = asFiniteNumber(raw.windowSeconds)
  const windowSeconds = windowSecondsRaw === null
    ? undefined
    : Math.min(30, Math.max(1, windowSecondsRaw))

  return {
    type,
    requestId: raw.requestId,
    userId,
    content,
    keyword,
    windowSeconds,
  }
}

function ensureMessageContent(content: string | undefined, type: string): string {
  if (typeof content !== "string") {
    throw new Error(`Invalid '${type}' payload: 'content' must be a string`)
  }
  return content
}

function buildConnectedPayload(clientId: string) {
  return {
    type: "connected",
    clientId,
    engines: orchestrator.getAvailableEngines(),
    channels: channelManager.getConnectedChannels(),
    daemon: daemon.healthCheck(),
  }
}

function buildStatusPayload(requestId: unknown) {
  return {
    type: "status",
    engines: orchestrator.getAvailableEngines(),
    channels: channelManager.getConnectedChannels(),
    daemon: daemon.healthCheck(),
    requestId,
  }
}

export class GatewayServer {
  private app = Fastify({ logger: false })
  private clients = new Map<string, SocketLike>()
  private voiceSessions = new Map<string, () => void>() // userId -> stop function

  constructor(private port = config.GATEWAY_PORT) {
    this.registerRoutes()
  }

  private registerRoutes(): void {
    this.app.register(websocketPlugin)

    this.app.register(async (app) => {
      app.get("/ws", { websocket: true }, async (socket: SocketLike, req: any) => {
        const token = this.extractToken(req)
        const auth = await authenticateWebSocket(token)
        if (!auth) {
          const failure = getAuthFailure(token)
          safeSend(socket, {
            type: "error",
            message: failure.message,
            statusCode: failure.statusCode,
            retryAfterSeconds: failure.retryAfterSeconds,
          })
          socket.close(1008)
          return
        }

        await this.attachAuthenticatedClient(socket, auth)
      })

      app.get("/health", async () => ({
        status: "ok",
        uptime: process.uptime(),
        engines: orchestrator.getAvailableEngines(),
        channels: channelManager.getConnectedChannels(),
        users: multiUser.listUsers().length,
      }))

      app.post<{ Body?: { message?: unknown; userId?: unknown } }>(
        "/message",
        async (req, reply) => {
          const message = asString(req.body?.message)
          if (message === null) {
            return reply.code(400).send({ error: "Invalid body: 'message' must be a string" })
          }

          const userId = asString(req.body?.userId) ?? config.DEFAULT_USER_ID
          const response = await this.handleUserMessage(userId, message, "webchat")
          return { response }
        },
      )

      app.get<{ Querystring: { userId?: string; days?: string } }>(
        "/api/usage/summary",
        async (req) => {
          const userId = req.query.userId ?? config.DEFAULT_USER_ID
          const days = parseDaysParam(req.query.days)
          const { startDate, endDate } = buildDateRange(days)
          const summary = await usageTracker.getUserSummary(userId, startDate, endDate)

          return {
            userId,
            period: { start: startDate, end: endDate, days },
            summary,
          }
        },
      )

      app.get<{ Querystring: { days?: string; adminToken?: string } }>(
        "/api/usage/global",
        async (req, reply) => {
          const configuredAdminToken = process.env.ADMIN_TOKEN
          if (!isConfiguredAdminToken(configuredAdminToken)) {
            return reply.code(503).send({ error: "Admin usage endpoint is not configured" })
          }

          if (!isAdminTokenAuthorized(req.query.adminToken, configuredAdminToken)) {
            return reply.code(401).send({ error: "Unauthorized" })
          }

          const days = parseDaysParam(req.query.days)
          const { startDate, endDate } = buildDateRange(days)
          const summary = await usageTracker.getGlobalSummary(startDate, endDate)

          return {
            period: { start: startDate, end: endDate, days },
            summary,
          }
        },
      )
    })
  }

  private async attachAuthenticatedClient(socket: SocketLike, auth: AuthContext): Promise<void> {
    const clientId = crypto.randomUUID()
    let socketClosed = false

    this.clients.set(clientId, socket)
    logger.info(`client connected: ${clientId}`, {
      userId: auth.userId,
      channel: auth.channel,
    })

    safeSend(socket, buildConnectedPayload(clientId))

    socket.on("message", async (raw: Buffer) => {
      if (socketClosed) {
        return
      }

      try {
        const parsed = JSON.parse(raw.toString())
        const msg = normalizeIncomingClientMessage(parsed)
        const res = await this.handle(msg, auth, socket)
        safeSend(socket, res)
      } catch (err) {
        safeSend(socket, { type: "error", message: String(err) })
      }
    })

    socket.on("close", () => {
      socketClosed = true
      this.clients.delete(clientId)
      this.stopVoiceSession(auth.userId, "socket close")
      memory.clearFeedback(auth.userId)
    })
  }

  private async handle(msg: GatewayClientMessage, auth?: AuthContext, socket?: SocketLike): Promise<any> {
    const userId = auth?.userId ?? msg.userId ?? config.DEFAULT_USER_ID

    await multiUser.getOrCreate(userId, "gateway")

    if (auth && msg.userId && msg.userId !== auth.userId) {
      return { type: "error", message: "Token user does not match request user" }
    }

    if (!multiUser.isOwner(userId) && msg.type !== "message") {
      return { type: "error", message: "Unauthorized for this action" }
    }

    switch (msg.type) {
      case "message": {
        const content = ensureMessageContent(msg.content, "message")
        const response = await this.handleUserMessage(userId, content, "webchat")
        return { type: "response", content: response, requestId: msg.requestId }
      }
      case "status":
        return buildStatusPayload(msg.requestId)
      case "broadcast": {
        const content = ensureMessageContent(msg.content, "broadcast")
        await channelManager.broadcast(content)
        return { type: "ok", requestId: msg.requestId }
      }
      case "voice_start":
        return this.handleVoiceStart(userId, msg, socket)
      case "voice_stop":
        return this.handleVoiceStop(userId, msg.requestId)
      case "voice_wake_word":
        return this.handleWakeWord(userId, msg)
      default:
        return { type: "error", message: `unknown type: ${msg.type}` }
    }
  }

  async start(): Promise<void> {
    await this.app.listen({ port: this.port, host: config.GATEWAY_HOST })
    logger.info(`gateway running at ws://${config.GATEWAY_HOST}:${this.port}`)
  }

  private async handleUserMessage(userId: string, rawMessage: string, channel: string): Promise<string> {
    return handleIncomingUserMessage(userId, rawMessage, channel)
  }

  private stopVoiceSession(userId: string, reason: string): boolean {
    const stopFn = this.voiceSessions.get(userId)
    if (!stopFn) {
      return false
    }

    try {
      stopFn()
      logger.info("voice session stopped", { userId, reason })
    } catch (err) {
      logger.warn("error stopping voice session", { userId, reason, error: String(err) })
    } finally {
      this.voiceSessions.delete(userId)
    }

    return true
  }

  private async handleVoiceStart(
    userId: string,
    msg: GatewayClientMessage,
    socket?: SocketLike,
  ): Promise<any> {
    if (!socket) {
      return { type: "error", message: "Voice mode requires an active WebSocket", requestId: msg.requestId }
    }

    if (this.voiceSessions.has(userId)) {
      return { type: "error", message: "Voice session already active", requestId: msg.requestId }
    }

    try {
      const stopVoice = await voice.startStreamingConversation(
        (transcript) => {
          safeSend(socket, { type: "voice_transcript", text: transcript })

          // Reuse the same transport path as text messages so hooks, usage
          // tracking, and MemRL feedback side-channel stay consistent.
          void this.handleUserMessage(userId, transcript, "voice")
            .then((response) => {
              safeSend(socket, {
                type: "assistant_transcript",
                text: response,
                requestId: msg.requestId,
              })
            })
            .catch((err) => {
              logger.error("voice pipeline error", err)
              safeSend(socket, {
                type: "error",
                message: "Failed to process voice input",
                requestId: msg.requestId,
              })
            })
        },
        (audioChunk) => {
          safeSend(socket, {
            type: "voice_audio",
            data: audioChunk,
            requestId: msg.requestId,
          })
        },
      )

      this.voiceSessions.set(userId, stopVoice)
      logger.info("voice session started", { userId })
      return { type: "voice_started", requestId: msg.requestId }
    } catch (err) {
      logger.error("voice_start failed", { userId, error: String(err) })
      return {
        type: "error",
        message: `Failed to start voice: ${String(err)}`,
        requestId: msg.requestId,
      }
    }
  }

  private async handleVoiceStop(userId: string, requestId?: unknown): Promise<any> {
    this.stopVoiceSession(userId, "client request")
    return { type: "voice_stopped", requestId }
  }

  private async handleWakeWord(userId: string, msg: GatewayClientMessage): Promise<any> {
    const keyword = msg.keyword ?? "orion"
    const windowSeconds = msg.windowSeconds ?? 2

    try {
      const detected = await voice.checkWakeWord(keyword, windowSeconds)
      return {
        type: "wake_word_result",
        detected,
        keyword,
        requestId: msg.requestId,
      }
    } catch (err) {
      logger.error("wake_word check failed", { userId, error: String(err) })
      return {
        type: "error",
        message: `Wake word check failed: ${String(err)}`,
        requestId: msg.requestId,
      }
    }
  }

  async stop(): Promise<void> {
    for (const [userId] of this.voiceSessions.entries()) {
      this.stopVoiceSession(userId, "shutdown")
    }

    this.clients.clear()
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

  private extractToken(req: any): string | null {
    const queryToken = req?.query?.token
    if (typeof queryToken === "string" && queryToken.trim().length > 0) {
      return queryToken.trim()
    }

    if (Array.isArray(queryToken)) {
      const first = queryToken.find((value) => typeof value === "string" && value.trim().length > 0)
      if (typeof first === "string") {
        return first.trim()
      }
    }

    const authHeader = req?.headers?.authorization
    if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim()
      return token.length > 0 ? token : null
    }

    return null
  }
}

export const gateway = new GatewayServer()

export const __gatewayTestUtils = {
  parseDaysParam,
  isAdminTokenAuthorized,
  normalizeIncomingClientMessage,
  estimateTokensFromText,
}
