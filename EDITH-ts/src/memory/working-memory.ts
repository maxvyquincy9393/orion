/**
 * working-memory.ts — Agent Working Memory / Scratchpad
 *
 * Implementation based on:
 *   Sumers et al., "Cognitive Architectures for Language Agents" (CoALA)
 *   (arXiv:2309.02427, 2023)
 *
 * Also draws from:
 *   Park et al., "Generative Agents: Interactive Simulacra of Human Behavior"
 *   (UIST 2023, arXiv:2304.03442) — for the reflection and importance scoring
 *
 * In CoALA, an agent's memory is split into:
 *   - Working Memory: short-lived scratchpad for current task reasoning
 *   - Episodic Memory: structured episodes with outcomes (see episodic.ts)
 *   - Semantic Memory: long-term factual knowledge (already exists: profiler, store)
 *   - Procedural Memory: learned action patterns (already exists: MemRL, skills)
 *
 * This module implements the Working Memory component — a structured scratchpad
 * that persists across tool calls within a single agent execution. The agent can
 * write intermediate thoughts, observations, hypotheses, and partial results
 * that help it reason across multiple steps.
 *
 * @module memory/working-memory
 */

import path from "node:path"

import { createLogger } from "../logger.js"
import {
  readJsonFile,
  resolvePersistenceEnabled,
  resolveStateDir,
  safeFileToken,
  writeJsonAtomic,
} from "./persistence.js"

const log = createLogger("memory.working-memory")

// ── Configuration ────────────────────────────────────────────────────────────

/** Maximum entries in working memory before oldest get evicted */
const MAX_ENTRIES = 50

/** Maximum characters per entry */
const MAX_ENTRY_CHARS = 1000

/** Maximum total chars for context export (avoid exceeding context window) */
const MAX_CONTEXT_CHARS = 8000
const WORKING_MEMORY_PERSISTENCE_VERSION = 1
const WORKING_MEMORY_STORAGE_RELATIVE_DIR = ["memory", "working"] as const

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkingMemoryEntryType =
  | "thought"         // Internal reasoning step
  | "observation"     // Result from a tool call or external input
  | "hypothesis"      // Tentative conclusion to test
  | "plan"            // Current plan or strategy
  | "critique"        // Self-criticism of current approach
  | "fact"            // Verified factual information
  | "partial_result"  // Intermediate computation result

export interface WorkingMemoryEntry {
  id: number
  type: WorkingMemoryEntryType
  content: string
  timestamp: number
  /** Optional relevance score (0–1) for prioritized retrieval */
  relevance: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

export interface WorkingMemoryOptions {
  persist?: boolean
  stateDir?: string
  filePath?: string
}

interface WorkingMemorySnapshot {
  version: number
  taskId: string
  goal: string
  plan: string
  confidence: number
  entries: WorkingMemoryEntry[]
}

// ── WorkingMemory Class ─────────────────────────────────────────────────────

export class WorkingMemory {
  private entries: WorkingMemoryEntry[] = []
  private nextId = 1
  private readonly taskId: string
  private readonly storagePath: string | null

  /** Current high-level goal (mutable as agent refines understanding) */
  currentGoal = ""

  /** Current plan (mutable) */
  currentPlan = ""

  /** Confidence level (0–1) in current approach */
  confidence = 0.5

  constructor(taskId: string, goal?: string, options: WorkingMemoryOptions = {}) {
    this.taskId = taskId
    const persistenceEnabled = resolvePersistenceEnabled(options.persist)
    this.storagePath = persistenceEnabled
      ? options.filePath
        ?? path.join(resolveStateDir(options.stateDir), ...WORKING_MEMORY_STORAGE_RELATIVE_DIR, `${safeFileToken(taskId)}.json`)
      : null

    this.loadFromDisk()

    if (typeof goal === "string" && goal.trim().length > 0) {
      this.currentGoal = goal
      this.persistToDisk()
    }
  }

  /**
   * Add an entry to working memory.
   */
  add(type: WorkingMemoryEntryType, content: string, relevance = 0.5, metadata?: Record<string, unknown>): WorkingMemoryEntry {
    const entry: WorkingMemoryEntry = {
      id: this.nextId++,
      type,
      content: content.slice(0, MAX_ENTRY_CHARS),
      timestamp: Date.now(),
      relevance: clamp(relevance),
      metadata,
    }

    this.entries.push(entry)

    // Evict oldest if over limit
    if (this.entries.length > MAX_ENTRIES) {
      const evicted = this.entries.shift()!
      log.debug("working memory eviction", { taskId: this.taskId, evictedId: evicted.id })
    }

    this.persistToDisk()

    return entry
  }

  /**
   * Record a thought (internal reasoning step).
   */
  think(thought: string, relevance = 0.6): WorkingMemoryEntry {
    return this.add("thought", thought, relevance)
  }

  /**
   * Record an observation from tool output or environment.
   */
  observe(observation: string, relevance = 0.7): WorkingMemoryEntry {
    return this.add("observation", observation, relevance)
  }

  /**
   * Record a hypothesis to test.
   */
  hypothesize(hypothesis: string, relevance = 0.6): WorkingMemoryEntry {
    return this.add("hypothesis", hypothesis, relevance)
  }

  /**
   * Update the current plan.
   */
  plan(planText: string): WorkingMemoryEntry {
    this.currentPlan = planText
    return this.add("plan", planText, 0.8)
  }

  /**
   * Record self-critique.
   */
  critique(text: string, relevance = 0.7): WorkingMemoryEntry {
    return this.add("critique", text, relevance)
  }

  /**
   * Store a verified fact.
   */
  storeFact(fact: string, relevance = 0.8): WorkingMemoryEntry {
    return this.add("fact", fact, relevance)
  }

  /**
   * Store intermediate computation result.
   */
  storePartial(result: string, relevance = 0.7): WorkingMemoryEntry {
    return this.add("partial_result", result, relevance)
  }

  /**
   * Update confidence level.
   */
  setConfidence(value: number): void {
    this.confidence = clamp(value)
    this.persistToDisk()
  }

  /**
   * Get all entries of a specific type.
   */
  getByType(type: WorkingMemoryEntryType): WorkingMemoryEntry[] {
    return this.entries.filter((e) => e.type === type)
  }

  /**
   * Get the N most relevant entries, sorted by relevance descending.
   */
  getTopRelevant(n: number): WorkingMemoryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, n)
  }

  /**
   * Get the most recent entries.
   */
  getRecent(n: number): WorkingMemoryEntry[] {
    return this.entries.slice(-n)
  }

  /**
   * Search entries by content substring (case-insensitive).
   */
  search(query: string): WorkingMemoryEntry[] {
    const lower = query.toLowerCase()
    return this.entries.filter((e) => e.content.toLowerCase().includes(lower))
  }

  /**
   * Export working memory as structured text for LLM context injection.
   * This is the primary integration point — inject this into the system prompt.
   */
  toContext(): string {
    if (this.entries.length === 0) return ""

    const sections: string[] = []

    // Header
    sections.push("[Working Memory — Scratchpad]")

    if (this.currentGoal) {
      sections.push(`Goal: ${this.currentGoal}`)
    }
    if (this.currentPlan) {
      sections.push(`Current Plan: ${this.currentPlan}`)
    }
    sections.push(`Confidence: ${(this.confidence * 100).toFixed(0)}%`)

    // Group by type for structured presentation
    const typeOrder: WorkingMemoryEntryType[] = [
      "plan", "fact", "observation", "thought", "hypothesis", "critique", "partial_result",
    ]

    let totalChars = sections.join("\n").length

    for (const type of typeOrder) {
      const entries = this.getByType(type)
      if (entries.length === 0) continue

      const label = TYPE_LABELS[type]
      const block = entries
        .slice(-5) // Keep most recent 5 per type
        .map((e) => `  - ${e.content}`)
        .join("\n")

      const section = `\n${label}:\n${block}`
      if (totalChars + section.length > MAX_CONTEXT_CHARS) break
      sections.push(section)
      totalChars += section.length
    }

    return sections.join("\n")
  }

  /**
   * Clear all entries (task complete or abandoned).
   */
  clear(): void {
    this.entries = []
    this.currentGoal = ""
    this.currentPlan = ""
    this.confidence = 0.5
    this.nextId = 1
    this.persistToDisk()
  }

  /**
   * Snapshot for persistence/debugging.
   */
  snapshot(): {
    taskId: string
    goal: string
    plan: string
    confidence: number
    entries: WorkingMemoryEntry[]
  } {
    return {
      taskId: this.taskId,
      goal: this.currentGoal,
      plan: this.currentPlan,
      confidence: this.confidence,
      entries: [...this.entries],
    }
  }

  private loadFromDisk(): void {
    if (!this.storagePath) {
      return
    }

    try {
      const snapshot = readJsonFile<WorkingMemorySnapshot>(this.storagePath)
      if (!snapshot || snapshot.taskId !== this.taskId || !Array.isArray(snapshot.entries)) {
        return
      }

      const entries = snapshot.entries
        .map((entry) => coerceWorkingEntry(entry))
        .filter((entry): entry is WorkingMemoryEntry => entry !== null)
        .slice(-MAX_ENTRIES)

      this.entries = entries
      this.currentGoal = typeof snapshot.goal === "string" ? snapshot.goal : ""
      this.currentPlan = typeof snapshot.plan === "string" ? snapshot.plan : ""
      this.confidence = clamp(typeof snapshot.confidence === "number" ? snapshot.confidence : 0.5)
      const maxId = entries.reduce((highest, entry) => Math.max(highest, entry.id), 0)
      this.nextId = maxId + 1
    } catch (error) {
      log.warn("failed to restore working memory", {
        taskId: this.taskId,
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
      const payload: WorkingMemorySnapshot = {
        version: WORKING_MEMORY_PERSISTENCE_VERSION,
        taskId: this.taskId,
        goal: this.currentGoal,
        plan: this.currentPlan,
        confidence: this.confidence,
        entries: this.entries,
      }

      writeJsonAtomic(this.storagePath, payload)
    } catch (error) {
      log.warn("failed to persist working memory", {
        taskId: this.taskId,
        path: this.storagePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  get size(): number {
    return this.entries.length
  }
}

// ── Type Labels ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<WorkingMemoryEntryType, string> = {
  thought: "Thoughts",
  observation: "Observations",
  hypothesis: "Hypotheses",
  plan: "Plans",
  critique: "Self-Critique",
  fact: "Verified Facts",
  partial_result: "Partial Results",
}

// ── Utilities ───────────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function asWorkingMemoryType(value: unknown): WorkingMemoryEntryType | null {
  if (
    value === "thought"
    || value === "observation"
    || value === "hypothesis"
    || value === "plan"
    || value === "critique"
    || value === "fact"
    || value === "partial_result"
  ) {
    return value
  }

  return null
}

function coerceWorkingEntry(value: unknown): WorkingMemoryEntry | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const type = asWorkingMemoryType(record.type)
  if (!type) {
    return null
  }

  const content = typeof record.content === "string" ? record.content : null
  const id = typeof record.id === "number" && Number.isFinite(record.id)
    ? Math.max(1, Math.floor(record.id))
    : null

  if (!content || id === null) {
    return null
  }

  const relevance = typeof record.relevance === "number" ? clamp(record.relevance) : 0.5
  const timestamp = typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
    ? record.timestamp
    : Date.now()
  const metadata = asRecord(record.metadata) ?? undefined

  return {
    id,
    type,
    content: content.slice(0, MAX_ENTRY_CHARS),
    timestamp,
    relevance,
    metadata,
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const __workingMemoryTestUtils = {
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  MAX_CONTEXT_CHARS,
}
