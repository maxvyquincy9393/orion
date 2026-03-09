/**
 * @file types.ts
 * @description Shared types and helpers for gateway route modules.
 *
 * ARCHITECTURE:
 *   Central definitions consumed by every route file in gateway/routes/.
 *   Keeps route modules decoupled from server.ts internals.
 */


// ── Socket Types ─────────────────────────────────────────────────────────────

export type SocketLike = {
  send: (payload: string) => void
  close: (code?: number) => void
  on: (event: "message" | "close", handler: (...args: unknown[]) => void) => void
}

/** Typed gateway response payloads */
export interface GatewayResponse {
  type: string
  requestId?: unknown
  [key: string]: unknown
}

export interface GatewayClientMessage {
  type: string
  requestId?: unknown
  userId?: string
  content?: string
  keyword?: string
  windowSeconds?: number
}

// ── Gateway Context ──────────────────────────────────────────────────────────

/** Shared state passed from GatewayServer to route modules. */
export interface GatewayContext {
  clients: Map<string, SocketLike>
  voiceSessions: Map<string, () => void>
  stopVoiceSession: (userId: string, reason: string) => boolean
  handleUserMessage: (userId: string, message: string, channel: string) => Promise<string>
}

// ── Auth helper type ─────────────────────────────────────────────────────────

export type AuthenticatedRequest = {
  headers: Record<string, string | undefined>
  query: Record<string, unknown>
}
