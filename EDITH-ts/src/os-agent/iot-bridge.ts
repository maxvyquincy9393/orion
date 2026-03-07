/**
 * @file os-agent/iot-bridge.ts — Smart Home & IoT Integration
 * @description Bridges EDITH with smart home systems (Home Assistant, MQTT).
 * Enables EDITH-style home control: lights, climate, locks, cameras, etc.
 *
 * Supports:
 * - Home Assistant REST API + WebSocket
 * - MQTT direct device control
 * - Natural language → device command mapping
 *
 * @module os-agent/iot-bridge
 */

import { createLogger } from "../logger.js"
import type { IoTConfig, IoTActionPayload, OSActionResult, IoTState } from "./types.js"

const log = createLogger("os-agent.iot")

interface HAEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
}

export class IoTBridge {
  private initialized = false
  private haEntities: HAEntity[] = []
  private mqttConnected = false
  /** Minimum interval between HA entity refreshes (ms) */
  private static readonly HA_REFRESH_MIN_INTERVAL_MS = 30_000
  private lastHARefresh = 0

  constructor(private config: IoTConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("IoT Bridge disabled by config")
      return
    }

    // Initialize Home Assistant connection
    if (this.config.homeAssistantUrl) {
      await this.initHomeAssistant()
    }

    // Initialize MQTT connection
    if (this.config.mqttBrokerUrl) {
      await this.initMQTT()
    }

    this.initialized = true
    log.info("IoT Bridge initialized")
  }

  /**
   * Execute an IoT action.
   */
  async execute(payload: IoTActionPayload): Promise<OSActionResult> {
    if (!this.initialized) {
      return { success: false, error: "IoT Bridge not initialized" }
    }

    const start = Date.now()
    try {
      if (payload.target === "home_assistant") {
        return this.executeHA(payload)
      }
      if (payload.target === "mqtt") {
        return this.executeMQTT(payload)
      }
      return { success: false, error: `Unknown IoT target: ${payload.target}` }
    } catch (err) {
      return { success: false, error: String(err), duration: Date.now() - start }
    }
  }

  /**
   * Get all device states.
   */
  async getStates(): Promise<IoTState> {
    if (!this.config.homeAssistantUrl) {
      return { connectedDevices: 0, devices: [] }
    }

    try {
      await this.refreshHAEntities()
      const devices = this.haEntities.map((e) => ({
        entityId: e.entity_id,
        friendlyName: (e.attributes.friendly_name as string) ?? e.entity_id,
        state: e.state,
        domain: e.entity_id.split(".")[0],
      }))

      return {
        connectedDevices: devices.length,
        devices,
      }
    } catch (err) {
      log.error("Failed to get IoT states", { error: String(err) })
      return { connectedDevices: 0, devices: [] }
    }
  }

  /**
   * Natural language → IoT command parser.
   * Maps spoken commands to Home Assistant service calls.
   */
  parseNaturalLanguage(
    command: string,
  ): Array<{ domain: string; service: string; entityId: string; data?: Record<string, unknown> }> {
    const parsed: Array<{ domain: string; service: string; entityId: string; data?: Record<string, unknown> }> = []
    const lower = command.toLowerCase()

    // Light commands
    if (lower.match(/nyala(kan)?|turn on|hidupkan/) && lower.match(/lampu|light/)) {
      const room = this.extractRoom(lower)
      parsed.push({
        domain: "light",
        service: "turn_on",
        entityId: `light.${room}`,
      })
    }
    if (lower.match(/matikan|turn off|padamkan/) && lower.match(/lampu|light/)) {
      const room = this.extractRoom(lower)
      parsed.push({
        domain: "light",
        service: "turn_off",
        entityId: `light.${room}`,
      })
    }

    // Climate commands
    const tempMatch = lower.match(/(?:set|atur|ubah).*(?:suhu|temp|ac).*?(\d+)/)
    if (tempMatch) {
      const room = this.extractRoom(lower)
      parsed.push({
        domain: "climate",
        service: "set_temperature",
        entityId: `climate.${room}`,
        data: { temperature: parseInt(tempMatch[1]) },
      })
    }

    // Lock commands
    if (lower.match(/kunci|lock/)) {
      parsed.push({ domain: "lock", service: "lock", entityId: "lock.front_door" })
    }
    if (lower.match(/buka.*kunci|unlock/)) {
      parsed.push({ domain: "lock", service: "unlock", entityId: "lock.front_door" })
    }

    return parsed
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    // Close MQTT connection if any
    this.mqttConnected = false
    log.info("IoT Bridge shut down")
  }

  // ── Private: Home Assistant ──

  private async initHomeAssistant(): Promise<void> {
    if (!this.config.homeAssistantUrl || !this.config.homeAssistantToken) {
      log.warn("Home Assistant URL or token not configured")
      return
    }

    try {
      // Test connection
      const response = await fetch(`${this.config.homeAssistantUrl}/api/`, {
        headers: { Authorization: `Bearer ${this.config.homeAssistantToken}` },
      })
      if (response.ok) {
        log.info("Home Assistant connected")
        if (this.config.autoDiscover) {
          await this.refreshHAEntities()
          log.info(`Discovered ${this.haEntities.length} Home Assistant entities`)
        }
      } else {
        log.warn(`Home Assistant connection failed: ${response.status}`)
      }
    } catch (err) {
      log.warn("Home Assistant unreachable", { url: this.config.homeAssistantUrl, error: String(err) })
    }
  }

  private async refreshHAEntities(): Promise<void> {
    if (!this.config.homeAssistantUrl || !this.config.homeAssistantToken) return

    // Rate limit: don't refresh more often than HA_REFRESH_MIN_INTERVAL_MS
    const now = Date.now()
    if (now - this.lastHARefresh < IoTBridge.HA_REFRESH_MIN_INTERVAL_MS && this.haEntities.length > 0) {
      return
    }

    try {
      const response = await fetch(`${this.config.homeAssistantUrl}/api/states`, {
        headers: { Authorization: `Bearer ${this.config.homeAssistantToken}` },
      })
      if (response.ok) {
        this.haEntities = (await response.json()) as HAEntity[]
        this.lastHARefresh = now
      }
    } catch (err) {
      log.error("Failed to refresh HA entities", { error: String(err) })
    }
  }

  private async executeHA(payload: IoTActionPayload): Promise<OSActionResult> {
    if (!this.config.homeAssistantUrl || !this.config.homeAssistantToken) {
      return { success: false, error: "Home Assistant not configured" }
    }

    const start = Date.now()
    const { domain, service, entityId, data } = payload

    try {
      const body: Record<string, unknown> = { ...data }
      if (entityId) body.entity_id = entityId

      const response = await fetch(
        `${this.config.homeAssistantUrl}/api/services/${domain}/${service}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.homeAssistantToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      )

      if (response.ok) {
        const result = await response.json()
        return { success: true, data: result, duration: Date.now() - start }
      }

      return {
        success: false,
        error: `HA API error: ${response.status} ${response.statusText}`,
        duration: Date.now() - start,
      }
    } catch (err) {
      return { success: false, error: String(err), duration: Date.now() - start }
    }
  }

  // ── Private: MQTT ──

  private async initMQTT(): Promise<void> {
    if (!this.config.mqttBrokerUrl) {
      log.warn("MQTT broker URL not configured")
      return
    }

    // In production: use 'mqtt' npm package
    // import mqtt from 'mqtt'
    // this.mqttClient = mqtt.connect(this.config.mqttBrokerUrl, { ... })
    log.info(`MQTT bridge configured for ${this.config.mqttBrokerUrl} (client not yet connected — install 'mqtt' package)`)
  }

  private async executeMQTT(payload: IoTActionPayload): Promise<OSActionResult> {
    if (!this.mqttConnected) {
      return { success: false, error: "MQTT not connected" }
    }

    // In production:
    // this.mqttClient.publish(payload.topic, JSON.stringify(payload.data))
    return { success: false, error: "MQTT publish not yet implemented" }
  }

  // ── Helpers ──

  private extractRoom(text: string): string {
    const rooms: Record<string, string[]> = {
      bedroom: ["kamar", "bedroom", "kamar tidur"],
      living_room: ["ruang tamu", "living room", "living"],
      kitchen: ["dapur", "kitchen"],
      bathroom: ["kamar mandi", "bathroom"],
      office: ["kantor", "office", "ruang kerja"],
      garage: ["garasi", "garage"],
    }

    for (const [id, keywords] of Object.entries(rooms)) {
      if (keywords.some((k) => text.includes(k))) return id
    }
    return "all"
  }
}
