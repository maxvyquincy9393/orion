/**
 * @file mobile.ts
 * @description Mobile push token registration + background sync delta.
 *
 * ARCHITECTURE:
 *   Extracted from gateway/server.ts. Handles POST /api/mobile/register-token
 *   and GET /api/sync/delta.
 */

import type { FastifyInstance } from "fastify"

import { memory } from "../../memory/store.js"
import { authenticateWebSocket } from "../auth-middleware.js"
import { extractBearerToken, asString } from "./helpers.js"

export function registerMobile(app: FastifyInstance): void {
  /**
   * POST /api/mobile/register-token
   * Called by the mobile app on startup to register its Expo push token.
   */
  app.post<{
    Body?: { token?: string; platform?: string; appVersion?: string }
  }>("/api/mobile/register-token", async (req, reply) => {
    const bearerToken = extractBearerToken(
      req as { headers: Record<string, string | undefined> },
    )
    if (!bearerToken) {
      return reply.code(401).send({ error: "Authorization required" })
    }
    const auth = await authenticateWebSocket(bearerToken)
    if (!auth) {
      return reply.code(403).send({ error: "Invalid token" })
    }

    const pushToken = asString(req.body?.token)
    const platform = asString(req.body?.platform)
    const appVersion = asString(req.body?.appVersion) ?? ""

    if (!pushToken) {
      return reply.code(400).send({ error: "'token' is required" })
    }
    if (platform !== "ios" && platform !== "android") {
      return reply.code(400).send({ error: "'platform' must be 'ios' or 'android'" })
    }

    const { pushTokenStore } = await import("../push-tokens.js")
    await pushTokenStore.register(auth.userId, pushToken, platform, appVersion)

    return { ok: true, userId: auth.userId }
  })

  /**
   * GET /api/sync/delta
   * Polled by the mobile background task for battery-efficient sync.
   */
  app.get<{ Querystring: { since?: string } }>(
    "/api/sync/delta",
    async (req, reply) => {
      const bearerToken = extractBearerToken(
        req as { headers: Record<string, string | undefined> },
      )
      if (!bearerToken) {
        return reply.code(401).send({ error: "Authorization required" })
      }
      const auth = await authenticateWebSocket(bearerToken)
      if (!auth) {
        return reply.code(403).send({ error: "Invalid token" })
      }

      const userId = auth.userId
      const _sinceDate = req.query.since
        ? new Date(req.query.since)
        : new Date(Date.now() - 24 * 60 * 60 * 1000)
      void _sinceDate

      const [contextResult, calendarAlerts] = await Promise.all([
        memory.buildContext(userId, "recent sync", 5),
        import("../../services/calendar.js")
          .then((m) => m.calendarService.getUpcomingAlerts(30))
          .catch(() => [] as import("../../services/calendar.js").CalendarAlert[]),
      ])

      const widgetData = {
        status: { state: "ready", lastSync: new Date().toISOString() },
        calendar: {
          events: calendarAlerts.slice(0, 3).map((e) => ({
            title: e.title,
            time: e.start instanceof Date ? e.start.toISOString() : String(e.start),
            isNext: true,
          })),
        },
        contextSummary: contextResult.systemContext.slice(0, 200),
      }

      return {
        messages: [],
        widgetData,
        hasMore: false,
        syncedAt: new Date().toISOString(),
      }
    },
  )
}
