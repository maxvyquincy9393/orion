/**
 * @file interaction-tracker.ts
 * @description Tracks and records explicit user-initiated interactions with
 * known people (meetings, calls, emails, plans). Serves as the user-facing API
 * for logging interactions manually, separate from auto-extracted mentions.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called from `social-skill.ts` when user says "I had a meeting with Alice"
 *   - Delegates persistence to `people-graph.ts`
 */

import { createLogger } from "../../logger.js"
import { peopleGraph } from "./people-graph.js"
import type {
  PersonInteractionRecord,
  InteractionType,
  InteractionSentiment,
} from "./people-schema.js"

const log = createLogger("memory.people.interaction-tracker")

// ── InteractionTracker ─────────────────────────────────────────────────────────

/**
 * Records explicit interactions and provides interaction history lookups.
 */
export class InteractionTracker {
  /**
   * Log an explicit interaction with a named person.
   * If the person doesn't exist in the graph yet, this will throw —
   * callers should ensure the person exists first via `peopleGraph.upsertPerson`.
   *
   * @param userId    - User scope
   * @param personId  - Person ID from the people graph
   * @param type      - Interaction type
   * @param summary   - Brief summary of what happened
   * @param topic     - Main topic discussed
   * @param sentiment - Emotional tone
   * @param channel   - Channel (default "direct")
   * @returns Created interaction record
   */
  async log(
    userId: string,
    personId: string,
    type: InteractionType,
    summary: string,
    topic = "",
    sentiment: InteractionSentiment = "neutral",
    channel = "direct",
  ): Promise<PersonInteractionRecord> {
    const interaction = await peopleGraph.addInteraction(
      userId,
      personId,
      type,
      summary,
      topic,
      sentiment,
      channel,
    )
    log.info("interaction logged", { userId, personId, type, sentiment })
    return interaction
  }

  /**
   * Get recent interactions for a person.
   *
   * @param personId - Person ID
   * @param limit    - Max records to return
   */
  async getHistory(personId: string, limit = 20): Promise<PersonInteractionRecord[]> {
    return peopleGraph.getInteractions(personId, limit)
  }

  /**
   * Get all interactions across all people for a user within a date range.
   *
   * @param userId - User scope
   * @param since  - Start date (inclusive)
   * @param until  - End date (inclusive, defaults to now)
   */
  async getRange(
    userId: string,
    since: Date,
    until = new Date(),
  ): Promise<PersonInteractionRecord[]> {
    const { prisma } = await import("../../database/index.js")
    const records = await prisma.personInteraction.findMany({
      where: {
        userId,
        date: { gte: since, lte: until },
      },
      orderBy: { date: "desc" },
    })
    return records.map(r => ({
      id: r.id,
      personId: r.personId,
      userId: r.userId,
      date: r.date,
      type: r.type as InteractionType,
      topic: r.topic,
      sentiment: r.sentiment as InteractionSentiment,
      channel: r.channel,
      summary: r.summary,
      sourceMessageId: r.sourceMessageId ?? undefined,
      createdAt: r.createdAt,
    }))
  }
}

/** Singleton interaction tracker */
export const interactionTracker = new InteractionTracker()
