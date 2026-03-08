/**
 * @file entity-extractor.ts
 * @description LLM-based named entity recognition for people references.
 * Sends each message through a fast LLM to extract person names, relationships,
 * topics, and sentiment — then persists them via PeopleGraph.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called from `src/core/message-pipeline.ts` as an async side-effect
 *   - Uses `orchestrator.generate("fast", ...)` for extraction
 *   - Extracted refs are passed to `PeopleGraph.upsertFromExtraction()`
 *   - Gracefully no-ops if `config.PEOPLE_EXTRACTION_ENABLED` is false
 *
 * PAPER BASIS:
 *   - CoNLL-2003 NER format inspiration for entity tagging
 *   - ReAct / tool-use patterns for structured extraction
 */

import { createLogger } from "../../logger.js"
import config from "../../config.js"
import { orchestrator } from "../../engines/orchestrator.js"
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
} from "./extraction-prompt.js"
import type { ExtractionResult, ExtractedPersonRef } from "./people-schema.js"

const log = createLogger("memory.people.entity-extractor")

/** Minimum message length to bother with extraction (short acks aren't useful) */
const MIN_MESSAGE_LENGTH = 20

// ── PeopleEntityExtractor ──────────────────────────────────────────────────────

/**
 * Extracts person references from natural language messages using an LLM.
 */
export class PeopleEntityExtractor {
  /**
   * Extract all person references from `message`.
   *
   * @param message   - Raw message text
   * @param messageId - Optional source message ID for traceability
   * @returns `ExtractionResult` with found refs (may be empty)
   */
  async extract(message: string, messageId?: string): Promise<ExtractionResult> {
    const now = new Date().toISOString()

    if (!config.PEOPLE_EXTRACTION_ENABLED) {
      return { refs: [], extractedAt: now, messageId }
    }

    if (message.trim().length < MIN_MESSAGE_LENGTH) {
      return { refs: [], extractedAt: now, messageId }
    }

    try {
      const raw = await orchestrator.generate("fast", {
        prompt: buildExtractionPrompt(message),
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      })

      const refs = this.parseRefs(raw)
      log.debug("extraction complete", { found: refs.length, messageId })
      return { refs, extractedAt: now, messageId }
    } catch (err) {
      log.warn("entity extraction failed", { err })
      return { refs: [], extractedAt: now, messageId }
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Parse LLM JSON output into `ExtractedPersonRef[]`.
   * Falls back to empty array on any parse error.
   */
  private parseRefs(raw: string): ExtractedPersonRef[] {
    // Strip potential markdown code fence
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()

    if (!cleaned || cleaned === "[]") return []

    try {
      const parsed: unknown = JSON.parse(cleaned)
      if (!Array.isArray(parsed)) return []

      return parsed
        .filter((item): item is ExtractedPersonRef => {
          return (
            typeof item === "object" &&
            item !== null &&
            typeof (item as Record<string, unknown>).name === "string" &&
            ((item as Record<string, unknown>).name as string).trim().length > 0
          )
        })
        .map(item => ({
          name: String(item.name).trim(),
          relationship: (item.relationship as ExtractedPersonRef["relationship"]) ?? null,
          context: (item.context as ExtractedPersonRef["context"]) ?? null,
          topic: item.topic ? String(item.topic) : undefined,
          sentiment: (item.sentiment as ExtractedPersonRef["sentiment"]) ?? "neutral",
          snippet: item.snippet ? String(item.snippet).slice(0, 120) : "",
        }))
    } catch (err) {
      log.debug("failed to parse extraction JSON", { raw: cleaned.slice(0, 200), err })
      return []
    }
  }
}

/** Singleton extractor */
export const entityExtractor = new PeopleEntityExtractor()
