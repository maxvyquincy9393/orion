import { describe, expect, it, beforeEach } from "vitest"

import {
  tagProvenance,
  provenanceToMetadata,
  extractProvenanceFromMetadata,
  isDirectUserInput,
  isToolResult,
  isWebhookInput,
  isProactiveTrigger,
  type ProvenanceTag,
} from "../input-provenance.js"

describe("input-provenance", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // tagProvenance
  // ───────────────────────────────────────────────────────────────────────────

  describe("tagProvenance", () => {
    it("tags content with direct user source", () => {
      const result = tagProvenance("hello", "user_direct")

      expect(result.content).toBe("hello")
      expect(result.provenance.source).toBe("user_direct")
      expect(result.provenance.timestamp).toBeGreaterThan(0)
      expect(result.provenance.metadata).toBeUndefined()
    })

    it("tags content with metadata", () => {
      const meta = { channel: "whatsapp", messageId: "abc123" }
      const result = tagProvenance("test", "webhook", meta)

      expect(result.provenance.source).toBe("webhook")
      expect(result.provenance.metadata).toEqual(meta)
    })

    it("tags tool results", () => {
      const result = tagProvenance("search results here", "tool_result")
      expect(result.provenance.source).toBe("tool_result")
    })

    it("tags proactive triggers", () => {
      const result = tagProvenance("reminder: meeting", "proactive_trigger")
      expect(result.provenance.source).toBe("proactive_trigger")
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // provenanceToMetadata / extractProvenanceFromMetadata
  // ───────────────────────────────────────────────────────────────────────────

  describe("provenanceToMetadata roundtrip", () => {
    it("converts provenance tag to metadata and back", () => {
      const tag: ProvenanceTag = {
        source: "user_direct",
        timestamp: 1709500000000,
      }

      const metadata = provenanceToMetadata(tag)
      expect(metadata).toHaveProperty("provenance")

      const extracted = extractProvenanceFromMetadata(metadata)
      expect(extracted).not.toBeNull()
      expect(extracted!.source).toBe("user_direct")
      expect(extracted!.timestamp).toBe(1709500000000)
    })

    it("preserves extra metadata fields", () => {
      const tag: ProvenanceTag = {
        source: "webhook",
        timestamp: 1709500000000,
        metadata: { hookId: "h-1" },
      }

      const metadata = provenanceToMetadata(tag)
      const prov = metadata.provenance as Record<string, unknown>
      expect(prov.hookId).toBe("h-1")
    })
  })

  describe("extractProvenanceFromMetadata", () => {
    it("returns null for null/undefined input", () => {
      expect(extractProvenanceFromMetadata(null)).toBeNull()
      expect(extractProvenanceFromMetadata(undefined)).toBeNull()
    })

    it("returns null if no provenance key", () => {
      expect(extractProvenanceFromMetadata({ other: "data" })).toBeNull()
    })

    it("returns null if provenance.source is missing", () => {
      expect(extractProvenanceFromMetadata({ provenance: { timestamp: 123 } })).toBeNull()
    })

    it("uses Date.now() fallback when timestamp is not a number", () => {
      const before = Date.now()
      const result = extractProvenanceFromMetadata({
        provenance: { source: "user_direct", timestamp: "bad" },
      })
      const after = Date.now()

      expect(result).not.toBeNull()
      expect(result!.timestamp).toBeGreaterThanOrEqual(before)
      expect(result!.timestamp).toBeLessThanOrEqual(after)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Type guard helpers
  // ───────────────────────────────────────────────────────────────────────────

  describe("type guard helpers", () => {
    it("isDirectUserInput", () => {
      expect(isDirectUserInput({ source: "user_direct", timestamp: 0 })).toBe(true)
      expect(isDirectUserInput({ source: "webhook", timestamp: 0 })).toBe(false)
      expect(isDirectUserInput(null)).toBe(false)
    })

    it("isToolResult", () => {
      expect(isToolResult({ source: "tool_result", timestamp: 0 })).toBe(true)
      expect(isToolResult({ source: "user_direct", timestamp: 0 })).toBe(false)
      expect(isToolResult(null)).toBe(false)
    })

    it("isWebhookInput", () => {
      expect(isWebhookInput({ source: "webhook", timestamp: 0 })).toBe(true)
      expect(isWebhookInput({ source: "user_direct", timestamp: 0 })).toBe(false)
      expect(isWebhookInput(null)).toBe(false)
    })

    it("isProactiveTrigger", () => {
      expect(isProactiveTrigger({ source: "proactive_trigger", timestamp: 0 })).toBe(true)
      expect(isProactiveTrigger({ source: "user_direct", timestamp: 0 })).toBe(false)
      expect(isProactiveTrigger(null)).toBe(false)
    })
  })
})
