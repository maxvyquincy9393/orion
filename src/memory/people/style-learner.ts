/**
 * @file style-learner.ts
 * @description Learns and maintains a `StyleProfile` for each known person by
 * analysing message samples related to that person. Profiles drive the
 * SocialDraft module to write contextually appropriate messages.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called after ingesting new interactions via `people-graph.ingestExtraction()`
 *   - Uses `orchestrator.generate("fast", ...)` to infer style from text samples
 *   - Persists style via `peopleGraph.updateCommunicationStyle()`
 *
 * DESIGN:
 *   - Minimum 3 interaction samples before building a style profile
 *   - Re-runs inference when sample count grows by 5 after last inference
 */

import { createLogger } from "../../logger.js"
import { orchestrator } from "../../engines/orchestrator.js"
import { peopleGraph } from "./people-graph.js"
import type { StyleProfile, PersonInteractionRecord } from "./people-schema.js"

const log = createLogger("memory.people.style-learner")

const MIN_SAMPLES = 3
const RESAMPLE_THRESHOLD = 5

const STYLE_INFERENCE_SYSTEM = `You are a communication style analyser. Given a list of interaction summaries about a person, infer their communication style and return a JSON object.

Return ONLY valid JSON, no markdown, no explanation. Schema:
{
  "formality": 1-5,        // 1=very casual, 5=very formal
  "greetings": [],         // common greeting phrases they use
  "phrases": [],           // signature vocabulary/phrases
  "emojiUsage": 0|1|2,     // 0=none, 1=occasional, 2=frequent
  "language": "en",        // primary language code
  "messageLength": "short"|"medium"|"long",
  "responseTime": "fast"|"medium"|"slow",
  "sampleCount": N
}`

// ── StyleLearner ───────────────────────────────────────────────────────────────

/**
 * Infers and maintains `StyleProfile` for known people.
 */
export class StyleLearner {
  /**
   * Update the style profile for `personId` if there are enough new samples.
   * No-ops gracefully if fewer than `MIN_SAMPLES` interactions are available.
   *
   * @param userId   - User scope
   * @param personId - Person to update
   */
  async updateStyle(userId: string, personId: string): Promise<void> {
    const person = await peopleGraph.getById(userId, personId)
    if (!person) {
      log.debug("person not found, skipping style update", { personId })
      return
    }

    const currentSampleCount = person.communicationStyle?.sampleCount ?? 0
    if (person.interactionCount < MIN_SAMPLES) return
    if (person.interactionCount - currentSampleCount < RESAMPLE_THRESHOLD) return

    const interactions = await peopleGraph.getInteractions(personId, 30)
    const style = await this.inferStyle(person.name, interactions)
    await peopleGraph.updateCommunicationStyle(personId, style as unknown as Record<string, unknown>)
    log.info("style profile updated", { personId, name: person.name, samples: style.sampleCount })
  }

  /**
   * Force-rebuild the style profile for `personId` regardless of sample count.
   *
   * @param userId   - User scope
   * @param personId - Person to update
   * @returns Updated StyleProfile, or null if person not found
   */
  async rebuildStyle(userId: string, personId: string): Promise<StyleProfile | null> {
    const person = await peopleGraph.getById(userId, personId)
    if (!person) return null

    const interactions = await peopleGraph.getInteractions(personId, 50)
    if (interactions.length === 0) return null

    const style = await this.inferStyle(person.name, interactions)
    await peopleGraph.updateCommunicationStyle(personId, style as unknown as Record<string, unknown>)
    return style
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async inferStyle(
    name: string,
    interactions: PersonInteractionRecord[],
  ): Promise<StyleProfile> {
    const summaries = interactions
      .map(i => `[${i.type}] ${i.summary}`)
      .join("\n")

    const prompt = `Person: ${name}\nInteraction summaries:\n${summaries}\n\nInfer their communication style.`

    try {
      const raw = await orchestrator.generate("fast", {
        prompt,
        systemPrompt: STYLE_INFERENCE_SYSTEM,
      })
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
      const parsed = JSON.parse(cleaned) as StyleProfile
      return {
        formality: Number(parsed.formality) || 3,
        greetings: Array.isArray(parsed.greetings) ? parsed.greetings : [],
        phrases: Array.isArray(parsed.phrases) ? parsed.phrases : [],
        emojiUsage: ([0, 1, 2].includes(parsed.emojiUsage) ? parsed.emojiUsage : 1) as 0 | 1 | 2,
        language: String(parsed.language || "en"),
        messageLength: (["short", "medium", "long"].includes(parsed.messageLength)
          ? parsed.messageLength
          : "medium") as StyleProfile["messageLength"],
        responseTime: parsed.responseTime,
        sampleCount: interactions.length,
        updatedAt: new Date().toISOString(),
      }
    } catch (err) {
      log.warn("style inference failed, using defaults", { name, err })
      return this.defaultStyle(interactions.length)
    }
  }

  private defaultStyle(sampleCount: number): StyleProfile {
    return {
      formality: 3,
      greetings: [],
      phrases: [],
      emojiUsage: 1,
      language: "en",
      messageLength: "medium",
      sampleCount,
      updatedAt: new Date().toISOString(),
    }
  }
}

/** Singleton style learner */
export const styleLearner = new StyleLearner()
