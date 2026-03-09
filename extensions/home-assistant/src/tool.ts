/**
 * @file tool.ts
 * @description Home Assistant integration — entity states, service calls, automation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses Home Assistant REST API. Requires HA_BASE_URL + long-lived access token.
 *   Provides state queries, service calls, light/climate helpers, and history.
 */

import { createLogger } from "../../../src/logger.js"

const log = createLogger("ext.home-assistant")

export interface HAConfig {
  baseUrl: string
  token: string
}

export interface HAEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
}

export interface HAServiceCall {
  domain: string
  service: string
  data: Record<string, unknown>
}

export class HomeAssistantTool {
  constructor(private readonly cfg: HAConfig) {}

  private get h(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      "Content-Type": "application/json",
    }
  }

  private url(p: string): string {
    return `${this.cfg.baseUrl}/api${p}`
  }

  async isOnline(): Promise<boolean> {
    try {
      const r = await fetch(this.url("/"), {
        headers: this.h,
        signal: AbortSignal.timeout(3000),
      })
      return r.ok
    } catch {
      return false
    }
  }

  async getStates(): Promise<HAEntity[]> {
    const r = await fetch(this.url("/states"), { headers: this.h })
    if (!r.ok) throw new Error(`HA getStates failed: ${r.status}`)
    return r.json() as Promise<HAEntity[]>
  }

  async getState(entityId: string): Promise<HAEntity> {
    const r = await fetch(this.url(`/states/${encodeURIComponent(entityId)}`), {
      headers: this.h,
    })
    if (!r.ok)
      throw new Error(`HA getState failed: ${r.status} for ${entityId}`)
    return r.json() as Promise<HAEntity>
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const r = await fetch(
      this.url(
        `/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      ),
      {
        method: "POST",
        headers: this.h,
        body: JSON.stringify(data),
      },
    )
    if (!r.ok) throw new Error(`HA service call failed: ${r.status}`)
    log.debug("service called", { domain, service, data })
  }

  async turnOn(entityId: string): Promise<void> {
    const domain = entityId.split(".")[0]
    if (!domain) throw new Error(`Invalid entity_id: ${entityId}`)
    await this.callService(domain, "turn_on", { entity_id: entityId })
  }

  async turnOff(entityId: string): Promise<void> {
    const domain = entityId.split(".")[0]
    if (!domain) throw new Error(`Invalid entity_id: ${entityId}`)
    await this.callService(domain, "turn_off", { entity_id: entityId })
  }

  async toggle(entityId: string): Promise<void> {
    const domain = entityId.split(".")[0]
    if (!domain) throw new Error(`Invalid entity_id: ${entityId}`)
    await this.callService(domain, "toggle", { entity_id: entityId })
  }

  async setLight(
    entityId: string,
    opts: {
      brightness?: number
      colorTemp?: number
      rgbColor?: [number, number, number]
    },
  ): Promise<void> {
    await this.callService("light", "turn_on", {
      entity_id: entityId,
      ...opts,
    })
  }

  async setClimate(entityId: string, temperature: number): Promise<void> {
    await this.callService("climate", "set_temperature", {
      entity_id: entityId,
      temperature,
    })
  }

  async getLights(): Promise<HAEntity[]> {
    const all = await this.getStates()
    return all.filter((e) => e.entity_id.startsWith("light."))
  }

  async getSensors(): Promise<HAEntity[]> {
    const all = await this.getStates()
    return all.filter((e) => e.entity_id.startsWith("sensor."))
  }

  async getHistory(
    entityId: string,
    hours = 24,
  ): Promise<Array<{ state: string; last_changed: string }>> {
    const start = new Date(Date.now() - hours * 3600_000).toISOString()
    const r = await fetch(
      this.url(
        `/history/period/${start}?filter_entity_id=${encodeURIComponent(entityId)}`,
      ),
      { headers: this.h },
    )
    if (!r.ok) return []
    const d = (await r.json()) as Array<
      Array<{ state: string; last_changed: string }>
    >
    return d[0] ?? []
  }
}
