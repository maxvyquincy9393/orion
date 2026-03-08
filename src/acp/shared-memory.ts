/**
 * @file shared-memory.ts
 * @description SharedTaskMemory — ephemeral per-session shared context for multi-agent tasks.
 *
 * ARCHITECTURE:
 *   Per-task session memory with two visibility tiers:
 *     - 'shared': readable by ALL agents in the session (findings, decisions, artifacts)
 *     - 'private': readable only by the writing agent (intermediate drafts, scratchpad)
 *
 *   This is SEPARATE from WorkingMemory (src/memory/working-memory.ts) which is per-user.
 *   SharedTaskMemory is per-task-session and is cleared after the supervisor finishes.
 *
 *   Used by:
 *     - AgentRegistry (Atom 1) — writes each node result to memory
 *     - AgentRunner.runWithSupervisor() (Atom 5) — injects shared context into synthesis
 *     - ExecutionMonitor — replaces raw completedResults Map with structured memory
 *
 * PAPER BASIS:
 *   - Collaborative Memory (arXiv:2505.18279): 2-tier memory (private + shared),
 *     provenance attributes (agent ID + timestamp + resource accessed)
 *   - Multi-Agent Collaboration Survey (arXiv:2501.06322): star topology needs
 *     central shared context for orchestrator synthesis
 *
 * @module acp/shared-memory
 */

import type { AgentType } from "../agents/task-planner.js"
import { createLogger } from "../logger.js"

const log = createLogger("acp.shared-memory")

/** Maximum characters stored in shared memory before oldest entries are pruned. */
const MAX_TOTAL_CHARS = 40_000

/** Maximum number of entries per session. */
const MAX_ENTRIES = 100

/**
 * A single memory entry written by one agent for a given task node.
 * Stores provenance (who wrote it, when, for which node).
 */
export interface SharedMemoryEntry {
  /** The agent type that wrote this entry. */
  agentType: AgentType
  /** The task node ID that produced this entry. */
  nodeId: string
  /** The textual content of the entry. */
  content: string
  /** Category of the entry. */
  category: "finding" | "artifact" | "decision" | "error"
  /**
   * 'shared': readable by all agents in session.
   * 'private': only readable by the writing agentType.
   */
  visibility: "shared" | "private"
  /** Unix timestamp (ms) when written. */
  timestamp: number
}

/** Summary statistics for a session. */
export interface MemoryStats {
  total: number
  shared: number
  private: number
  byCategory: Record<SharedMemoryEntry["category"], number>
  totalChars: number
}

/** Active session registry (in-memory, cleared on process exit). */
const sessions = new Map<string, SharedTaskMemory>()

/**
 * SharedTaskMemory — per-session two-tier memory store.
 *
 * Usage:
 *   const memory = getOrCreateSession(sessionId)
 *   memory.write({ agentType: 'researcher', nodeId, content, category: 'finding', visibility: 'shared' })
 *   const ctx = memory.buildContextFor('analyst', 3000)
 *   clearSession(sessionId)  // after supervisor finishes
 */
export class SharedTaskMemory {
  private entries: SharedMemoryEntry[] = []

  constructor(readonly sessionId: string) {}

  /**
   * Write a memory entry.
   * Prunes oldest entries if the session exceeds limits.
   */
  write(entry: Omit<SharedMemoryEntry, "timestamp">): void {
    this.entries.push({ ...entry, timestamp: Date.now() })

    // Enforce size limits
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES)
    }

    const totalChars = this.entries.reduce((sum, e) => sum + e.content.length, 0)
    if (totalChars > MAX_TOTAL_CHARS) {
      // Prune oldest shared entries first, keep private entries
      const sorted = [...this.entries].sort((a, b) => a.timestamp - b.timestamp)
      let pruned = 0
      for (const entry of sorted) {
        if (entry.visibility === "shared" && totalChars - pruned > MAX_TOTAL_CHARS) {
          this.entries.splice(this.entries.indexOf(entry), 1)
          pruned += entry.content.length
        }
      }
    }

    log.debug("memory entry written", {
      sessionId: this.sessionId,
      agentType: entry.agentType,
      category: entry.category,
      visibility: entry.visibility,
      contentLength: entry.content.length,
    })
  }

  /**
   * Read entries visible to a specific agent type.
   * Returns: all 'shared' entries + 'private' entries belonging to this agentType.
   */
  readFor(agentType: AgentType): SharedMemoryEntry[] {
    return this.entries.filter(
      (e) => e.visibility === "shared" || e.agentType === agentType,
    )
  }

  /**
   * Read all shared entries (for orchestrator synthesis).
   * Does NOT return private entries.
   */
  readShared(): SharedMemoryEntry[] {
    return this.entries.filter((e) => e.visibility === "shared")
  }

  /**
   * Read all entries (for supervisor-level synthesis — full context).
   */
  readAll(): SharedMemoryEntry[] {
    return [...this.entries]
  }

  /**
   * Build a formatted context string for injection into an agent's prompt.
   * Truncates at maxChars to stay within LLM context window budgets.
   *
   * @param agentType - Which agent is reading (determines visibility)
   * @param maxChars  - Maximum character budget (default: 4000)
   */
  buildContextFor(agentType: AgentType, maxChars = 4_000): string {
    const visible = this.readFor(agentType)
    if (visible.length === 0) {
      return ""
    }

    const lines: string[] = ["[Shared Task Context]"]
    let chars = lines[0]!.length

    // Most recent entries first
    for (const entry of [...visible].reverse()) {
      const label = `[${entry.agentType}/${entry.category}] ${entry.content}`
      if (chars + label.length + 1 > maxChars) {
        break
      }
      lines.push(label)
      chars += label.length + 1
    }

    return lines.join("\n")
  }

  /**
   * Build synthesis context (all shared entries formatted for final LLM call).
   */
  buildSynthesisContext(maxChars = 8_000): string {
    const shared = this.readShared()
    if (shared.length === 0) {
      return ""
    }

    const grouped: Partial<Record<SharedMemoryEntry["category"], string[]>> = {}
    for (const entry of shared) {
      if (!grouped[entry.category]) {
        grouped[entry.category] = []
      }
      grouped[entry.category]!.push(`[${entry.agentType}] ${entry.content}`)
    }

    const sections: string[] = ["[Multi-Agent Findings]"]
    let chars = sections[0]!.length

    for (const [category, items] of Object.entries(grouped)) {
      const header = `\n## ${category.toUpperCase()}`
      sections.push(header)
      chars += header.length

      for (const item of items ?? []) {
        if (chars + item.length > maxChars) {
          break
        }
        sections.push(item)
        chars += item.length
      }
    }

    return sections.join("\n")
  }

  /** Clear all entries in this session. */
  clear(): void {
    const count = this.entries.length
    this.entries = []
    log.debug("session cleared", { sessionId: this.sessionId, entriesCleared: count })
  }

  /** Return summary statistics. */
  stats(): MemoryStats {
    return {
      total: this.entries.length,
      shared: this.entries.filter((e) => e.visibility === "shared").length,
      private: this.entries.filter((e) => e.visibility === "private").length,
      byCategory: {
        finding: this.entries.filter((e) => e.category === "finding").length,
        artifact: this.entries.filter((e) => e.category === "artifact").length,
        decision: this.entries.filter((e) => e.category === "decision").length,
        error: this.entries.filter((e) => e.category === "error").length,
      },
      totalChars: this.entries.reduce((sum, e) => sum + e.content.length, 0),
    }
  }
}

/**
 * Get an existing session or create a new one.
 * Sessions are keyed by sessionId (typically `supervisor-${Date.now()}`).
 */
export function getOrCreateSession(sessionId: string): SharedTaskMemory {
  let session = sessions.get(sessionId)
  if (!session) {
    session = new SharedTaskMemory(sessionId)
    sessions.set(sessionId, session)
    log.debug("session created", { sessionId })
  }
  return session
}

/**
 * Clear and remove a session from the registry.
 * Call this after the supervisor task completes.
 */
export function clearSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    session.clear()
    sessions.delete(sessionId)
    log.debug("session removed", { sessionId })
  }
}

/** Returns the number of active sessions (for monitoring). */
export function getActiveSessionCount(): number {
  return sessions.size
}
