/**
 * @file interaction-stats.ts
 * @description Computes aggregated statistics from interaction history.
 * Used by the social-skill to answer questions like "How often do I talk to Alice?"
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Pure computation module — no Prisma calls, takes data from `people-graph.ts`
 *   - Imported by `social-skill.ts` and `relationship-reminders.ts`
 */

import type {
  PersonInteractionRecord,
  PersonStats,
  InteractionSentiment,
  InteractionType,
} from "./people-schema.js"

/**
 * Compute stats for a person from their interaction history.
 *
 * @param personId    - Person identifier
 * @param name        - Person's display name
 * @param interactions - Raw interaction records
 * @returns Aggregated stats
 */
export function computePersonStats(
  personId: string,
  name: string,
  interactions: PersonInteractionRecord[],
): PersonStats {
  const total = interactions.length

  const sentimentBreakdown: Record<InteractionSentiment, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  }

  const interactionTypes: Record<InteractionType, number> = {
    mention: 0,
    meeting: 0,
    call: 0,
    email: 0,
    plan: 0,
    message: 0,
  }

  const topicFreq: Record<string, number> = {}

  for (const i of interactions) {
    sentimentBreakdown[i.sentiment] = (sentimentBreakdown[i.sentiment] ?? 0) + 1
    interactionTypes[i.type] = (interactionTypes[i.type] ?? 0) + 1
    if (i.topic) {
      topicFreq[i.topic] = (topicFreq[i.topic] ?? 0) + 1
    }
  }

  const topTopics = Object.entries(topicFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic)

  const sorted = [...interactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )

  const mostRecentInteraction = sorted[0]?.date

  // Average gap between consecutive interactions
  let avgGap: number | undefined
  if (sorted.length >= 2) {
    let totalGapMs = 0
    for (let idx = 0; idx < sorted.length - 1; idx++) {
      totalGapMs +=
        new Date(sorted[idx].date).getTime() -
        new Date(sorted[idx + 1].date).getTime()
    }
    avgGap = totalGapMs / (sorted.length - 1) / (1000 * 60 * 60 * 24)
  }

  return {
    personId,
    name,
    totalInteractions: total,
    sentimentBreakdown,
    interactionTypes,
    mostRecentInteraction,
    averageInteractionGapDays: avgGap,
    topTopics,
  }
}

/**
 * Compute interaction frequency (interactions per week) over the last N days.
 *
 * @param interactions - Interaction records
 * @param windowDays   - Look-back window in days (default 90)
 * @returns Interactions per week
 */
export function interactionFrequencyPerWeek(
  interactions: PersonInteractionRecord[],
  windowDays = 90,
): number {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  const recent = interactions.filter(i => new Date(i.date) >= cutoff)
  return (recent.length / windowDays) * 7
}

/**
 * Find the most common interaction type for a person.
 *
 * @param interactions - Interaction records
 * @returns Most common type, or "mention" as fallback
 */
export function dominantInteractionType(
  interactions: PersonInteractionRecord[],
): InteractionType {
  if (interactions.length === 0) return "mention"
  const counts: Record<string, number> = {}
  for (const i of interactions) {
    counts[i.type] = (counts[i.type] ?? 0) + 1
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "mention") as InteractionType
}
