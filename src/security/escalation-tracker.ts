/**
 * @file escalation-tracker.ts
 * @description Multi-turn escalation detector for prompt injection attacks.
 * Maintains a rolling risk score per conversation window, so that injection
 * attempts split across multiple turns (each individually innocuous) are caught.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Consumed by Stage 1 of `src/core/message-pipeline.ts`
 *   - Risk score decays over time (exponential decay)
 *   - Emits a warning log and returns `blocked: true` when score exceeds threshold
 *   - Conversation state is keyed on userId; evicted after TTL
 */

import { createLogger } from "../logger.js"

const log = createLogger("security.escalation-tracker")

/** Signals that contribute to escalation risk */
export type EscalationSignal =
  | "injection_blocked"      // promptFilter blocked a message
  | "injection_sanitized"    // promptFilter sanitized (partial match)
  | "repeated_denied_tool"   // same tool denied multiple times
  | "rapid_fire_messages"    // user sent many messages very quickly
  | "sensitivity_probe"      // asked about system prompt / internals

/** Per-conversation tracking state */
interface ConversationRisk {
  /** Current risk score (0–1 float) */
  score: number
  /** Last update timestamp (ms) */
  lastUpdate: number
  /** Count of signals in current window */
  signalCount: number
  /** Whether this conversation is currently blocked */
  blocked: boolean
}

export interface EscalationResult {
  /** Whether to block the current message */
  blocked: boolean
  /** Current risk score (0–1) */
  score: number
  /** Human-readable reason if blocked */
  reason?: string
}

const SIGNAL_WEIGHTS: Record<EscalationSignal, number> = {
  injection_blocked:    0.40,
  injection_sanitized:  0.15,
  repeated_denied_tool: 0.20,
  rapid_fire_messages:  0.10,
  sensitivity_probe:    0.15,
}

const BLOCK_THRESHOLD = 0.75
const DECAY_HALF_LIFE_MS = 10 * 60_000   // score halves every 10 minutes
const UNBLOCK_THRESHOLD = 0.30           // below this score, conversation is unblocked
const CONV_TTL_MS = 30 * 60_000          // evict after 30 minutes of inactivity
const EVICTION_CHECK_INTERVAL_MS = 5 * 60_000

/**
 * Multi-turn escalation tracker.
 * One shared instance; keyed per userId.
 */
export class EscalationTracker {
  private readonly conversations = new Map<string, ConversationRisk>()
  private evictionTimer: ReturnType<typeof setInterval> | null = null

  /** Start background eviction of stale conversation records. */
  startEviction(): void {
    if (this.evictionTimer) return
    this.evictionTimer = setInterval(() => this.evictStale(), EVICTION_CHECK_INTERVAL_MS)
    if (typeof this.evictionTimer === "object" && "unref" in this.evictionTimer) {
      (this.evictionTimer as { unref(): void }).unref()
    }
  }

  /** Stop the eviction timer. */
  stopEviction(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
    }
  }

  /**
   * Record an escalation signal for a conversation.
   * Updates the risk score and returns whether the conversation should be blocked.
   *
   * @param userId - User/conversation identifier
   * @param signal - Type of escalation signal observed
   */
  record(userId: string, signal: EscalationSignal): EscalationResult {
    const now = Date.now()
    const state = this.getOrCreate(userId, now)

    // Decay existing score
    const elapsed = now - state.lastUpdate
    const decayFactor = Math.pow(0.5, elapsed / DECAY_HALF_LIFE_MS)
    state.score = state.score * decayFactor

    // Add signal weight
    const weight = SIGNAL_WEIGHTS[signal]
    state.score = Math.min(1, state.score + weight)
    state.signalCount += 1
    state.lastUpdate = now

    // Update blocked status
    if (state.score >= BLOCK_THRESHOLD && !state.blocked) {
      state.blocked = true
      log.warn("conversation escalation threshold reached — blocking", {
        userId,
        score: state.score.toFixed(3),
        signalCount: state.signalCount,
      })
    } else if (state.score < UNBLOCK_THRESHOLD && state.blocked) {
      state.blocked = false
      log.info("conversation escalation score decayed — unblocking", {
        userId,
        score: state.score.toFixed(3),
      })
    }

    return {
      blocked: state.blocked,
      score: state.score,
      reason: state.blocked ? `Escalation score ${state.score.toFixed(2)} exceeds threshold` : undefined,
    }
  }

  /**
   * Check current escalation status WITHOUT recording a new signal.
   *
   * @param userId - User/conversation identifier
   */
  check(userId: string): EscalationResult {
    const now = Date.now()
    const state = this.conversations.get(userId)
    if (!state) return { blocked: false, score: 0 }

    // Apply decay for check-only call
    const elapsed = now - state.lastUpdate
    const decayFactor = Math.pow(0.5, elapsed / DECAY_HALF_LIFE_MS)
    const currentScore = state.score * decayFactor

    // Auto-unblock if score has decayed below threshold
    if (currentScore < UNBLOCK_THRESHOLD && state.blocked) {
      state.blocked = false
      state.score = currentScore
      state.lastUpdate = now
    }

    return { blocked: state.blocked, score: currentScore }
  }

  /**
   * Manually reset a conversation (e.g. after admin review).
   *
   * @param userId - User/conversation identifier
   */
  reset(userId: string): void {
    this.conversations.delete(userId)
    log.info("escalation state reset", { userId })
  }

  private getOrCreate(userId: string, now: number): ConversationRisk {
    let state = this.conversations.get(userId)
    if (!state) {
      state = { score: 0, lastUpdate: now, signalCount: 0, blocked: false }
      this.conversations.set(userId, state)
    }
    return state
  }

  private evictStale(): void {
    const cutoff = Date.now() - CONV_TTL_MS
    let evicted = 0
    for (const [userId, state] of this.conversations) {
      if (state.lastUpdate < cutoff) {
        this.conversations.delete(userId)
        evicted++
      }
    }
    if (evicted > 0) {
      log.debug("evicted stale escalation records", { evicted, remaining: this.conversations.size })
    }
  }
}

/** Singleton escalation tracker instance. */
export const escalationTracker = new EscalationTracker()
escalationTracker.startEviction()
