/**
 * @file hud-state.ts
 * @description Singleton that tracks the current HUD status ring and card set.
 *
 * ARCHITECTURE:
 *   hud-state is the single source of truth for what is currently displayed
 *   on the Electron HUD overlay. Any module that changes EDITH's processing
 *   state (message-pipeline, voice/bridge, background/daemon) calls
 *   `hudState.setStatus(...)`. The gateway bridge polls or subscribes to
 *   derive `HudUpdate` events to push to the connected Electron window.
 */

import config from "../config.js"
import { createLogger } from "../logger.js"
import { hudCardManager } from "./hud-card-manager.js"
import type { HudStatus, HudState, HudTheme, HudPosition } from "./hud-schema.js"

const log = createLogger("hud.state")

/** Callback invoked whenever HUD state changes. */
export type HudStateChangeListener = (state: HudState) => void

/**
 * Manages and broadcasts the current HUD display state.
 */
export class HudStateManager {
  private currentStatus: HudStatus = "idle"
  private readonly listeners = new Set<HudStateChangeListener>()

  /** Returns the current rendered HUD state for a given user. */
  getState(userId: string): HudState {
    return {
      status: this.currentStatus,
      cards: hudCardManager.list(userId),
      theme: config.HUD_THEME as HudTheme,
      position: config.HUD_POSITION as HudPosition,
      opacity: config.HUD_OPACITY,
    }
  }

  /**
   * Updates the status ring and notifies all listeners.
   * @param status - New status to display on the ring
   */
  setStatus(status: HudStatus): void {
    if (this.currentStatus === status) return
    this.currentStatus = status
    log.debug("status changed", { status })
    this.notify()
  }

  /** Registers a listener that fires on every state change. */
  onChange(listener: HudStateChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Notifies all registered listeners with a generic user-agnostic state snapshot. */
  private notify(): void {
    const state: HudState = {
      status: this.currentStatus,
      cards: [],
      theme: config.HUD_THEME as HudTheme,
      position: config.HUD_POSITION as HudPosition,
      opacity: config.HUD_OPACITY,
    }
    for (const listener of this.listeners) {
      listener(state)
    }
  }
}

export const hudState = new HudStateManager()
