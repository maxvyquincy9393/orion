/**
 * @file server.ts
 * @description Gateway server — thin bootstrap for WebSocket + HTTP transport.
 *
 * ARCHITECTURE:
 *   Routes are split into focused modules under gateway/routes/.
 *   This file wires middleware (security headers, CORS, CSRF, rate limiting,
 *   API token auth) and delegates to route modules for all endpoints.
 *
 *   Route modules:
 *     routes/websocket.ts — /ws (WebSocket lifecycle + voice)
 *     routes/webhooks.ts  — /webhooks/whatsapp (GET verify + POST ingest)
 *     routes/mobile.ts    — /api/mobile/register-token, /api/sync/delta
 *     routes/models.ts    — /api/models (list, select, reset)
 *     routes/usage.ts     — /api/usage/summary, /api/usage/global
 *     routes/admin.ts     — /health, /metrics, /api/csrf-token, POST /message
 */

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import config from "../config.js"
import { handleIncomingUserMessage, estimateTokensFromText } from "../core/incoming-message-service.js"
import { createLogger } from "../logger.js"
import { checkApiToken, isLocalhostBinding, warnIfInsecure } from "./api-auth.js"
import { channelHealthMonitor } from "./channel-health-monitor.js"

// Route modules
import { registerWebSocket } from "./routes/websocket.js"
import { registerWebhooks } from "./routes/webhooks.js"
import { registerMobile } from "./routes/mobile.js"
import { registerModelRoutes } from "./routes/models.js"
import { registerUsage } from "./routes/usage.js"
import { registerAdmin } from "./routes/admin.js"
import type { GatewayContext, SocketLike } from "./routes/types.js"

// Re-export helpers for __gatewayTestUtils (test backward compat)
import {
  MAX_BODY_SIZE,
  ALLOWED_ORIGINS,
  CONTENT_SECURITY_POLICY,
  CSRF_HEADER_NAME,
  CSRF_COOKIE_NAME,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  APP_VERSION,
  rateLimiter,
  isRateLimited,
  parseDaysParam,
  isAdminTokenAuthorized,
  normalizeIncomingClientMessage,
  extractAdminToken,
  extractWebSocketToken,
  parseCookieHeader,
  shouldEnforceCsrfRequest,
  verifyCsrfRequest,
  buildCsrfCookie,
  normalizeRequestPath,
} from "./routes/helpers.js"

const logger = createLogger("gateway")

export class GatewayServer {
  private app = Fastify({
    logger: false,
    bodyLimit: MAX_BODY_SIZE,
  })
  private clients = new Map<string, SocketLike>()
  private voiceSessions = new Map<string, () => void>()

  constructor(private port = config.GATEWAY_PORT) {
    this.registerRoutes()
  }

  // ── Middleware ──────────────────────────────────────────────────────────────

  private registerMiddleware(): void {
    // Security Headers
    this.app.addHook("onRequest", async (_req, reply) => {
      reply.header("X-Content-Type-Options", "nosniff")
      reply.header("X-Frame-Options", "DENY")
      reply.header("X-XSS-Protection", "1; mode=block")
      reply.header("Referrer-Policy", "strict-origin-when-cross-origin")
      reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
      reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
      if (process.env.NODE_ENV === "production") {
        reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
      }
    })

    // CORS
    this.app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin
      if (origin && ALLOWED_ORIGINS.has(origin)) {
        reply.header("Access-Control-Allow-Origin", origin)
        reply.header("Vary", "Origin")
      }
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token")
      reply.header("Access-Control-Max-Age", "86400")
      if (req.method === "OPTIONS") {
        return reply.code(204).send()
      }
    })

    // CSRF
    this.app.addHook("onRequest", async (req, reply) => {
      const validation = verifyCsrfRequest({
        method: req.method,
        url: req.url,
        headers: req.headers as Record<string, unknown>,
      })
      if (!validation.ok) {
        logger.warn("csrf validation failed", {
          method: req.method,
          url: req.url,
          reason: validation.reason,
          ip: req.ip,
        })
        return reply.code(403).send({
          error: "CSRF validation failed",
          reason: validation.reason,
        })
      }
    })

    // Rate Limiting
    this.app.addHook("onRequest", async (req, reply) => {
      if (req.url === "/health" || req.url === "/metrics") return

      const ip = req.ip
      const decision = rateLimiter.consume(ip)
      if (decision.limited) {
        logger.warn("rate limit exceeded", { ip, url: req.url })
        return reply.code(429).send({
          error: "Too many requests",
          retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
        })
      }
      reply.header("X-RateLimit-Limit", String(decision.limit))
      reply.header("X-RateLimit-Remaining", String(decision.remaining))
    })

    // API Token Auth (non-localhost only)
    this.app.addHook("onRequest", async (req, reply) => {
      if (isLocalhostBinding(config.GATEWAY_HOST)) return

      const path = normalizeRequestPath(req.url)
      if (path === "/health" || path === "/ws" || path.startsWith("/webhooks/")) return

      if (!checkApiToken(req.headers.authorization)) {
        logger.warn("api token auth failed", { ip: req.ip, url: req.url })
        return reply.code(401).send({ error: "Unauthorized: valid Bearer token required" })
      }
    })

    // Global Error Handler
    this.app.setErrorHandler(async (error: Error, _req, reply) => {
      logger.error("unhandled route error", { error: error.message, stack: error.stack })
      const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500
      return reply.code(statusCode).send({
        error: error.message ?? "Internal Server Error",
      })
    })
  }

  // ── Route Registration ─────────────────────────────────────────────────────

  private registerRoutes(): void {
    this.app.register(websocketPlugin)
    this.registerMiddleware()

    this.app.register(async (app) => {
      const ctx: GatewayContext = {
        clients: this.clients,
        voiceSessions: this.voiceSessions,
        stopVoiceSession: this.stopVoiceSession.bind(this),
        handleUserMessage: this.handleUserMessage.bind(this),
      }

      registerWebSocket(app, ctx)
      registerWebhooks(app)
      registerMobile(app)
      registerModelRoutes(app)
      registerUsage(app)
      registerAdmin(app, ctx)

      // OpenAI-compatible API routes (Phase 42)
      if (config.OPENAI_COMPAT_API_ENABLED === 'true') {
        const { registerChatCompletions } = await import("../api/openai-compat/chat-completions.js")
        const { registerEmbeddings } = await import("../api/openai-compat/embeddings.js")
        const { registerModels } = await import("../api/openai-compat/models.js")
        registerChatCompletions(app)
        registerEmbeddings(app)
        registerModels(app)
        logger.info("openai-compat API routes registered")
      }
    })
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    warnIfInsecure()
    await this.app.listen({ port: this.port, host: config.GATEWAY_HOST })
    logger.info(`gateway running at ws://${config.GATEWAY_HOST}:${this.port}`)
  }

  async stop(): Promise<void> {
    for (const [userId] of this.voiceSessions.entries()) {
      this.stopVoiceSession(userId, "shutdown")
    }
    channelHealthMonitor.stopMonitoring()
    this.clients.clear()
    await this.app.close()
  }

  private async handleUserMessage(userId: string, rawMessage: string, channel: string): Promise<string> {
    return handleIncomingUserMessage(userId, rawMessage, channel)
  }

  private stopVoiceSession(userId: string, reason: string): boolean {
    const stopFn = this.voiceSessions.get(userId)
    if (!stopFn) return false

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

/** @internal Test helpers — do not use outside of __tests__ */
export const __gatewayTestUtils = {
  parseDaysParam,
  isAdminTokenAuthorized,
  normalizeIncomingClientMessage,
  estimateTokensFromText,
  extractAdminToken,
  extractWebSocketToken,
  parseCookieHeader,
  shouldEnforceCsrfRequest,
  verifyCsrfRequest,
  buildCsrfCookie,
  CSRF_HEADER_NAME,
  CSRF_COOKIE_NAME,
  isRateLimited,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  APP_VERSION,
  CONTENT_SECURITY_POLICY,
}
