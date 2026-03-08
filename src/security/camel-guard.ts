import crypto from "node:crypto"

import { createLogger } from "../logger.js"

const log = createLogger("security.camel-guard")

const DEFAULT_CAPABILITY_TTL_MS = 5 * 60 * 1000
const CAPABILITY_VERSION = 1

export type TaintSource = "web_content" | "file_content" | "code_output"

export interface CapabilityTokenPayload {
  version: number
  actorId: string
  toolName: string
  action: string
  taintedSources: TaintSource[]
  issuedAt: number
  expiresAt: number
}

export interface CamelCheckInput {
  actorId: string
  toolName: string
  action: string
  taintedSources: TaintSource[]
  capabilityToken?: string
}

export interface CamelCheckResult {
  allowed: boolean
  reason?: string
}

/** Ephemeral secret generated at module load when EDITH_CAPABILITY_SECRET is not set. */
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString("hex")

/** Whether this process has already warned about using the ephemeral secret. */
let _warnedAboutEphemeral = false

/**
 * Returns the HMAC secret used to sign/verify capability tokens.
 * Priority: env var → per-process random secret (with one-time warning).
 * NEVER falls back to a known public default.
 */
function getCapabilitySecret(): string {
  const envSecret = process.env.EDITH_CAPABILITY_SECRET?.trim()
  if (envSecret) return envSecret

  if (!_warnedAboutEphemeral) {
    _warnedAboutEphemeral = true
    log.warn(
      "EDITH_CAPABILITY_SECRET is not set — using ephemeral random secret. " +
      "Capability tokens will NOT survive process restarts. " +
      "Set EDITH_CAPABILITY_SECRET in .env for persistent tokens.",
    )
  }
  return EPHEMERAL_SECRET
}

function uniqueTaintSources(taintedSources: TaintSource[]): TaintSource[] {
  return Array.from(new Set(taintedSources))
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url")
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8")
}

function signPayload(encodedPayload: string): string {
  return crypto.createHmac("sha256", getCapabilitySecret()).update(encodedPayload).digest("base64url")
}

function isReadOnlyToolAction(toolName: string, action: string): boolean {
  if (toolName === "browser") {
    return true
  }

  if (toolName === "fileAgent") {
    return ["read", "info", "list"].includes(action)
  }

  return false
}

export class CamelGuard {
  issueCapabilityToken(input: {
    actorId: string
    toolName: string
    action: string
    taintedSources: TaintSource[]
    ttlMs?: number
  }): string {
    const issuedAt = Date.now()
    const payload: CapabilityTokenPayload = {
      version: CAPABILITY_VERSION,
      actorId: input.actorId,
      toolName: input.toolName,
      action: input.action,
      taintedSources: uniqueTaintSources(input.taintedSources),
      issuedAt,
      expiresAt: issuedAt + Math.max(1_000, input.ttlMs ?? DEFAULT_CAPABILITY_TTL_MS),
    }

    const encodedPayload = base64UrlEncode(JSON.stringify(payload))
    const signature = signPayload(encodedPayload)
    return `${encodedPayload}.${signature}`
  }

  readCapabilityToken(token: string): CapabilityTokenPayload | null {
    const [encodedPayload, providedSignature] = token.split(".")
    if (!encodedPayload || !providedSignature) {
      return null
    }

    const expectedSignature = signPayload(encodedPayload)
    const expectedBuffer = Buffer.from(expectedSignature)
    const providedBuffer = Buffer.from(providedSignature)

    if (expectedBuffer.length !== providedBuffer.length) {
      return null
    }

    if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
      return null
    }

    try {
      return JSON.parse(base64UrlDecode(encodedPayload)) as CapabilityTokenPayload
    } catch {
      return null
    }
  }

  validateCapabilityToken(token: string, input: CamelCheckInput): CamelCheckResult {
    const payload = this.readCapabilityToken(token)
    if (!payload) {
      return { allowed: false, reason: "Capability token signature is invalid" }
    }

    if (payload.version !== CAPABILITY_VERSION) {
      return { allowed: false, reason: "Capability token version is invalid" }
    }

    if (Date.now() > payload.expiresAt) {
      return { allowed: false, reason: "Capability token expired" }
    }

    if (payload.actorId !== input.actorId) {
      return { allowed: false, reason: "Capability token actor mismatch" }
    }

    if (payload.toolName !== input.toolName || payload.action !== input.action) {
      return { allowed: false, reason: "Capability token scope mismatch" }
    }

    const payloadSources = new Set(payload.taintedSources)
    for (const source of uniqueTaintSources(input.taintedSources)) {
      if (!payloadSources.has(source)) {
        return { allowed: false, reason: "Capability token taint scope mismatch" }
      }
    }

    return { allowed: true }
  }

  check(input: CamelCheckInput): CamelCheckResult {
    const taintedSources = uniqueTaintSources(input.taintedSources)
    if (taintedSources.length === 0) {
      return { allowed: true }
    }

    if (isReadOnlyToolAction(input.toolName, input.action)) {
      return { allowed: true }
    }

    if (!input.capabilityToken) {
      return {
        allowed: false,
        reason: `CaMeL guard blocked tainted ${input.toolName}.${input.action} without capability token`,
      }
    }

    const validation = this.validateCapabilityToken(input.capabilityToken, input)
    if (!validation.allowed) {
      log.warn("capability token validation failed", {
        actorId: input.actorId,
        toolName: input.toolName,
        action: input.action,
        reason: validation.reason,
      })
    }
    return validation
  }
}

export function inferToolResultTaintSources(toolName: string, action: string): TaintSource[] {
  if (toolName === "browser") {
    return ["web_content"]
  }

  if (toolName === "fileAgent" && ["read", "info", "list"].includes(action)) {
    return ["file_content"]
  }

  if (toolName === "codeRunner") {
    return ["code_output"]
  }

  return []
}

export const camelGuard = new CamelGuard()