/**
 * episodic.ts — Episodic Memory for Structured Experience Recall
 *
 * Implementation based on:
 *   Sumers et al., "Cognitive Architectures for Language Agents" (CoALA)
 *   (arXiv:2309.02427, 2023) — episodic memory component
 *
 *   Park et al., "Generative Agents: Interactive Simulacra of Human Behavior"
 *   (UIST 2023, arXiv:2304.03442) — importance scoring & reflection
 *
 *   Packer et al., "MemGPT: Towards LLMs as Operating Systems"
 *   (arXiv:2310.08560, 2023) — tiered memory with paging
 *
 * Episodic memory stores structured *episodes* — complete task executions with:
 *   - What: the task, approach, and outcome
 *   - When: timestamps for temporal recall
 *   - Why: causal context and user intent
 *   - How: which tools/strategies were used
 *   - Result: success/failure + a verbal lesson learned
 *
 * This enables the agent to:
 *   - recall "last time you asked about X, we did Y and it worked"
 *   - avoid repeating past mistakes (failure episodes inform future attempts)
 *   - transfer learnings across similar tasks
 *
 * @module memory/episodic
 */

import crypto from "node:crypto"
import path from "node:path"
import { createLogger } from "../logger.js"
import {
  readJsonFile,
  resolvePersistenceEnabled,
  resolveStateDir,
  writeJsonAtomic,
} from "./persistence.js"

const log = createLogger("memory.episodic")

// ── Configuration ────────────────────────────────────────────────────────────

/** Maximum episodes kept in memory */
const MAX_EPISODES = 200

/** Importance threshold for retention (below this → candidate for eviction) */
const MIN_IMPORTANCE = 0.2

/** Recency decay half-life in milliseconds (7 days) */
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

/** Maximum episodes to return in a retrieval query */
const MAX_RETRIEVAL = 5
const EPISODIC_PERSISTENCE_VERSION = 1
const EPISODIC_STORAGE_RELATIVE_PATH = ["memory", "episodic.json"] as const

// ── Types ────────────────────────────────────────────────────────────────────

export type EpisodeOutcome = "success" | "failure" | "partial" | "abandoned"

export interface Episode {
  id: string
  /** User who triggered this episode */
  userId: string
  /** The task or query that initiated this episode */
  task: string
  /** The approach taken / strategy used */
  approach: string
  /** Tools used during this episode */
  toolsUsed: string[]
  /** Outcome of the episode */
  outcome: EpisodeOutcome
  /** The final output / result */
  result: string
  /** Verbal lesson learned from this episode */
  lesson: string
  /** Importance score (0–1), higher = more impactful/memorable */
  importance: number
  /** Number of times this episode has been recalled (access frequency) */
  accessCount: number
  /** Timestamp when the episode was created */
  createdAt: number
  /** Timestamp of last retrieval/access */
  lastAccessedAt: number
  /** Optional tags for categorical retrieval */
  tags: string[]
}

export interface EpisodeQuery {
  userId?: string
  query?: string
  outcome?: EpisodeOutcome
  tags?: string[]
  limit?: number
  /** Minimum importance score */
  minImportance?: number
}

export interface ScoredEpisode {
  episode: Episode
  /** Combined retrieval score (recency × importance × relevance) */
  retrievalScore: number
}

export interface EpisodicMemoryOptions {
  persist?: boolean
  stateDir?: string
  filePath?: string
}

interface EpisodicPersistencePayload {
  version: number
  episodes: Episode[]
}

// ── EpisodicMemory Class ────────────────────────────────────────────────────

export class EpisodicMemory {
  private episodes: Episode[] = []
  private readonly storagePath: string | null

  constructor(options: EpisodicMemoryOptions = {}) {
    const persistenceEnabled = resolvePersistenceEnabled(options.persist)
    this.storagePath = persistenceEnabled
      ? options.filePath ?? path.join(resolveStateDir(options.stateDir), ...EPISODIC_STORAGE_RELATIVE_PATH)
      : null

    this.loadFromDisk()
  }

  /**
   * Record a new episode.
   */
  record(input: {
    userId: string
    task: string
    approach: string
    toolsUsed?: string[]
    outcome: EpisodeOutcome
    result: string
    lesson: string
    importance?: number
    tags?: string[]
  }): Episode {
    const episode: Episode = {
      id: crypto.randomUUID(),
      userId: input.userId,
      task: input.task,
      approach: input.approach,
      toolsUsed: input.toolsUsed ?? [],
      outcome: input.outcome,
      result: input.result.slice(0, 2000),
      lesson: input.lesson.slice(0, 500),
      importance: clamp(input.importance ?? this.estimateImportance(input)),
      accessCount: 0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      tags: input.tags ?? [],
    }

    this.episodes.push(episode)

    // Evict low-importance old episodes if over limit
    if (this.episodes.length > MAX_EPISODES) {
      this.evict()
    }

    log.info("episode recorded", {
      id: episode.id,
      userId: episode.userId,
      outcome: episode.outcome,
      importance: episode.importance,
      task: episode.task.slice(0, 80),
    })

    this.persistToDisk()

    return episode
  }

  /**
   * Retrieve most relevant episodes for a query.
   * Uses a three-factor scoring model:
   *   score = recency_weight × importance × relevance
   *
   * Based on the Generative Agents retrieval mechanism.
   */
  retrieve(query: EpisodeQuery): ScoredEpisode[] {
    const limit = query.limit ?? MAX_RETRIEVAL
    const minImportance = query.minImportance ?? 0
    const now = Date.now()

    let candidates = [...this.episodes]

    // Filter by userId if specified
    if (query.userId) {
      candidates = candidates.filter((e) => e.userId === query.userId)
    }

    // Filter by outcome if specified
    if (query.outcome) {
      candidates = candidates.filter((e) => e.outcome === query.outcome)
    }

    // Filter by tags if specified
    if (query.tags && query.tags.length > 0) {
      const tagSet = new Set(query.tags.map((t) => t.toLowerCase()))
      candidates = candidates.filter((e) =>
        e.tags.some((t) => tagSet.has(t.toLowerCase())),
      )
    }

    // Filter by minimum importance
    candidates = candidates.filter((e) => e.importance >= minImportance)

    // Score each candidate
    const scored: ScoredEpisode[] = candidates.map((episode) => {
      const recencyWeight = computeRecency(episode.lastAccessedAt, now)
      const relevance = query.query
        ? computeTextRelevance(query.query, episode)
        : 0.5

      const retrievalScore = recencyWeight * episode.importance * relevance

      return { episode, retrievalScore }
    })

    // Sort by score descending
    scored.sort((a, b) => b.retrievalScore - a.retrievalScore)

    // Mark as accessed
    const results = scored.slice(0, limit)
    for (const { episode } of results) {
      episode.accessCount++
      episode.lastAccessedAt = now
    }

    if (results.length > 0) {
      this.persistToDisk()
    }

    return results
  }

  /**
   * Retrieve failure episodes for a similar task (for mistake avoidance).
   */
  getFailureLessons(userId: string, currentTask: string, limit = 3): string[] {
    const failures = this.retrieve({
      userId,
      query: currentTask,
      outcome: "failure",
      limit,
    })

    return failures.map(
      ({ episode }) =>
        `[Previous failure] Task: "${episode.task.slice(0, 100)}" → Lesson: ${episode.lesson}`,
    )
  }

  /**
   * Retrieve success patterns for a similar task (for strategy transfer).
   */
  getSuccessPatterns(userId: string, currentTask: string, limit = 3): string[] {
    const successes = this.retrieve({
      userId,
      query: currentTask,
      outcome: "success",
      limit,
    })

    return successes.map(
      ({ episode }) =>
        `[Past success] Task: "${episode.task.slice(0, 100)}" → Approach: ${episode.approach.slice(0, 200)}`,
    )
  }

  /**
   * Export episodes as context for LLM injection.
   */
  toContext(userId: string, currentTask: string, maxChars = 3000): string {
    const relevant = this.retrieve({ userId, query: currentTask, limit: 5 })

    if (relevant.length === 0) return ""

    const lines: string[] = ["[Episodic Memory — Relevant Past Experiences]"]
    let totalChars = lines[0].length

    for (const { episode, retrievalScore } of relevant) {
      const line = `- [${episode.outcome}] "${episode.task.slice(0, 80)}" → ${episode.lesson} (relevance: ${retrievalScore.toFixed(2)})`
      if (totalChars + line.length > maxChars) break
      lines.push(line)
      totalChars += line.length
    }

    return lines.join("\n")
  }

  /** Get total number of stored episodes */
  get size(): number {
    return this.episodes.length
  }

  /** Get all episodes (for debugging/persistence) */
  getAll(): readonly Episode[] {
    return this.episodes
  }

  /** Clear all episodes */
  clear(): void {
    this.episodes = []
    this.persistToDisk()
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Estimate importance based on heuristics.
   * Follows Generative Agents: unusual events, strong emotions, goal
   * pivots, and failures are scored higher.
   */
  private estimateImportance(input: {
    outcome: EpisodeOutcome
    task: string
    lesson: string
  }): number {
    let score = 0.5

    // Failures are more memorable (negativity bias)
    if (input.outcome === "failure") score += 0.2
    if (input.outcome === "success") score += 0.1
    if (input.outcome === "abandoned") score -= 0.1

    // Longer lessons suggest more complex learning
    if (input.lesson.length > 100) score += 0.1

    // Tasks with certain keywords suggest higher stakes
    const highStakePatterns = /\b(deploy|delete|security|password|production|critical|urgent)\b/i
    if (highStakePatterns.test(input.task)) score += 0.15

    return clamp(score)
  }

  /**
   * Evict lowest-scored episodes when over capacity.
   */
  private evict(): void {
    const now = Date.now()
    // Score all episodes
    const scored = this.episodes.map((e, index) => ({
      index,
      score: computeRecency(e.lastAccessedAt, now) * e.importance * (1 + Math.log1p(e.accessCount)),
    }))

    // Sort ascending (worst first)
    scored.sort((a, b) => a.score - b.score)

    // Remove bottom 10%
    const toRemove = Math.max(1, Math.floor(this.episodes.length * 0.1))
    const removeIndices = new Set(scored.slice(0, toRemove).map((s) => s.index))
    this.episodes = this.episodes.filter((_, i) => !removeIndices.has(i))

    log.debug("episodic memory eviction", { removed: toRemove, remaining: this.episodes.length })
  }

  private loadFromDisk(): void {
    if (!this.storagePath) {
      return
    }

    try {
      const payload = readJsonFile<EpisodicPersistencePayload>(this.storagePath)
      if (!payload || !Array.isArray(payload.episodes)) {
        return
      }

      const restored = payload.episodes
        .map((candidate) => coerceEpisode(candidate))
        .filter((episode): episode is Episode => episode !== null)

      if (restored.length === 0) {
        return
      }

      this.episodes = restored.slice(-MAX_EPISODES)
      log.info("episodic memory restored", {
        count: this.episodes.length,
        path: this.storagePath,
      })
    } catch (error) {
      log.warn("failed to restore episodic memory", {
        path: this.storagePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private persistToDisk(): void {
    if (!this.storagePath) {
      return
    }

    try {
      const payload: EpisodicPersistencePayload = {
        version: EPISODIC_PERSISTENCE_VERSION,
        episodes: this.episodes,
      }
      writeJsonAtomic(this.storagePath, payload)
    } catch (error) {
      log.warn("failed to persist episodic memory", {
        path: this.storagePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// ── Scoring Utilities ───────────────────────────────────────────────────────

/**
 * Exponential recency decay.
 * score = 0.5^(elapsed / half_life)
 */
function computeRecency(lastAccess: number, now: number): number {
  const elapsed = now - lastAccess
  return Math.pow(0.5, elapsed / RECENCY_HALF_LIFE_MS)
}

/**
 * Simple text relevance via token overlap (Jaccard-ish).
 * For production, this should be replaced with embedding similarity.
 */
function computeTextRelevance(query: string, episode: Episode): number {
  const queryTokens = new Set(tokenize(query))
  const episodeText = `${episode.task} ${episode.approach} ${episode.lesson} ${episode.tags.join(" ")}`
  const episodeTokens = new Set(tokenize(episodeText))

  if (queryTokens.size === 0) return 0.5

  let overlap = 0
  for (const token of queryTokens) {
    if (episodeTokens.has(token)) overlap++
  }

  const jaccard = overlap / (queryTokens.size + episodeTokens.size - overlap)
  // Scale to 0.1–1.0 range (never zero to give all episodes a chance)
  return 0.1 + 0.9 * jaccard
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

function asEpisodeOutcome(value: unknown): EpisodeOutcome | null {
  if (value === "success" || value === "failure" || value === "partial" || value === "abandoned") {
    return value
  }

  return null
}

function coerceEpisode(value: unknown): Episode | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const outcome = asEpisodeOutcome(record.outcome)
  if (!outcome) {
    return null
  }

  const task = asString(record.task)
  const approach = asString(record.approach)
  const result = asString(record.result)
  const lesson = asString(record.lesson)
  const userId = asString(record.userId)

  if (!task || !approach || !result || !lesson || !userId) {
    return null
  }

  const createdAt = asNumber(record.createdAt) ?? Date.now()
  const lastAccessedAt = asNumber(record.lastAccessedAt) ?? createdAt

  return {
    id: asString(record.id) ?? crypto.randomUUID(),
    userId,
    task: task.slice(0, 2000),
    approach: approach.slice(0, 2000),
    toolsUsed: asStringArray(record.toolsUsed),
    outcome,
    result: result.slice(0, 2000),
    lesson: lesson.slice(0, 500),
    importance: clamp(asNumber(record.importance) ?? 0.5),
    accessCount: Math.max(0, Math.floor(asNumber(record.accessCount) ?? 0)),
    createdAt,
    lastAccessedAt,
    tags: asStringArray(record.tags),
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

export const episodicMemory = new EpisodicMemory()

// ── Test Utilities ──────────────────────────────────────────────────────────

export const __episodicTestUtils = {
  computeRecency,
  computeTextRelevance,
  tokenize,
  MAX_EPISODES,
  MIN_IMPORTANCE,
  RECENCY_HALF_LIFE_MS,
}
