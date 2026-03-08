/**
 * @file mqtt-handler.ts
 * @description MQTT publish/subscribe handler for ESPHome and similar devices.
 *
 * ARCHITECTURE:
 *   Lazily connects to the configured MQTT broker (HARDWARE_MQTT_BROKER).
 *   Publishes command payloads to `{address}/set` topics.
 *   Subscribes to `{address}/state` for responses (fire-and-forget for now).
 *   Dynamically imports `mqtt` to avoid hard dependency.
 */

import { createLogger } from "../../logger.js"
import config from "../../config.js"
import type { ProtocolHandler } from "../protocol-router.js"

const log = createLogger("hardware.protocols.mqtt")

/**
 * MQTT protocol handler for ESPHome/MQTT-enabled devices.
 */
export class MqttHandler implements ProtocolHandler {
  /**
   * Publishes a JSON command to `{address}/set`.
   *
   * @param address - MQTT topic prefix for the device
   * @param action - Command action
   * @param params - Optional parameters
   */
  async send(address: string, action: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!config.HARDWARE_MQTT_BROKER) {
      throw new Error("HARDWARE_MQTT_BROKER is not configured")
    }

    let mqttConnect: (url: string) => { publish: (t: string, p: string, cb: (e?: Error | null) => void) => void; end: () => void }
    try {
      const mod = await import("mqtt")
      mqttConnect = (mod as { connect: typeof mqttConnect }).connect
    } catch {
      throw new Error("mqtt package not installed — run: pnpm add mqtt")
    }

    return new Promise<unknown>((resolve, reject) => {
      const brokerUrl = `mqtt://${config.HARDWARE_MQTT_BROKER}:${config.HARDWARE_MQTT_PORT}`
      const client = mqttConnect(brokerUrl)
      const topic = `${address}/set`
      const payload = JSON.stringify({ action, ...params })

      client.publish(topic, payload, (err) => {
        client.end()
        if (err) {
          log.warn("mqtt publish error", { topic, err })
          reject(err)
        } else {
          log.debug("mqtt command published", { topic, action })
          resolve({ topic, published: true })
        }
      })
    })
  }
}

export const mqttHandler = new MqttHandler()
