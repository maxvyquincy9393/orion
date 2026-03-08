/**
 * @file hud-gateway-bridge.ts
 * @description WebSocket bridge that pushes HUD updates to connected Electron overlay windows.
 *
 * ARCHITECTURE:
 *   Registers a `/hud` WebSocket route on the Fastify gateway.
 *   When clients connect, the bridge sends the full current state immediately,
 *   then subscribes to hudState change events to push incremental updates.
 *   Each message is a serialised `HudUpdate` JSON object.
 *
 *   Only active when HUD_ENABLED=true.
 */

import type { FastifyInstance } from "fastify"
import { createLogger } from "../logger.js"
import config from "../config.js"
import { hudState } from "./hud-state.js"
import { hudCardManager } from "./hud-card-manager.js"
import type { HudUpdate } from "./hud-schema.js"

const log = createLogger("hud.gateway-bridge")

/**
 * Registers the `/hud` WebSocket endpoint on the Fastify gateway.
 * Requires `@fastify/websocket` to be registered on the instance.
 *
 * @param app - The Fastify application instance
 */
export function registerHudGateway(app: FastifyInstance): void {
  if (!config.HUD_ENABLED) {
    log.info("HUD disabled — gateway route not registered")
    return
  }

  // Each connection is per-user; userId is passed as a query param.
  app.get<{ Querystring: { userId?: string } }>(
    "/hud",
    { websocket: true },
    (socket, req) => {
      const userId = req.query.userId ?? "default"
      log.info("HUD client connected", { userId })

      // Send full state immediately on connection.
      const sendState = (): void => {
        const state = hudState.getState(userId)
        const update: HudUpdate = { type: "hud_update", state }
        socket.send(JSON.stringify(update))
      }

      sendState()

      // Subscribe to future state changes.
      const unsubscribe = hudState.onChange((partialState) => {
        const cards = hudCardManager.list(userId)
        const update: HudUpdate = {
          type: "hud_update",
          state: { ...partialState, cards },
        }
        try {
          socket.send(JSON.stringify(update))
        } catch {
          // Client may have disconnected.
        }
      })

      socket.on("message", (msg: Buffer) => {
        // Client can send: { type: "dismiss", cardId: "..." }
        try {
          const data = JSON.parse(msg.toString()) as { type?: string; cardId?: string }
          if (data.type === "dismiss" && data.cardId) {
            void hudCardManager
              .dismiss(data.cardId, userId)
              .then(() => sendState())
              .catch(err => log.warn("dismiss failed", { err }))
          }
        } catch {
          // ignore malformed messages
        }
      })

      socket.on("close", () => {
        unsubscribe()
        log.debug("HUD client disconnected", { userId })
      })
    },
  )

  log.info("HUD gateway registered at /hud")
}
