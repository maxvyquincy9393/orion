/**
 * @file webhooks.ts
 * @description WhatsApp webhook routes — verification + ingest.
 *
 * ARCHITECTURE:
 *   Extracted from gateway/server.ts. Handles GET/POST /webhooks/whatsapp.
 */

import type { FastifyInstance } from "fastify"

import { whatsAppChannel } from "../../channels/whatsapp.js"
import { createLogger } from "../../logger.js"
import { verifyWebhook } from "../webhook-verifier.js"

const logger = createLogger("gateway")

export function registerWebhooks(app: FastifyInstance): void {
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
      const body = JSON.stringify(req.body)
      const channel = "whatsapp"
      if (!verifyWebhook(channel, body, req.headers as Record<string, string>)) {
        logger.warn("webhook signature verification failed", { channel })
        return reply.status(401).send({ error: "Invalid webhook signature" })
      }

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
}
