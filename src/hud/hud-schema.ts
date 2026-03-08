/**
 * @file hud-schema.ts
 * @description TypeScript type definitions for the Phase 20 HUD Overlay system.
 *
 * ARCHITECTURE:
 *   Shared types used by hud-card-manager.ts, hud-state.ts, and
 *   hud-gateway-bridge.ts. These mirror the HudCard Prisma model
 *   but use plain interfaces for in-memory representation.
 */

/** Current EDITH status shown on the status ring. */
export type HudStatus =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "alert"
  | "error"

/** Visual theme for the HUD overlay window. */
export type HudTheme = "arc-reactor" | "minimal" | "stealth"

/** HUD overlay screen quadrant. */
export type HudPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"

/** Card type displayed on the HUD. */
export type HudCardType =
  | "calendar"
  | "weather"
  | "task"
  | "notification"
  | "status"

/**
 * A single card displayed in the HUD notification/info panel.
 * Priority 0 = lowest, higher = shown first.
 */
export interface HudCard {
  id: string
  userId: string
  type: HudCardType
  title: string
  body?: string
  priority: number
  dismissed: boolean
  expiresAt?: Date
  metadata?: Record<string, unknown>
  createdAt: Date
}

/** The full HUD state snapshot sent to the Electron overlay window. */
export interface HudState {
  status: HudStatus
  cards: HudCard[]
  theme: HudTheme
  position: HudPosition
  opacity: number
}

/** WebSocket event payload sent over the /hud channel. */
export interface HudUpdate {
  type: "hud_update"
  state: HudState
}

/** State of the pulsing/animated status ring. */
export interface StatusRingState {
  status: HudStatus
  /** ISO timestamp when the status last changed. */
  changedAt: string
}
