/**
 * @file session-summarizer.ts
 * @description SessionSummarizer — compresses long conversation histories into a concise summary
 *              message when the session exceeds a configurable threshold, keeping context windows lean.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Reads session history via a StoreAdapter that is registered by session-store.ts at startup.
 *     This breaks the circular import: session-store → (static) → session-summarizer,
 *     while session-summarizer has zero imports from sessions/.
 *   - Calls LLM orchestrator (engines/orchestrator.ts) with TaskType 'fast' to produce the summary.
 *   - Saves the compressed summary back to the database via saveMessage (database/index.ts).
 *   - Invoked from message-pipeline.ts and session-store.ts after each addMessage().
 *   - Singleton exported as `sessionSummarizer`.
 */

import { saveMessage } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.session-summarizer")

const TRIGGER_COUNT = 30
const COMPRESS_COUNT = 20

/** Shape of a session message consumed by this module. */
interface SessionMessage {
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

/**
 * Minimal interface that SessionSummarizer needs from the session store.
 * session-store.ts registers its concrete instance via setStoreAdapter().
 */
export interface StoreAdapter {
  getSessionHistory(userId: string, channel: string, limit: number): Promise<SessionMessage[]>
  replaceSessionHistory(userId: string, channel: string, messages: SessionMessage[]): void
}

let _storeAdapter: StoreAdapter | null = null

/**
 * Register the session store implementation.
 * Called by session-store.ts immediately after creating the sessionStore singleton —
 * no circular import is needed because no import of session-store.ts appears in this file.
 */
export function setStoreAdapter(store: StoreAdapter): void {
  _storeAdapter = store
}

function formatHistory(messages: SessionMessage[]): string {
  return messages
    .map((message) => `${message.role}: ${message.content.slice(0, 240)}`)
    .join("\n")
}

export class SessionSummarizer {
  async maybeCompress(userId: string, channel: string): Promise<void> {
    try {
      const store = _storeAdapter
      if (!store) {
        return
      }
      const history = await store.getSessionHistory(userId, channel, 500)
      if (history.length < TRIGGER_COUNT) {
        return
      }

      await this.compress(userId, channel, 10)
    } catch (error) {
      log.error("maybeCompress failed", { userId, channel, error })
    }
  }

  async compress(userId: string, channel: string, keepLast: number): Promise<string> {
    try {
      const store = _storeAdapter
      if (!store) {
        return ""
      }
      const history = await store.getSessionHistory(userId, channel, 500)
      if (history.length <= keepLast + 1) {
        return ""
      }

      const compressCount = Math.min(COMPRESS_COUNT, Math.max(0, history.length - keepLast))
      if (compressCount <= 0) {
        return ""
      }

      const oldest = history.slice(0, compressCount)
      const summary = await this.generateSummary(oldest)

      const metadata = {
        compressed: true,
        source: "session-summarizer",
        compressedCount: compressCount,
      }

      await saveMessage(userId, "system", summary, channel, metadata)

      const compressedMessage: SessionMessage = {
        role: "system",
        content: summary,
        timestamp: Date.now(),
      }

      const remaining = history.slice(compressCount)
      store.replaceSessionHistory(userId, channel, [compressedMessage, ...remaining])

      log.info("Session compressed", {
        userId,
        channel,
        compressed: compressCount,
        remaining: remaining.length,
      })

      return summary
    } catch (error) {
      log.error("compress failed", { userId, channel, error })
      return ""
    }
  }

  private async generateSummary(messages: SessionMessage[]): Promise<string> {
    const formatted = formatHistory(messages)

    try {
      const prompt = [
        "Summarize this session segment in concise bullets.",
        "Keep key decisions, user constraints, and open tasks.",
        "Return plain text only (max 6 bullets).",
        formatted,
      ].join("\n\n")

      const response = await orchestrator.generate("fast", { prompt })
      const summary = response.trim()
      if (summary.length > 0) {
        return summary.slice(0, 2000)
      }
    } catch (error) {
      log.warn("generateSummary failed, using fallback", error)
    }

    return `Compressed session summary:\n${messages
      .slice(0, 6)
      .map((message) => `- ${message.role}: ${message.content.slice(0, 180)}`)
      .join("\n")}`
  }
}

export const sessionSummarizer = new SessionSummarizer()

