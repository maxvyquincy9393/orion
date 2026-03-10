/**
 * @file tool.ts
 * @description Home Assistant integration tool for EDITH — control devices,
 *   query states, and trigger automations via the HA REST API.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Loaded by the skills system. Calls the Home Assistant REST API.
 *   Requires HA_URL and HA_TOKEN in config.
 */

import config from "../../src/config.js"
import { createLogger } from "../../src/logger.js"

const log = createLogger("ext.home-assistant")

interface HAState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
}

function getBaseUrl(): string {
  const url = config.HA_URL
  if (!url?.trim()) {
    throw new Error("HA_URL is not configured")
  }
  return url.replace(/\/$/, "")
}

async function haFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = config.HA_TOKEN
  if (!token?.trim()) {
    throw new Error("HA_TOKEN is not configured")
  }

  const baseUrl = getBaseUrl()
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Home Assistant API ${response.status}: ${body.slice(0, 200)}`)
  }

  return response.json() as Promise<T>
}

/** Get all entity states from Home Assistant. */
export async function getStates(): Promise<HAState[]> {
  log.debug("fetching all HA states")
  return haFetch<HAState[]>("/states")
}

/** Get a specific entity's state. */
export async function getEntityState(entityId: string): Promise<HAState> {
  log.debug("fetching entity state", { entityId })
  return haFetch<HAState>(`/states/${encodeURIComponent(entityId)}`)
}

/** Call a Home Assistant service (e.g., turn on a light). */
export async function callService(
  domain: string,
  service: string,
  entityId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  log.debug("calling HA service", { domain, service, entityId })
  await haFetch(`/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: "POST",
    body: JSON.stringify({
      entity_id: entityId,
      ...data,
    }),
  })
}

/** Toggle an entity (on/off). */
export async function toggleEntity(entityId: string): Promise<void> {
  const [domain] = entityId.split(".")
  if (!domain) {
    throw new Error(`Invalid entity_id: ${entityId}`)
  }
  await callService("homeassistant", "toggle", entityId)
}

/** Tool metadata for the skills loader. */
export const toolMeta = {
  name: "home-assistant",
  description: "Home Assistant integration — get states, control devices, call services",
  functions: { getStates, getEntityState, callService, toggleEntity },
}
