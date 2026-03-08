/**
 * @file protocol-router.ts
 * @description Routes hardware commands to the correct protocol handler.
 *
 * ARCHITECTURE:
 *   Receives a HardwareCommand, looks up the device in the registry,
 *   dispatches to the appropriate protocol handler (serial/mqtt/ddc/http),
 *   and logs the event to HardwareEvent.
 *
 *   Physical safety: relay/motor commands require device.confirmed = true.
 *   Hardware errors are soft failures — never throw to the caller.
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import { deviceRegistry } from "./device-registry.js"
import { HARDWARE_RETRY_DELAYS_MS } from "./hardware-schema.js"
import type { HardwareCommand, HardwareResponse } from "./hardware-schema.js"

const log = createLogger("hardware.protocol-router")

/** Protocol handler interface — each protocol implements this. */
export interface ProtocolHandler {
  send(address: string, action: string, params?: Record<string, unknown>): Promise<unknown>
}

/**
 * Routes hardware commands to the correct protocol handler with retry logic.
 */
export class ProtocolRouter {
  private readonly handlers = new Map<string, ProtocolHandler>()

  /** Registers a handler for a protocol type. */
  registerHandler(protocol: string, handler: ProtocolHandler): void {
    this.handlers.set(protocol, handler)
    log.info("protocol handler registered", { protocol })
  }

  /**
   * Sends a command to a device, retrying on transient errors.
   * Always returns a HardwareResponse — never throws.
   *
   * @param command - The command to execute
   * @returns HardwareResponse (success or error details)
   */
  async send(command: HardwareCommand): Promise<HardwareResponse> {
    const start = Date.now()

    const device = await deviceRegistry.get(command.deviceId)
    if (!device) {
      return this.errorResponse(command, "Device not found", start)
    }

    // Physical safety gate.
    if (command.requiresConfirmation && !device.confirmed) {
      return this.errorResponse(
        command,
        "Device requires first-use confirmation before executing relay/motor commands",
        start,
      )
    }

    const handler = this.handlers.get(device.protocol)
    if (!handler) {
      return this.errorResponse(command, `No handler for protocol: ${device.protocol}`, start)
    }

    let lastErr: unknown
    for (let attempt = 0; attempt <= HARDWARE_RETRY_DELAYS_MS.length; attempt++) {
      try {
        if (attempt > 0) {
          const delay = HARDWARE_RETRY_DELAYS_MS[attempt - 1]!
          log.debug("retrying hardware command", { deviceId: command.deviceId, attempt, delay })
          await sleep(delay)
        }

        const result = await handler.send(device.address, command.action, command.params)
        await this.logEvent(device.userId, command.deviceId, "command", { action: command.action, result })
        await deviceRegistry.setStatus(command.deviceId, "online")

        return {
          deviceId: command.deviceId,
          action: command.action,
          success: true,
          result,
          latencyMs: Date.now() - start,
        }
      } catch (err) {
        lastErr = err
        log.warn("hardware command attempt failed", { deviceId: command.deviceId, attempt, err })
      }
    }

    await deviceRegistry.setStatus(command.deviceId, "offline")
    await this.logEvent(device.userId, command.deviceId, "error", { action: command.action, error: String(lastErr) })
    return this.errorResponse(command, String(lastErr), start)
  }

  private errorResponse(cmd: HardwareCommand, error: string, startMs: number): HardwareResponse {
    return { deviceId: cmd.deviceId, action: cmd.action, success: false, error, latencyMs: Date.now() - startMs }
  }

  private async logEvent(userId: string, deviceId: string, type: string, payload: object): Promise<void> {
    await prisma.hardwareEvent.create({ data: { userId, deviceId, type, payload } })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const protocolRouter = new ProtocolRouter()
