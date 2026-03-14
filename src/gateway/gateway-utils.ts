/**
 * @file gateway-utils.ts
 * @description Pure utility functions for the gateway module — auth token extraction, CSRF
 *   validation, message normalisation, rate-limiter facade, and small helpers.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Imported by gateway/server.ts (and its tests via __gatewayTestUtils).
 *   All functions here are side-effect-free (except logger warnings) and do not depend on
 *   Fastify or any service singletons, keeping them easy to unit-test.
 */

import crypto from "node:crypto"

import { createLogger } from "../logger.js"
import { createRateLimiter } from "./rate-limiter.js"
import type { SocketLike, GatewayClientMessage } from "./gateway-types.js"
import {
  ALLOWED_ORIGINS,
  CSRF_COOKIE_NAME,
  CSRF_EXEMPT_PATH_PREFIXES,
  CSRF_HEADER_NAME,
  CSRF_SAFE_METHODS,
  CSRF_TOKEN_BYTES,
  DEFAULT_USAGE_DAYS,
  MAX_USAGE_DAYS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "./gateway-types.js"

const logger = createLogger("gateway.utils")

// ── Rate Limiter ─────────────────────────────────────────────────────────────

/** Singleton rate limiter instance used by the gateway server. */
export const rateLimiter = createRateLimiter({
  maxRequests: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
})

/** Check whether a given IP has exceeded the rate limit. */
export function isRateLimited(ip: string): boolean {
  return rateLimiter.consume(ip).limited
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  rateLimiter.cleanup()
}, 300_000).unref()

// ── Transport Helpers ────────────────────────────────────────────────────────

/** Safely JSON-serialise and send a payload over a WebSocket. Returns false on failure. */
export function safeSend(socket: Pick<SocketLike, "send">, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

// ── Query / Date Helpers ─────────────────────────────────────────────────────

/** Parse a string into a clamped days value for usage queries. */
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

/** Build a start/end Date pair spanning the given number of days ending now. */
export function buildDateRange(days: number): { startDate: Date; endDate: Date } {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days)
  return { startDate, endDate }
}

// ── Admin Token Helpers ──────────────────────────────────────────────────────

/** Type-guard: returns true when the configured admin token is a non-empty string. */
export function isConfiguredAdminToken(token: string | undefined): token is string {
  return typeof token === "string" && token.trim().length > 0
}

/** Timing-safe comparison of two token strings to mitigate side-channel attacks. */
export function timingSafeTokenEquals(candidate: string, expected: string): boolean {
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

/** Check whether the candidate token matches the configured admin token. */
export function isAdminTokenAuthorized(candidate: unknown, configuredToken: string | undefined): boolean {
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
export function extractAdminToken(req: { headers: Record<string, string | undefined>; query: Record<string, unknown> }): string | null {
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
export function extractBearerToken(req: { headers: Record<string, string | undefined> }): string | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim()
    return token.length > 0 ? token : null
  }
  return null
}

/** Extract a WebSocket auth token from headers (preferred) or query string (legacy). */
export function extractWebSocketToken(req: {
  headers: Record<string, string | undefined>
  query: Record<string, unknown>
}): string | null {
  const headerToken = extractBearerToken(req)
  if (headerToken) {
    return headerToken
  }

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

// ── Generic Value Extractors ─────────────────────────────────────────────────

/** Return the value if it is a non-empty string, otherwise null. */
export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

/** Return the value if it is a string, otherwise null. */
export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** Return the value if it is a finite number, otherwise null. */
export function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  return value
}

// ── Request / Header Helpers ─────────────────────────────────────────────────

/** Strip the query string from a URL path. */
export function normalizeRequestPath(url: string): string {
  const queryStart = url.indexOf("?")
  return queryStart >= 0 ? url.slice(0, queryStart) : url
}

/** Retrieve a header value by lower-cased name, handling single and array forms. */
export function getHeaderValue(headers: Record<string, unknown>, name: string): string | null {
  const normalizedName = name.toLowerCase()
  const direct = headers[normalizedName]

  if (typeof direct === "string") {
    return direct
  }

  if (Array.isArray(direct)) {
    const first = direct.find((value) => typeof value === "string")
    return typeof first === "string" ? first : null
  }

  return null
}

/** Parse a raw Cookie header string into a key-value record. */
export function parseCookieHeader(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader || rawCookieHeader.trim().length === 0) {
    return {}
  }

  const cookies: Record<string, string> = {}
  const entries = rawCookieHeader.split(";")

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) {
      continue
    }

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!key) {
      continue
    }

    try {
      cookies[key] = decodeURIComponent(value)
    } catch {
      cookies[key] = value
    }
  }

  return cookies
}

// ── CSRF Helpers ─────────────────────────────────────────────────────────────

/** Determine whether a request requires CSRF enforcement. */
export function shouldEnforceCsrfRequest(req: {
  method: string
  url: string
  headers: Record<string, unknown>
}): boolean {
  const method = req.method.toUpperCase()
  if (CSRF_SAFE_METHODS.has(method)) {
    return false
  }

  const path = normalizeRequestPath(req.url)
  if (CSRF_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false
  }

  const origin = getHeaderValue(req.headers, "origin")
  return typeof origin === "string" && origin.trim().length > 0
}

/** Verify CSRF header + cookie pair for a request. */
export function verifyCsrfRequest(req: {
  method: string
  url: string
  headers: Record<string, unknown>
}): { ok: boolean; reason?: string } {
  if (!shouldEnforceCsrfRequest(req)) {
    return { ok: true }
  }

  const origin = getHeaderValue(req.headers, "origin")
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return { ok: false, reason: "origin not allowed" }
  }

  const csrfHeader = getHeaderValue(req.headers, CSRF_HEADER_NAME)
  if (!csrfHeader || csrfHeader.trim().length === 0) {
    return { ok: false, reason: "missing csrf header" }
  }

  const cookieHeader = getHeaderValue(req.headers, "cookie") ?? undefined
  const cookies = parseCookieHeader(cookieHeader)
  const csrfCookie = cookies[CSRF_COOKIE_NAME]
  if (!csrfCookie || csrfCookie.trim().length === 0) {
    return { ok: false, reason: "missing csrf cookie" }
  }

  if (!timingSafeTokenEquals(csrfHeader.trim(), csrfCookie.trim())) {
    return { ok: false, reason: "invalid csrf token" }
  }

  return { ok: true }
}

/** Generate a new random CSRF token. */
export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString("hex")
}

/** Build a Set-Cookie header value for the CSRF token. */
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

// ── Message Normalisation ────────────────────────────────────────────────────

/** Validate and normalise a raw incoming WebSocket client message. */
export function normalizeIncomingClientMessage(input: unknown): GatewayClientMessage {
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

/** Assert that a message content field is present and is a string. */
export function ensureMessageContent(content: string | undefined, type: string): string {
  if (typeof content !== "string") {
    throw new Error(`Invalid '${type}' payload: 'content' must be a string`)
  }
  return content
}
