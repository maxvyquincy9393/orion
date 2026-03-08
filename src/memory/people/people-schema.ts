/**
 * @file people-schema.ts
 * @description TypeScript type definitions for the Phase 18 Social & Relationship
 * Memory system. All interfaces here map directly to — or extend — Prisma models.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Imported by all modules in `src/memory/people/`
 *   - Prisma models `Person` and `PersonInteraction` are the persistence layer;
 *     these interfaces are the application-layer representation
 */

// ── People & Relationships ─────────────────────────────────────────────────────

/** Relationship type between the user and a person */
export type RelationshipType =
  | "manager"
  | "report"
  | "colleague"
  | "friend"
  | "family"
  | "partner"
  | "mentor"
  | "mentee"
  | "contact"
  | "other"

/** Social context where the relationship exists */
export type RelationshipContext = "work" | "personal" | "family" | "other"

/** A person entity known to EDITH */
export interface PersonEntity {
  id: string
  userId: string
  name: string
  aliases: string[]
  relationship: RelationshipType
  context: RelationshipContext
  birthday?: Date
  notes: string
  communicationStyle?: StyleProfile
  firstSeen: Date
  lastSeen: Date
  interactionCount: number
  createdAt: Date
  updatedAt: Date
}

// ── Interaction ────────────────────────────────────────────────────────────────

/** Types of interactions that can be recorded */
export type InteractionType = "mention" | "meeting" | "call" | "email" | "plan" | "message"

/** Sentiment of an interaction */
export type InteractionSentiment = "positive" | "neutral" | "negative"

/** A single recorded interaction with a person */
export interface PersonInteractionRecord {
  id: string
  personId: string
  userId: string
  date: Date
  type: InteractionType
  topic: string
  sentiment: InteractionSentiment
  channel: string
  summary: string
  sourceMessageId?: string
  createdAt: Date
}

// ── Style Profile ──────────────────────────────────────────────────────────────

/** Communication style profile learned from actual interactions */
export interface StyleProfile {
  /** 1 (very casual) to 5 (very formal) */
  formality: number
  /** Common greeting phrases */
  greetings: string[]
  /** Signature phrases / vocabulary */
  phrases: string[]
  /** Preferred emoji usage (0 = none, 1 = occasional, 2 = frequent) */
  emojiUsage: 0 | 1 | 2
  /** Dominant language code (e.g. "en", "id", "mixed") */
  language: string
  /** Average message length: "short" | "medium" | "long" */
  messageLength: "short" | "medium" | "long"
  /** Response time tendency */
  responseTime?: "fast" | "medium" | "slow"
  /** Number of samples used to build this profile */
  sampleCount: number
  /** ISO timestamp of last update */
  updatedAt: string
}

// ── Extraction ─────────────────────────────────────────────────────────────────

/** A person reference extracted from a message */
export interface ExtractedPersonRef {
  /** Name as it appeared in text */
  name: string
  /** Inferred relationship type (or null if unclear) */
  relationship: RelationshipType | null
  /** Inferred context */
  context: RelationshipContext | null
  /** Extracted action/topic involving this person */
  topic?: string
  /** Sentiment of the mention */
  sentiment: InteractionSentiment
  /** Raw text snippet that triggered the extraction */
  snippet: string
}

/** Result of running entity extraction on a message */
export interface ExtractionResult {
  /** References found in this message */
  refs: ExtractedPersonRef[]
  /** ISO timestamp */
  extractedAt: string
  /** Source message ID */
  messageId?: string
}

// ── Stats ──────────────────────────────────────────────────────────────────────

/** Aggregated statistics for a person */
export interface PersonStats {
  personId: string
  name: string
  totalInteractions: number
  sentimentBreakdown: Record<InteractionSentiment, number>
  interactionTypes: Record<InteractionType, number>
  mostRecentInteraction?: Date
  averageInteractionGapDays?: number
  topTopics: string[]
}

// ── Reminders ─────────────────────────────────────────────────────────────────

/** A reminder about a relationship */
export interface RelationshipReminder {
  userId: string
  personId: string
  personName: string
  type: "dormant" | "birthday" | "follow-up"
  message: string
  dueAt: Date
  priority: "high" | "medium" | "low"
}
