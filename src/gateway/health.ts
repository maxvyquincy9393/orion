/**
 * @file health.ts
 * @description Health check payload builder for the GET /health endpoint.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by the Fastify GET /health route in server.ts.
 *   Queries DB liveness, reads channel health states, reads outbox depth.
 *   Never throws — always returns a valid HealthPayload.
 *   HTTP response: 200 when status = "ok", 503 when "degraded" or "down".
 *
 * @module gateway/health
 */

import { prisma } from "../database/index.js"
import { outbox } from "../channels/outbox.js"
import { channelHealthMonitor } from "./channel-health-monitor.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.health")

/** Shape of the GET /health response body. */
export interface HealthPayload {
  /** Overall system status. */
  status: "ok" | "degraded" | "down"
  /** Process uptime in seconds. */
  uptime: number
  /** Application version string. */
  version: string
  /** Database liveness probe result. */
  db: "ok" | "error"
  /** Map of channelId → connected state. */
  channels: Record<string, boolean>
  /** Outbox queue depth snapshot. */
  outbox: { pending: number; deadLetters: number }
}

/**
 * Build the health check payload by probing all subsystems.
 * Never throws — subsystem failures are reflected in the payload.
 *
 * @param version - Application version string (from package.json)
 * @returns Fully populated HealthPayload
 */
export async function buildHealthPayload(version: string): Promise<HealthPayload> {
  let db: "ok" | "error" = "ok"
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (err) {
    log.warn("health DB probe failed", { err: String(err) })
    db = "error"
  }

  const channelList = channelHealthMonitor.getHealth()
  const channels: Record<string, boolean> = {}
  for (const ch of channelList) {
    channels[ch.channelId] = ch.connected
  }

  const outboxStatus = outbox.getStatus()
  const connectedCount = Object.values(channels).filter(Boolean).length

  const status: HealthPayload["status"] =
    db === "error" ? "down"
    : connectedCount === 0 ? "degraded"
    : "ok"

  return {
    status,
    uptime: Math.floor(process.uptime()),
    version,
    db,
    channels,
    outbox: outboxStatus,
  }
}
