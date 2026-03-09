/**
 * @file usage.ts
 * @description Usage summary API routes — per-user and global.
 *
 * ARCHITECTURE:
 *   Extracted from gateway/server.ts. Handles GET /api/usage/summary + /api/usage/global.
 */

import type { FastifyInstance } from "fastify"

import { multiUser } from "../../multiuser/manager.js"
import { usageTracker } from "../../observability/usage-tracker.js"
import { authenticateWebSocket } from "../auth-middleware.js"
import {
  extractBearerToken,
  extractAdminToken,
  isConfiguredAdminToken,
  isAdminTokenAuthorized,
  parseDaysParam,
  buildDateRange,
} from "./helpers.js"

export function registerUsage(app: FastifyInstance): void {
  app.get<{ Querystring: { userId?: string; days?: string } }>(
    "/api/usage/summary",
    async (req, reply) => {
      const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
      if (!token) {
        return reply.code(401).send({ error: "Authorization header with Bearer token required" })
      }
      const auth = await authenticateWebSocket(token)
      if (!auth) {
        return reply.code(403).send({ error: "Invalid or expired token" })
      }

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
}
