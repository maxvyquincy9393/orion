/**
 * @file health.ts
 * @description Health and readiness check handlers for the gateway.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered as routes by gateway/server.ts.
 *   /health — liveness probe: returns 200 if the process is alive.
 *   /ready — readiness probe: returns 200 only when DB, engines, and memory are operational.
 *     Returns 503 with check details when any subsystem is not ready.
 *
 * SECURITY:
 *   Health endpoints are unauthenticated (required for load balancer probes).
 *   They must NOT expose sensitive data (no secrets, no user counts, no engine keys).
 */

import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { memory } from "../memory/store.js"
import { channelHealthMonitor } from "./channel-health-monitor.js"
import { outbox } from "../channels/outbox.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.health")

/** Result of a single subsystem readiness check. */
interface HealthCheck {
  /** Human-readable subsystem name. */
  name: string
  /** Whether the subsystem is operational. */
  ok: boolean
  /** Optional detail when the check fails (never includes secrets). */
  detail?: string
}

/** Aggregated readiness response body. */
interface ReadinessResult {
  /** True only when every check passes. */
  ready: boolean
  /** Per-subsystem check results. */
  checks: HealthCheck[]
  /** Process uptime in seconds (floored). */
  uptimeSeconds: number
}

/**
 * Liveness probe response.
 *
 * Always returns HTTP 200 as long as the Node.js process is alive.
 * Does NOT check subsystem health — that is the readiness probe's job.
 *
 * @returns Object with `status` (HTTP code) and `body` (JSON payload).
 */
export function getHealthResponse(): { status: number; body: Record<string, unknown> } {
  return {
    status: 200,
    body: {
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
    },
  }
}

/**
 * Readiness probe response.
 *
 * Checks three subsystems:
 *   1. **Database** — executes `SELECT 1` via Prisma.
 *   2. **Engines** — at least one LLM engine must be registered.
 *   3. **Memory** — the LanceDB vector store must be initialized.
 *
 * Returns HTTP 200 when all checks pass, HTTP 503 otherwise.
 *
 * @returns Object with `status` (HTTP code) and typed `body`.
 */
export async function getReadinessResponse(): Promise<{ status: number; body: ReadinessResult }> {
  const checks: HealthCheck[] = []

  // Check 1: Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.push({ name: "database", ok: true })
  } catch (err) {
    log.warn("readiness: database check failed", { error: err })
    checks.push({ name: "database", ok: false, detail: "connection failed" })
  }

  // Check 2: At least one LLM engine is available
  const engineCount = orchestrator.getAvailableEngineCount()
  const engineAvailable = engineCount > 0
  checks.push({
    name: "engines",
    ok: engineAvailable,
    detail: engineAvailable ? undefined : "no engines available",
  })

  // Check 3: Memory store initialized
  const memoryReady = memory.isInitialized()
  checks.push({
    name: "memory",
    ok: memoryReady,
    detail: memoryReady ? undefined : "memory store not initialized",
  })

  const ready = checks.every((c) => c.ok)

  if (!ready) {
    const failedNames = checks.filter((c) => !c.ok).map((c) => c.name)
    log.warn("readiness check failed", { failedSubsystems: failedNames })
  }

  return {
    status: ready ? 200 : 503,
    body: {
      ready,
      checks,
      uptimeSeconds: Math.floor(process.uptime()),
    },
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible buildHealthPayload API
// ---------------------------------------------------------------------------
// Used by gateway/routes/admin.ts (GET /health) and its test.
// Returns a richer payload including channel states and outbox metrics.
// ---------------------------------------------------------------------------

/** Shape returned by buildHealthPayload. */
interface HealthPayload {
  /** Overall status: "ok" | "degraded" | "down". */
  status: string
  /** Database probe result: "ok" | "error". */
  db: string
  /** Per-channel connection state. */
  channels: Record<string, boolean>
  /** Outbox queue metrics. */
  outbox: { pending: number; deadLetters: number }
  /** Application version string. */
  version: string
  /** Process uptime in seconds. */
  uptime: number
}

/**
 * Build a health payload for the admin /health endpoint.
 *
 * Probes the database, aggregates channel connectivity from ChannelHealthMonitor,
 * and includes outbox queue statistics.
 *
 * @param version - Application version string to include in the payload.
 * @returns HealthPayload with status, db, channels, outbox, version, and uptime.
 */
export async function buildHealthPayload(version: string): Promise<HealthPayload> {
  let dbStatus: "ok" | "error" = "ok"
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    dbStatus = "error"
  }

  const channelHealthList = channelHealthMonitor.getHealth()
  const channels: Record<string, boolean> = {}
  let anyConnected = false
  for (const ch of channelHealthList) {
    channels[ch.channelId] = ch.connected
    if (ch.connected) anyConnected = true
  }

  const outboxStatus = outbox.getStatus()

  let status: string
  if (dbStatus === "error") {
    status = "down"
  } else if (!anyConnected && channelHealthList.length > 0) {
    status = "degraded"
  } else {
    status = "ok"
  }

  return {
    status,
    db: dbStatus,
    channels,
    outbox: outboxStatus,
    version,
    uptime: Math.floor(process.uptime()),
  }
}
