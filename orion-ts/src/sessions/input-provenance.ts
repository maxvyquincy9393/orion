import { createLogger } from "../logger.js"

const log = createLogger("sessions.provenance")

export type InputSource = "user_direct" | "tool_result" | "webhook" | "proactive_trigger"

export interface ProvenanceTag {
  source: InputSource
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface ProvenanceMessage {
  content: string
  provenance: ProvenanceTag
}

export function tagProvenance(
  content: string,
  source: InputSource,
  metadata?: Record<string, unknown>
): ProvenanceMessage {
  const provenance: ProvenanceTag = {
    source,
    timestamp: Date.now(),
    metadata,
  }

  log.debug("Input tagged with provenance", {
    source,
    contentLength: content.length,
    hasMetadata: metadata !== undefined,
  })

  return {
    content,
    provenance,
  }
}

export function provenanceToMetadata(provenance: ProvenanceTag): Record<string, unknown> {
  return {
    provenance: {
      source: provenance.source,
      timestamp: provenance.timestamp,
      ...provenance.metadata,
    },
  }
}

export function extractProvenanceFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): ProvenanceTag | null {
  if (!metadata || typeof metadata !== "object") {
    return null
  }

  const prov = metadata.provenance as Record<string, unknown> | undefined
  if (!prov || typeof prov !== "object") {
    return null
  }

  const source = prov.source as InputSource | undefined
  if (!source) {
    return null
  }

  return {
    source,
    timestamp: typeof prov.timestamp === "number" ? prov.timestamp : Date.now(),
    metadata: prov as Record<string, unknown>,
  }
}

export function isDirectUserInput(provenance: ProvenanceTag | null): boolean {
  return provenance?.source === "user_direct"
}

export function isToolResult(provenance: ProvenanceTag | null): boolean {
  return provenance?.source === "tool_result"
}

export function isWebhookInput(provenance: ProvenanceTag | null): boolean {
  return provenance?.source === "webhook"
}

export function isProactiveTrigger(provenance: ProvenanceTag | null): boolean {
  return provenance?.source === "proactive_trigger"
}
