import { createLogger } from "../logger.js"
import { deviceStore } from "../pairing/device-store.js"

const log = createLogger("gateway.auth")

export type AccessMode = "pairing" | "allowlist" | "open"

export interface AuthContext {
  userId: string
  channel: string
  authenticated: boolean
}

export interface AuthFailure {
  statusCode: 401 | 429
  message: string
  retryAfterSeconds?: number
}

export async function authenticateWebSocket(token: string | null | undefined): Promise<AuthContext | null> {
  if (!token || token.trim().length === 0) {
    log.warn("websocket connection without token")
    return null
  }

  const result = await deviceStore.validateToken(token)
  if (!result) {
    return null
  }

  return {
    userId: result.userId,
    channel: result.channel,
    authenticated: true,
  }
}

export function getAuthFailure(token: string | null | undefined): AuthFailure {
  if (!token || token.trim().length === 0) {
    return {
      statusCode: 401,
      message: "Missing auth token",
    }
  }

  const throttleStatus = deviceStore.getThrottleStatus(token)

  if (throttleStatus.throttled) {
    return {
      statusCode: 429,
      message: "Too many failed auth attempts",
      retryAfterSeconds: throttleStatus.retryAfterSeconds,
    }
  }

  return {
    statusCode: 401,
    message: "Invalid device token",
  }
}

export function isAuthorizedSender(
  senderId: string,
  _channel: string,
  allowlist: string[] | null,
  mode: AccessMode,
): boolean {
  if (mode === "open") {
    return true
  }

  if (mode === "allowlist") {
    return Array.isArray(allowlist) && allowlist.includes(senderId)
  }

  return mode === "pairing"
}
