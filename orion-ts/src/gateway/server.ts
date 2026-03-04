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
 * - Rate limiting, CORS, security headers
 */

import crypto from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import { daemon } from "../background/daemon.js"
import { channelManager } from "../channels/manager.js"
import { whatsAppChannel } from "../channels/whatsapp.js"
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

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_USAGE_DAYS = 30
const DEFAULT_USAGE_DAYS = 7

/** Maximum request body size (1 MB) to prevent memory DoS */
const MAX_BODY_SIZE = 1_048_576

/** Rate limit: max requests per window per IP */
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000

/** CORS: allowed origins (configurable via GATEWAY_CORS_ORIGINS env var, comma-separated) */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  (process.env.GATEWAY_CORS_ORIGINS ?? `http://127.0.0.1:${config.WEBCHAT_PORT},http://localhost:${config.WEBCHAT_PORT}`)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

/** Read version from package.json once at startup */
function readPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const pkgPath = resolve(__dirname, "..", "..", "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const APP_VERSION = readPackageVersion()

// ── Rate Limiter ─────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(ip)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now })
    return false
  }

  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

function getRateLimitRemaining(ip: string): number {
  const entry = rateLimitStore.get(ip)
  if (!entry) return RATE_LIMIT_MAX
  const now = Date.now()
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) return RATE_LIMIT_MAX
  return Math.max(0, RATE_LIMIT_MAX - entry.count)
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip)
    }
  }
}, 300_000).unref()

// ── Types ────────────────────────────────────────────────────────────────────

type SocketLike = {
  send: (payload: string) => void
  close: (code?: number) => void
  on: (event: "message" | "close", handler: (...args: unknown[]) => void) => void
}

/** Typed gateway response payloads */
interface GatewayResponse {
  type: string
  requestId?: unknown
  [key: string]: unknown
}

interface GatewayErrorResponse extends GatewayResponse {
  type: "error"
  message: string
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

function timingSafeTokenEquals(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate)
  const expectedBuffer = Buffer.from(expected)

  if (candidateBuffer.length !== expectedBuffer.length) {
    // Equalize work on mismatch to reduce timing side-channel signal.
    const maxLength = Math.max(candidateBuffer.length, expectedBuffer.length, 1)
    const candidatePadded = Buffer.alloc(maxLength)
    const expectedPadded = Buffer.alloc(maxLength)
    candidateBuffer.copy(candidatePadded)
    expectedBuffer.copy(expectedPadded)
    crypto.timingSafeEqual(candidatePadded, expectedPadded)
    return false
  }

  return crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
}

function isAdminTokenAuthorized(candidate: unknown, configuredToken: string | undefined): boolean {
  if (!isConfiguredAdminToken(configuredToken)) {
    return false
  }

  if (typeof candidate !== "string") {
    return false
  }

  return timingSafeTokenEquals(candidate, configuredToken)
}

/**
 * Extract admin token from Authorization header (preferred) or query string (legacy).
 * Authorization: Bearer <token> takes precedence over ?adminToken=.
 */
function extractAdminToken(req: { headers: Record<string, string | undefined>; query: Record<string, unknown> }): string | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token.length > 0) return token
  }
  // Legacy fallback — query string (log warning)
  const queryToken = req.query.adminToken
  if (typeof queryToken === "string" && queryToken.trim().length > 0) {
    logger.warn("admin token passed via query string — use Authorization header instead")
    return queryToken.trim()
  }
  return null
}

/**
 * Extract Bearer token from Authorization header for API auth.
 */
function extractBearerToken(req: { headers: Record<string, string | undefined> }): string | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    return token.length > 0 ? token : null
  }
  return null
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
  private app = Fastify({
    logger: false,
    bodyLimit: MAX_BODY_SIZE,
  })
  private clients = new Map<string, SocketLike>()
  private voiceSessions = new Map<string, () => void>() // userId -> stop function

  constructor(private port = config.GATEWAY_PORT) {
    this.registerRoutes()
  }

  private registerRoutes(): void {
    this.app.register(websocketPlugin)

    // ── Security Headers ───────────────────────────────────────────
    this.app.addHook("onRequest", async (_req, reply) => {
      reply.header("X-Content-Type-Options", "nosniff")
      reply.header("X-Frame-Options", "DENY")
      reply.header("X-XSS-Protection", "1; mode=block")
      reply.header("Referrer-Policy", "strict-origin-when-cross-origin")
      reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
      if (process.env.NODE_ENV === "production") {
        reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
      }
    })

    // ── CORS (origin-restricted) ───────────────────────────────────
    this.app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin
      if (origin && ALLOWED_ORIGINS.has(origin)) {
        reply.header("Access-Control-Allow-Origin", origin)
        reply.header("Vary", "Origin")
      }
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
      reply.header("Access-Control-Max-Age", "86400")
      if (req.method === "OPTIONS") {
        return reply.code(204).send()
      }
    })

    // ── Rate Limiting ──────────────────────────────────────────────
    this.app.addHook("onRequest", async (req, reply) => {
      // Skip rate limiting for health checks
      if (req.url === "/health") return

      const ip = req.ip
      if (isRateLimited(ip)) {
        logger.warn("rate limit exceeded", { ip, url: req.url })
        return reply.code(429).send({
          error: "Too many requests",
          retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
        })
      }
      reply.header("X-RateLimit-Limit", String(RATE_LIMIT_MAX))
      reply.header("X-RateLimit-Remaining", String(getRateLimitRemaining(ip)))
    })

    // ── Global Error Handler ───────────────────────────────────────
    this.app.setErrorHandler(async (error: Error, _req, reply) => {
      logger.error("unhandled route error", { error: error.message, stack: error.stack })
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500
      return reply.code(statusCode).send({
        error: error.message ?? "Internal Server Error",
      })
    })

    this.app.register(async (app) => {
      app.get("/ws", { websocket: true }, async (socket, req) => {
        const token = this.extractToken(req as unknown as { headers: Record<string, string | undefined>; query: Record<string, unknown> })
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

        await this.attachAuthenticatedClient(socket as unknown as SocketLike, auth)
      })

      app.get("/health", async () => ({
        status: "ok",
        version: APP_VERSION,
        uptime: Math.floor(process.uptime()),
        engines: orchestrator.getAvailableEngines(),
        channels: channelManager.getConnectedChannels(),
        users: multiUser.listUsers().length,
        memory: { initialized: true },
        daemon: daemon.isRunning(),
      }))

      app.post<{ Body?: { message?: unknown; userId?: unknown } }>(
        "/message",
        async (req, reply) => {
          // Require Bearer token authentication
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          const message = asString(req.body?.message)
          if (message === null) {
            return reply.code(400).send({ error: "Invalid body: 'message' must be a string" })
          }

          const userId = auth.userId
          const response = await this.handleUserMessage(userId, message, "webchat")
          return { response }
        },
      )

      app.get<{ Querystring: Record<string, unknown> }>(
        "/webhooks/whatsapp",
        async (req, reply) => {
          const verification = whatsAppChannel.verifyCloudWebhook(req.query)
          if (!verification.ok) {
            return reply.code(verification.statusCode).send({ error: verification.error })
          }
          return reply.type("text/plain").send(verification.challenge ?? "")
        },
      )

      app.post<{ Body?: unknown }>(
        "/webhooks/whatsapp",
        async (req, reply) => {
          if (!whatsAppChannel.isCloudWebhookEnabled()) {
            return reply.code(503).send({ error: "WhatsApp Cloud webhook is not configured" })
          }

          const ingest = await whatsAppChannel.handleCloudWebhookPayload(req.body)
          return reply.code(200).send({
            received: true,
            processed: ingest.processed,
            ignored: ingest.ignored,
          })
        },
      )

      app.get<{ Querystring: { userId?: string; days?: string } }>(
        "/api/usage/summary",
        async (req, reply) => {
          // Require Bearer token authentication
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          // Users can only query their own usage unless they pass a userId AND are the owner
          const requestedUserId = req.query.userId ?? auth.userId
          if (requestedUserId !== auth.userId && !multiUser.isOwner(auth.userId)) {
            return reply.code(403).send({ error: "Cannot query another user's usage" })
          }

          const days = parseDaysParam(req.query.days)
          const { startDate, endDate } = buildDateRange(days)
          const summary = await usageTracker.getUserSummary(requestedUserId, startDate, endDate)

          return {
            userId: requestedUserId,
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

          // Accept admin token from Authorization header (preferred) or query string (legacy)
          const adminCandidate = extractAdminToken(
            req as { headers: Record<string, string | undefined>; query: Record<string, unknown> },
          )
          if (!isAdminTokenAuthorized(adminCandidate, configuredAdminToken)) {
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

      // ── Model Selection API ──────────────────────────────────────────

      app.get("/api/models", async (req, reply) => {
        // Require auth for model listing
        const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
        if (!token) {
          return reply.code(401).send({ error: "Authorization header with Bearer token required" })
        }
        const auth = await authenticateWebSocket(token)
        if (!auth) {
          return reply.code(403).send({ error: "Invalid or expired token" })
        }

        const available = orchestrator.getAvailableEngines()
        const { ENGINE_MODEL_CATALOG } = await import("../engines/model-preferences.js")

        const engines = available.map((name) => ({
          name,
          displayName: ENGINE_MODEL_CATALOG[name]?.displayName ?? name,
          models: ENGINE_MODEL_CATALOG[name]?.models ?? [],
        }))

        return { engines, count: engines.length }
      })

      app.post<{ Body?: { userId?: string; engine?: string; model?: string } }>(
        "/api/models/select",
        async (req, reply) => {
          // Require auth for model selection
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          const { modelPreferences } = await import("../engines/model-preferences.js")
          const userId = auth.userId
          const engine = asString(req.body?.engine)
          const model = asString(req.body?.model)

          if (!engine) {
            return reply.code(400).send({ error: "'engine' is required" })
          }

          const available = orchestrator.getAvailableEngines()
          if (!available.includes(engine)) {
            return reply.code(400).send({
              error: `Engine '${engine}' is not available`,
              available,
            })
          }

          const pref = model
            ? modelPreferences.setModel(userId, engine, model)
            : modelPreferences.setEngine(userId, engine)

          return { ok: true, userId, preference: pref }
        },
      )

      app.delete<{ Querystring: { userId?: string } }>(
        "/api/models/select",
        async (req, reply) => {
          // Require auth for model reset
          const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
          if (!token) {
            return reply.code(401).send({ error: "Authorization header with Bearer token required" })
          }
          const auth = await authenticateWebSocket(token)
          if (!auth) {
            return reply.code(403).send({ error: "Invalid or expired token" })
          }

          const { modelPreferences } = await import("../engines/model-preferences.js")
          const userId = auth.userId
          modelPreferences.reset(userId)
          return { ok: true, userId, preference: "auto" }
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

    socket.on("message", async (...args: unknown[]) => {
      const raw = args[0] as Buffer
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

  private async handle(msg: GatewayClientMessage, auth?: AuthContext, socket?: SocketLike): Promise<GatewayResponse> {
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
  ): Promise<GatewayResponse> {
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

  private async handleVoiceStop(userId: string, requestId?: unknown): Promise<GatewayResponse> {
    this.stopVoiceSession(userId, "client request")
    return { type: "voice_stopped", requestId }
  }

  private async handleWakeWord(userId: string, msg: GatewayClientMessage): Promise<GatewayResponse> {
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

  private extractToken(req: { headers: Record<string, string | undefined>; query: Record<string, unknown> }): string | null {
    const queryToken = req.query?.token
    if (typeof queryToken === "string" && queryToken.trim().length > 0) {
      return queryToken.trim()
    }

    if (Array.isArray(queryToken)) {
      const first = (queryToken as unknown[]).find((value) => typeof value === "string" && (value as string).trim().length > 0)
      if (typeof first === "string") {
        return first.trim()
      }
    }

    const authHeader = req.headers?.authorization
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
  extractAdminToken,
  isRateLimited,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  APP_VERSION,
}
