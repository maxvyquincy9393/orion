/**
 * @file models.ts
 * @description Model listing, selection, and reset API routes.
 *
 * ARCHITECTURE:
 *   Extracted from gateway/server.ts. Handles GET/POST/DELETE /api/models/*.
 */

import type { FastifyInstance } from "fastify"

import { orchestrator } from "../../engines/orchestrator.js"
import { authenticateWebSocket } from "../auth-middleware.js"
import { extractBearerToken, asString } from "./helpers.js"

export function registerModelRoutes(app: FastifyInstance): void {
  app.get("/api/models", async (req, reply) => {
    const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
    if (!token) {
      return reply.code(401).send({ error: "Authorization header with Bearer token required" })
    }
    const auth = await authenticateWebSocket(token)
    if (!auth) {
      return reply.code(403).send({ error: "Invalid or expired token" })
    }

    const available = orchestrator.getAvailableEngines()
    const { ENGINE_MODEL_CATALOG } = await import("../../engines/model-preferences.js")

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
      const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
      if (!token) {
        return reply.code(401).send({ error: "Authorization header with Bearer token required" })
      }
      const auth = await authenticateWebSocket(token)
      if (!auth) {
        return reply.code(403).send({ error: "Invalid or expired token" })
      }

      const { modelPreferences } = await import("../../engines/model-preferences.js")
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
      const token = extractBearerToken(req as { headers: Record<string, string | undefined> })
      if (!token) {
        return reply.code(401).send({ error: "Authorization header with Bearer token required" })
      }
      const auth = await authenticateWebSocket(token)
      if (!auth) {
        return reply.code(403).send({ error: "Invalid or expired token" })
      }

      const { modelPreferences } = await import("../../engines/model-preferences.js")
      const userId = auth.userId
      modelPreferences.reset(userId)
      return { ok: true, userId, preference: "auto" }
    },
  )
}
