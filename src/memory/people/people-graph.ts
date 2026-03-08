/**
 * @file people-graph.ts
 * @description PeopleGraph — the central Prisma-backed store for known persons
 * and their interactions. Acts as the single gateway for all read/write access
 * to the `Person` and `PersonInteraction` Prisma models.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - `entity-extractor.ts` feeds `ExtractionResult` here
 *   - `interaction-tracker.ts` calls `addInteraction()`
 *   - `style-learner.ts` and `dormant-detector.ts` query this graph
 *   - `social-skill.ts` is the public skill wrapper over this module
 */

import { createLogger } from "../../logger.js"
import { prisma } from "../../database/index.js"
import type { Prisma } from "@prisma/client"
import config from "../../config.js"
import type {
  PersonEntity,
  PersonInteractionRecord,
  ExtractedPersonRef,
  ExtractionResult,
  RelationshipType,
  RelationshipContext,
  InteractionSentiment,
} from "./people-schema.js"

const log = createLogger("memory.people.graph")

// ── PeopleGraph ───────────────────────────────────────────────────────────────

/**
 * Read/write gateway for the people graph persisted in SQLite via Prisma.
 */
export class PeopleGraph {
  // ── Queries ─────────────────────────────────────────────────────────────────

  /**
   * Find a person by exact name (case-insensitive) or alias.
   *
   * @param userId - User scope
   * @param name   - Name to look up
   * @returns Person record, or null if not found
   */
  async findByName(userId: string, name: string): Promise<PersonEntity | null> {
    // Prisma SQLite has no case-insensitive string filter, so we do a JS filter
    const all = await prisma.person.findMany({ where: { userId } })
    const lower = name.toLowerCase()
    const match = all.find(p => {
      if (p.name.toLowerCase() === lower) return true
      const aliases = (p.aliases as string[]) ?? []
      return aliases.some(a => a.toLowerCase() === lower)
    })
    return match ? this.toDomain(match) : null
  }

  /**
   * Get a person by ID.
   *
   * @param userId   - User scope (for authorization check)
   * @param personId - Prisma person ID
   */
  async getById(userId: string, personId: string): Promise<PersonEntity | null> {
    const p = await prisma.person.findFirst({ where: { id: personId, userId } })
    return p ? this.toDomain(p) : null
  }

  /**
   * List all persons for a user.
   *
   * @param userId - User scope
   */
  async listAll(userId: string): Promise<PersonEntity[]> {
    const all = await prisma.person.findMany({
      where: { userId },
      orderBy: { lastSeen: "desc" },
    })
    return all.map(p => this.toDomain(p))
  }

  /**
   * Search persons by partial name match.
   *
   * @param userId - User scope
   * @param query  - Partial name string
   */
  async search(userId: string, query: string): Promise<PersonEntity[]> {
    const all = await prisma.person.findMany({ where: { userId } })
    const lower = query.toLowerCase()
    return all
      .filter(p => p.name.toLowerCase().includes(lower))
      .map(p => this.toDomain(p))
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  /**
   * Upsert a person (create if new, update lastSeen + interactionCount if existing).
   *
   * @param userId - User scope
   * @param ref    - Extracted reference from entity extractor
   * @returns Upserted person entity
   */
  async upsertPerson(userId: string, ref: ExtractedPersonRef): Promise<PersonEntity> {
    if (!config.PEOPLE_GRAPH_ENABLED) {
      throw new Error("People graph is disabled (PEOPLE_GRAPH_ENABLED=false)")
    }

    const existing = await this.findByName(userId, ref.name)
    const now = new Date()

    if (existing) {
      const updated = await prisma.person.update({
        where: { id: existing.id },
        data: {
          lastSeen: now,
          interactionCount: { increment: 1 },
          // Merge aliases without duplicates
          aliases: JSON.stringify(
            Array.from(new Set([...(existing.aliases ?? []), ref.name])).filter(
              a => a.toLowerCase() !== existing.name.toLowerCase(),
            ),
          ),
        },
      })
      log.debug("person updated", { name: ref.name, userId })
      return this.toDomain(updated)
    }

    const created = await prisma.person.create({
      data: {
        userId,
        name: ref.name,
        aliases: JSON.stringify([]),
        relationship: ref.relationship ?? "contact",
        context: ref.context ?? "other",
        notes: "",
        firstSeen: now,
        lastSeen: now,
        interactionCount: 1,
      },
    })
    log.info("person created", { name: ref.name, userId })
    return this.toDomain(created)
  }

  /**
   * Process a full extraction result — upsert persons and record interactions.
   *
   * @param userId     - User who sent the message
   * @param result     - Output from `entityExtractor.extract()`
   * @param channel    - Channel the message came from
   */
  async ingestExtraction(
    userId: string,
    result: ExtractionResult,
    channel = "chat",
  ): Promise<void> {
    if (!config.PEOPLE_GRAPH_ENABLED || result.refs.length === 0) return

    for (const ref of result.refs) {
      try {
        const person = await this.upsertPerson(userId, ref)
        await prisma.personInteraction.create({
          data: {
            personId: person.id,
            userId,
            type: "mention",
            topic: ref.topic ?? "",
            sentiment: ref.sentiment,
            channel,
            summary: ref.snippet,
            sourceMessageId: result.messageId,
          },
        })
      } catch (err) {
        log.warn("failed to ingest person ref", { name: ref.name, err })
      }
    }
  }

  /**
   * Add an explicit interaction record for a person.
   *
   * @param userId     - User scope
   * @param personId   - Person ID
   * @param type       - Interaction type
   * @param summary    - Brief summary
   * @param topic      - Topic discussed
   * @param sentiment  - Sentiment of interaction
   * @param channel    - Channel
   */
  async addInteraction(
    userId: string,
    personId: string,
    type: PersonInteractionRecord["type"],
    summary: string,
    topic = "",
    sentiment: InteractionSentiment = "neutral",
    channel = "chat",
  ): Promise<PersonInteractionRecord> {
    const interaction = await prisma.personInteraction.create({
      data: { personId, userId, type, summary, topic, sentiment, channel },
    })
    await prisma.person.update({
      where: { id: personId },
      data: { lastSeen: new Date(), interactionCount: { increment: 1 } },
    })
    return this.toInteractionDomain(interaction)
  }

  /**
   * Get interaction history for a person.
   *
   * @param personId - Person ID
   * @param limit    - Max interactions to return (default 50)
   */
  async getInteractions(personId: string, limit = 50): Promise<PersonInteractionRecord[]> {
    const interactions = await prisma.personInteraction.findMany({
      where: { personId },
      orderBy: { date: "desc" },
      take: limit,
    })
    return interactions.map(i => this.toInteractionDomain(i))
  }

  /**
   * Update a person's communication style profile.
   *
   * @param personId - Person ID
   * @param style    - Updated StyleProfile as JSON-serializable object
   */
  async updateCommunicationStyle(
    personId: string,
    style: Record<string, unknown>,
  ): Promise<void> {
    await prisma.person.update({
      where: { id: personId },
      data: { communicationStyle: style as Prisma.InputJsonValue },
    })
  }

  /**
   * Update notes on a person record.
   *
   * @param userId   - User scope
   * @param personId - Person ID
   * @param notes    - New notes text
   */
  async updateNotes(userId: string, personId: string, notes: string): Promise<void> {
    await prisma.person.updateMany({
      where: { id: personId, userId },
      data: { notes },
    })
  }

  /**
   * Delete a person and cascade-delete their interactions.
   *
   * @param userId   - User scope (authorization check)
   * @param personId - Person ID
   */
  async deletePerson(userId: string, personId: string): Promise<boolean> {
    const existing = await prisma.person.findFirst({ where: { id: personId, userId } })
    if (!existing) return false
    await prisma.person.delete({ where: { id: personId } })
    return true
  }

  // ── Domain Mappers ───────────────────────────────────────────────────────────

  private toDomain(p: {
    id: string
    userId: string
    name: string
    aliases: unknown
    relationship: string
    context: string
    birthday: Date | null
    notes: string
    communicationStyle: unknown
    firstSeen: Date
    lastSeen: Date
    interactionCount: number
    createdAt: Date
    updatedAt: Date
  }): PersonEntity {
    return {
      id: p.id,
      userId: p.userId,
      name: p.name,
      aliases: (p.aliases as string[]) ?? [],
      relationship: p.relationship as RelationshipType,
      context: p.context as RelationshipContext,
      birthday: p.birthday ?? undefined,
      notes: p.notes,
      communicationStyle: p.communicationStyle
        ? (p.communicationStyle as PersonEntity["communicationStyle"])
        : undefined,
      firstSeen: p.firstSeen,
      lastSeen: p.lastSeen,
      interactionCount: p.interactionCount,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }
  }

  private toInteractionDomain(i: {
    id: string
    personId: string
    userId: string
    date: Date
    type: string
    topic: string
    sentiment: string
    channel: string
    summary: string
    sourceMessageId: string | null
    createdAt: Date
  }): PersonInteractionRecord {
    return {
      id: i.id,
      personId: i.personId,
      userId: i.userId,
      date: i.date,
      type: i.type as PersonInteractionRecord["type"],
      topic: i.topic,
      sentiment: i.sentiment as InteractionSentiment,
      channel: i.channel,
      summary: i.summary,
      sourceMessageId: i.sourceMessageId ?? undefined,
      createdAt: i.createdAt,
    }
  }
}

/** Singleton people graph */
export const peopleGraph = new PeopleGraph()
