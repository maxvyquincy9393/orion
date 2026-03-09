/**
 * @file session-types.ts
 * @description Shared Session and Message types for the sessions subsystem.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Extracted from session-store.ts to break the circular import between
 *   session-store.ts and redis-session-store.ts.  Both modules import their
 *   shared types from here; neither imports types from the other.
 */

/** A chat message stored in a session. */
export interface Message {
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

/** Runtime metadata for an active session. */
export interface Session {
  key: string
  userId: string
  channel: string
  createdAt: number
  lastActivityAt: number
}
