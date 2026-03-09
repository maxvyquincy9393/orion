/**
 * @file helpers.ts
 * @description Shared utility functions for gateway route modules.
 *
 * ARCHITECTURE:
 *   Extracted from server.ts so route modules can import auth helpers
 *   and payload builders without circular deps on the GatewayServer class.
 */

import crypto from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { createLogger } from "../../logger.js"

const logger = createLogger("gateway")

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_USAGE_DAYS = 30
export const DEFAULT_USAGE_DAYS = 7

/** Maximum request body size (1 MB) to prevent memory DoS */
export const MAX_BODY_SIZE = 1_048_576

/** Rate limit: max requests per window per IP */
export const RATE_LIMIT_MAX = 60
export const RATE_LIMIT_WINDOW_MS = 60_000

/** Read version from package.json once at startup */
function readPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const pkgPath = resolve(__dirname, "..", "..", "..", "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

export const APP_VERSION = readPackageVersion()

export const CONTENT_SECURITY_POLICY = "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

export const CSRF_HEADER_NAME = "x-csrf-token"
export const CSRF_COOKIE_NAME = "edith_csrf_token"
export const CSRF_TOKEN_BYTES = 32

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
const CSRF_EXEMPT_PATH_PREFIXES = ["/webhooks/"]

// ── CORS ─────────────────────────────────────────────────────────────────────

import config from "../../config.js"

export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  (process.env.GATEWAY_CORS_ORIGINS ?? `http://127.0.0.1:${config.WEBCHAT_PORT},http://localhost:${config.WEBCHAT_PORT}`)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

// ── Shared Helpers ───────────────────────────────────────────────────────────

export function safeSend(socket: Pick<{ send: (payload: string) => void }, "send">, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8)
}

export function parseDaysParam(raw: unknown, fallback = DEFAULT_USAGE_DAYS): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(MAX_USAGE_DAYS, Math.max(1, parsed))
}

export function buildDateRange(days: number): { startDate: Date; endDate: Date } {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days)
  return { startDate, endDate }
}

// ── Admin Token ──────────────────────────────────────────────────────────────

export function isConfiguredAdminToken(token: string | undefined): token is string {
  return typeof token === "string" && token.trim().length > 0
}

export function timingSafeTokenEquals(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate)
  const expectedBuffer = Buffer.from(expected)

  if (candidateBuffer.length !== expectedBuffer.length) {
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

export function isAdminTokenAuthorized(candidate: unknown, configuredToken: string | undefined): boolean {
  if (!isConfiguredAdminToken(configuredToken)) return false
  if (typeof candidate !== "string") return false
  return timingSafeTokenEquals(candidate, configuredToken)
}

export function extractAdminToken(req: { headers: Record<string, string | undefined>; query: Record<string, unknown> }): string | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token.length > 0) return token
  }
  const queryToken = req.query.adminToken
  if (typeof queryToken === "string" && queryToken.trim().length > 0) {
    logger.warn("admin token passed via query string — use Authorization header instead")
    return queryToken.trim()
  }
  return null
}

export function extractBearerToken(req: { headers: Record<string, string | undefined> }): string | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    return token.length > 0 ? token : null
  }
  return null
}

export function extractWebSocketToken(req: {
  headers: Record<string, string | undefined>
  query: Record<string, unknown>
}): string | null {
  const headerToken = extractBearerToken(req)
  if (headerToken) return headerToken

  const queryToken = req.query?.token
  if (typeof queryToken === "string" && queryToken.trim().length > 0) {
    logger.warn("websocket token passed via query string — use Authorization header instead")
    return queryToken.trim()
  }

  if (Array.isArray(queryToken)) {
    const first = (queryToken as unknown[]).find(
      (value) => typeof value === "string" && (value as string).trim().length > 0,
    )
    if (typeof first === "string") {
      logger.warn("websocket token passed via query string array — use Authorization header instead")
      return first.trim()
    }
  }

  return null
}

// ── String helpers ───────────────────────────────────────────────────────────

export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

// ── CSRF ─────────────────────────────────────────────────────────────────────

export function normalizeRequestPath(url: string): string {
  const queryStart = url.indexOf("?")
  return queryStart >= 0 ? url.slice(0, queryStart) : url
}

export function getHeaderValue(headers: Record<string, unknown>, name: string): string | null {
  const normalizedName = name.toLowerCase()
  const direct = headers[normalizedName]
  if (typeof direct === "string") return direct
  if (Array.isArray(direct)) {
    const first = direct.find((value) => typeof value === "string")
    return typeof first === "string" ? first : null
  }
  return null
}

export function parseCookieHeader(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader || rawCookieHeader.trim().length === 0) return {}
  const cookies: Record<string, string> = {}
  const entries = rawCookieHeader.split(";")
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!key) continue
    try {
      cookies[key] = decodeURIComponent(value)
    } catch {
      cookies[key] = value
    }
  }
  return cookies
}

export function shouldEnforceCsrfRequest(req: {
  method: string
  url: string
  headers: Record<string, unknown>
}): boolean {
  const method = req.method.toUpperCase()
  if (CSRF_SAFE_METHODS.has(method)) return false
  const path = normalizeRequestPath(req.url)
  if (CSRF_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return false
  const origin = getHeaderValue(req.headers, "origin")
  return typeof origin === "string" && origin.trim().length > 0
}

export function verifyCsrfRequest(req: {
  method: string
  url: string
  headers: Record<string, unknown>
}): { ok: boolean; reason?: string } {
  if (!shouldEnforceCsrfRequest(req)) return { ok: true }
  const origin = getHeaderValue(req.headers, "origin")
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return { ok: false, reason: "origin not allowed" }
  const csrfHeader = getHeaderValue(req.headers, CSRF_HEADER_NAME)
  if (!csrfHeader || csrfHeader.trim().length === 0) return { ok: false, reason: "missing csrf header" }
  const cookieHeader = getHeaderValue(req.headers, "cookie") ?? undefined
  const cookies = parseCookieHeader(cookieHeader)
  const csrfCookie = cookies[CSRF_COOKIE_NAME]
  if (!csrfCookie || csrfCookie.trim().length === 0) return { ok: false, reason: "missing csrf cookie" }
  if (!timingSafeTokenEquals(csrfHeader.trim(), csrfCookie.trim())) return { ok: false, reason: "invalid csrf token" }
  return { ok: true }
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString("hex")
}

export function buildCsrfCookie(token: string): string {
  const attributes = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Strict",
  ]
  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure")
  }
  return attributes.join("; ")
}

// ── Message normalization ────────────────────────────────────────────────────

import type { GatewayClientMessage } from "./types.js"

export function normalizeIncomingClientMessage(input: unknown): GatewayClientMessage {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid message payload: expected object")
  }
  const raw = input as Record<string, unknown>
  const type = asNonEmptyString(raw.type)
  if (!type) throw new Error("Invalid message payload: missing 'type'")
  const userId = asString(raw.userId) ?? undefined
  const content = asString(raw.content) ?? undefined
  const keyword = asString(raw.keyword) ?? undefined
  const windowSecondsRaw = asFiniteNumber(raw.windowSeconds)
  const windowSeconds = windowSecondsRaw === null
    ? undefined
    : Math.min(30, Math.max(1, windowSecondsRaw))
  return { type, requestId: raw.requestId, userId, content, keyword, windowSeconds }
}

export function ensureMessageContent(content: string | undefined, type: string): string {
  if (typeof content !== "string") {
    throw new Error(`Invalid '${type}' payload: 'content' must be a string`)
  }
  return content
}

// ── Rate Limiter ─────────────────────────────────────────────────────────────

import { createRateLimiter } from "../rate-limiter.js"

export const rateLimiter = createRateLimiter({
  maxRequests: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
})

export const userRateLimiter = createRateLimiter({
  maxRequests: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
  backend: "memory",
})

export function isRateLimited(ip: string): boolean {
  return rateLimiter.consume(ip).limited
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  rateLimiter.cleanup()
}, 300_000).unref()
