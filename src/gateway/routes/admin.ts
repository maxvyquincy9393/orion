/**
 * @file admin.ts
 * @description Admin/system routes — health, metrics, CSRF, POST /message.
 *
 * ARCHITECTURE:
 *   Extracted from gateway/server.ts. Handles /health, /metrics,
 *   /api/csrf-token, /api/channels/health, POST /message.
 */

import type { FastifyInstance } from "fastify"

import { authenticateWebSocket } from "../auth-middleware.js"
import { channelHealthMonitor } from "../channel-health-monitor.js"
import { buildHealthPayload } from "../health.js"
import { registry, edithMetrics } from "../../observability/metrics.js"
import type { GatewayContext } from "./types.js"
import {
  extractBearerToken,
  extractAdminToken,
  isConfiguredAdminToken,
  isAdminTokenAuthorized,
  asString,
  generateCsrfToken,
  buildCsrfCookie,
  CSRF_HEADER_NAME,
  APP_VERSION,
} from "./helpers.js"

export function registerAdmin(app: FastifyInstance, ctx: GatewayContext): void {
  app.get("/health", async (_req, reply) => {
    const payload = await buildHealthPayload(APP_VERSION)
    const statusCode = payload.status === "ok" ? 200 : 503
    return reply.status(statusCode).send(payload)
  })

  app.get("/api/channels/health", async (req, reply) => {
    const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
    if (!token) {
      return reply.code(401).send({ error: "Authorization header with Bearer token required" })
    }
    const auth = await authenticateWebSocket(token)
    if (!auth) {
      return reply.code(403).send({ error: "Invalid or expired token" })
    }

    return { channels: channelHealthMonitor.getHealth() }
  })

  app.get("/metrics", async (req, reply) => {
    const configuredAdminToken = process.env.ADMIN_TOKEN
    if (!isConfiguredAdminToken(configuredAdminToken)) {
      return reply.code(503).send("# metrics endpoint requires ADMIN_TOKEN to be configured\n")
    }

    const adminCandidate = extractAdminToken(
      req as { headers: Record<string, string | undefined>; query: Record<string, unknown> },
    )
    if (!isAdminTokenAuthorized(adminCandidate, configuredAdminToken)) {
      return reply.code(401).send("# unauthorized\n")
    }

    edithMetrics.activeConnections.set(ctx.clients.size)

    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(registry.serialize())
  })

  app.post<{ Body?: { message?: unknown; userId?: unknown } }>(
    "/message",
    async (req, reply) => {
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
      const response = await ctx.handleUserMessage(userId, message, "webchat")
      return { response }
    },
  )

  app.get("/api/csrf-token", async (req, reply) => {
    const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
    if (!token) {
      return reply.code(401).send({ error: "Authorization header with Bearer token required" })
    }
    const auth = await authenticateWebSocket(token)
    if (!auth) {
      return reply.code(403).send({ error: "Invalid or expired token" })
    }

    const csrfToken = generateCsrfToken()
    reply.header("Set-Cookie", buildCsrfCookie(csrfToken))

    return { csrfToken, tokenType: CSRF_HEADER_NAME }
  })
}
