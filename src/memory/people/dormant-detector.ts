/**
 * @file dormant-detector.ts
 * @description Detects relationships that have gone "dormant" — people the user
 * used to interact with frequently but hasn't mentioned recently.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called from `relationship-reminders.ts` and the background daemon
 *   - Uses `interaction-stats.ts` for frequency calculation
 *   - Returns candidate `RelationshipReminder` objects for the daemon to deliver
 */

import { createLogger } from "../../logger.js"
import config from "../../config.js"
import { prisma } from "../../database/index.js"
import { interactionFrequencyPerWeek } from "./interaction-stats.js"
import type {
  RelationshipReminder,
  PersonInteractionRecord,
  InteractionSentiment,
  InteractionType,
} from "./people-schema.js"

const log = createLogger("memory.people.dormant-detector")

/** Minimum interactions before a person can be "dormant" (avoid false positives) */
const MIN_HISTORY_INTERACTIONS = 3

// ── DormantDetector ────────────────────────────────────────────────────────────

/**
 * Finds people who haven't been mentioned in `config.DORMANT_CONTACT_DAYS` days
 * but had a meaningful relationship history.
 */
export class DormantDetector {
  /**
   * Scan all persons for a user and return dormant contact reminders.
   *
   * @param userId - User scope
   * @returns Array of dormant reminders (may be empty)
   */
  async detectDormant(userId: string): Promise<RelationshipReminder[]> {
    if (!config.PEOPLE_GRAPH_ENABLED) return []

    const people = await prisma.person.findMany({
      where: {
        userId,
        interactionCount: { gte: MIN_HISTORY_INTERACTIONS },
      },
    })

    const cutoffDays = config.DORMANT_CONTACT_DAYS
    const now = new Date()
    const cutoff = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000)

    const reminders: RelationshipReminder[] = []

    for (const person of people) {
      if (person.lastSeen <= cutoff) {
        const interactions = await this.loadInteractions(person.id)
        const freqPerWeek = interactionFrequencyPerWeek(interactions, 90)

        // Only remind if they were actually regular contacts (≥ 0.5 interactions/week)
        if (freqPerWeek < 0.5) continue

        const daysSince = Math.floor(
          (now.getTime() - person.lastSeen.getTime()) / (1000 * 60 * 60 * 24),
        )

        reminders.push({
          userId,
          personId: person.id,
          personName: person.name,
          type: "dormant",
          message: `You haven't connected with ${person.name} in ${daysSince} days — they used to be a regular contact.`,
          dueAt: now,
          priority: daysSince > cutoffDays * 2 ? "high" : "medium",
        })

        log.debug("dormant contact detected", { name: person.name, daysSince })
      }
    }

    return reminders
  }

  /**
   * Check whether a specific person is dormant.
   *
   * @param userId   - User scope
   * @param personId - Person to check
   * @returns `true` if dormant
   */
  async isDormant(userId: string, personId: string): Promise<boolean> {
    const person = await prisma.person.findFirst({ where: { id: personId, userId } })
    if (!person) return false
    const cutoff = new Date(
      Date.now() - config.DORMANT_CONTACT_DAYS * 24 * 60 * 60 * 1000,
    )
    return person.lastSeen <= cutoff && person.interactionCount >= MIN_HISTORY_INTERACTIONS
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async loadInteractions(personId: string): Promise<PersonInteractionRecord[]> {
    const rows = await prisma.personInteraction.findMany({
      where: { personId },
      orderBy: { date: "desc" },
      take: 100,
    })
    return rows.map(r => ({
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

/** Singleton dormant detector */
export const dormantDetector = new DormantDetector()
