/**
 * @file hud-card-manager.ts
 * @description Priority-queue card manager for HUD overlay cards.
 *
 * ARCHITECTURE:
 *   Maintains an in-memory list of active HudCards for a user.
 *   Cards are sorted by priority (desc) then createdAt (asc).
 *   Expired or dismissed cards are filtered out on every read.
 *   Persists cards to the `HudCard` Prisma model for cross-session
 *   continuity but always serves from the in-memory list for speed.
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import config from "../config.js"
import type { HudCard, HudCardType } from "./hud-schema.js"

const log = createLogger("hud.card-manager")

/** Input for creating a new HUD card. */
export interface CreateCardInput {
  userId: string
  type: HudCardType
  title: string
  body?: string
  priority?: number
  ttlMs?: number
  metadata?: Record<string, unknown>
}

/**
 * Manages the lifecycle of HUD overlay cards.
 * Creates, expires, dismisses, and lists cards per user.
 */
export class HudCardManager {
  /** In-memory card cache keyed by userId. */
  private readonly cache = new Map<string, HudCard[]>()

  /**
   * Adds a new card for the user and persists it.
   * Enforces MAX_NOTIFICATIONS cap (oldest excess cards are removed).
   */
  async add(input: CreateCardInput): Promise<HudCard> {
    const ttl = input.ttlMs ?? config.HUD_CARD_TTL_MS
    const expiresAt = new Date(Date.now() + ttl)

    const row = await prisma.hudCard.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        priority: input.priority ?? 0,
        dismissed: false,
        expiresAt,
        metadata: (input.metadata as object) ?? undefined,
      },
    })

    const card: HudCard = {
      id: row.id,
      userId: row.userId,
      type: row.type as HudCardType,
      title: row.title,
      body: row.body ?? undefined,
      priority: row.priority,
      dismissed: row.dismissed,
      expiresAt: row.expiresAt ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt,
    }

    const userCards = this.cache.get(input.userId) ?? []
    userCards.push(card)
    this.cache.set(input.userId, userCards)

    await this.enforceMaxCap(input.userId)
    log.debug("card added", { userId: input.userId, cardId: card.id, type: card.type })
    return card
  }

  /**
   * Dismisses a card by ID, removing it from the visible stack.
   */
  async dismiss(cardId: string, userId: string): Promise<void> {
    await prisma.hudCard.update({
      where: { id: cardId },
      data: { dismissed: true },
    })
    const cards = this.cache.get(userId) ?? []
    const found = cards.find(c => c.id === cardId)
    if (found) found.dismissed = true
    log.debug("card dismissed", { userId, cardId })
  }

  /**
   * Returns active (non-dismissed, non-expired) cards for a user,
   * sorted by priority descending.
   */
  list(userId: string): HudCard[] {
    const now = new Date()
    const cards = this.cache.get(userId) ?? []
    return cards
      .filter(c => !c.dismissed && (!c.expiresAt || c.expiresAt > now))
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, config.HUD_MAX_NOTIFICATIONS)
  }

  /**
   * Loads persisted cards from DB into the in-memory cache.
   * Call once during startup.
   */
  async loadFromDb(userId: string): Promise<void> {
    const rows = await prisma.hudCard.findMany({
      where: { userId, dismissed: false, expiresAt: { gt: new Date() } },
      orderBy: { priority: "desc" },
    })
    const cards: HudCard[] = rows.map(r => ({
      id: r.id,
      userId: r.userId,
      type: r.type as HudCardType,
      title: r.title,
      body: r.body ?? undefined,
      priority: r.priority,
      dismissed: r.dismissed,
      expiresAt: r.expiresAt ?? undefined,
      metadata: (r.metadata as Record<string, unknown>) ?? undefined,
      createdAt: r.createdAt,
    }))
    this.cache.set(userId, cards)
    log.debug("cards loaded from db", { userId, count: cards.length })
  }

  /** Removes oldest excess cards when cap is exceeded. */
  private async enforceMaxCap(userId: string): Promise<void> {
    const active = this.list(userId)
    if (active.length <= config.HUD_MAX_NOTIFICATIONS) return
    const excess = active.slice(config.HUD_MAX_NOTIFICATIONS)
    for (const card of excess) {
      await this.dismiss(card.id, userId)
    }
  }
}

export const hudCardManager = new HudCardManager()
