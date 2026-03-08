/**
 * @file serial-handler.ts
 * @description Serial (Firmata/Arduino) protocol handler for hardware bridge.
 *
 * ARCHITECTURE:
 *   Dynamically imports `serialport` to avoid hard dependency.
 *   Falls back gracefully when hardware is not available.
 *   Registered with protocolRouter as the "serial" handler.
 */

import { createLogger } from "../../logger.js"
import type { ProtocolHandler } from "../protocol-router.js"

const log = createLogger("hardware.protocols.serial")

/**
 * Sends simple serial write commands to Firmata/Arduino devices.
 * Uses dynamic import so the package is optional.
 */
export class SerialHandler implements ProtocolHandler {
  /**
   * Writes a JSON-encoded command to a serial port and reads the response.
   *
   * @param address - Serial port path (e.g. "COM3" or "/dev/ttyUSB0")
   * @param action - Command action string
   * @param params - Optional command parameters
   */
  async send(address: string, action: string, params?: Record<string, unknown>): Promise<unknown> {
    let SerialPort: { new(opts: object): { write: (d: string, cb: (e?: Error | null) => void) => void; close: () => void } }
    try {
      const mod = await import("serialport")
      SerialPort = (mod as { SerialPort: typeof SerialPort }).SerialPort
    } catch {
      throw new Error("serialport package not installed — run: pnpm add serialport")
    }

    return new Promise<unknown>((resolve, reject) => {
      const port = new SerialPort({ path: address, baudRate: 115200 })
      const payload = JSON.stringify({ action, params }) + "\n"

      port.write(payload, (err) => {
        port.close()
        if (err) {
          log.warn("serial write error", { address, err })
          reject(err)
        } else {
          log.debug("serial command sent", { address, action })
          resolve({ sent: true })
        }
      })
    })
  }
}

export const serialHandler = new SerialHandler()
