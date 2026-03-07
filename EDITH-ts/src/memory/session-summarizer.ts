import { saveMessage } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { sessionStore, type Message as SessionMessage } from "../sessions/session-store.js"

const log = createLogger("memory.session-summarizer")

const TRIGGER_COUNT = 30
const COMPRESS_COUNT = 20

function formatHistory(messages: SessionMessage[]): string {
  return messages
    .map((message) => `${message.role}: ${message.content.slice(0, 240)}`)
    .join("\n")
}

export class SessionSummarizer {
  async maybeCompress(userId: string, channel: string): Promise<void> {
    try {
      const history = await sessionStore.getSessionHistory(userId, channel, 500)
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
      const history = await sessionStore.getSessionHistory(userId, channel, 500)
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
      sessionStore.replaceSessionHistory(userId, channel, [compressedMessage, ...remaining])

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
