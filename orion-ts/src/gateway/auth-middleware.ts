/**
 * Auth Middleware with Tenant Context (OC-12)
 *
 * Enhanced authentication that includes tenant/workspace context
 * for multi-tenant SaaS deployments.
 */

import { createLogger } from "../logger.js"
import { deviceStore } from "../pairing/device-store.js"
import { workspaceResolver, type WorkspaceContext } from "../core/workspace-resolver.js"

const log = createLogger("gateway.auth")

export type AccessMode = "pairing" | "allowlist" | "open"

export interface AuthContext {
  userId: string
  channel: string
  authenticated: boolean
  /**
   * Tenant/workspace context for multi-tenant deployments
   * Only populated in SaaS mode or when tenant config exists
   */
  tenant?: WorkspaceContext
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

  // Load tenant context for multi-tenant deployments (OC-12)
  let tenant: WorkspaceContext | undefined
  if (workspaceResolver.isSaasMode()) {
    try {
      tenant = (await workspaceResolver.getContext(result.userId)) ?? undefined
    } catch (error) {
      log.warn("Failed to load tenant context", { userId: result.userId, error })
      // Continue without tenant context (graceful degradation)
    }
  }

  return {
    userId: result.userId,
    channel: result.channel,
    authenticated: true,
    tenant,
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
