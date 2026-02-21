import { getHistory } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.context-predictor")

const DAY_MS = 24 * 60 * 60 * 1000
const URGENCY_TERMS = ["urgent", "asap", "deadline", "immediately", "today", "now", "critical", "help"]
const STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "will",
  "been",
  "they",
  "their",
  "what",
  "when",
  "where",
  "which",
  "would",
  "there",
  "about",
  "should",
  "could",
])

export interface MultiDimContext {
  conversationRecency: number
  conversationFrequency: number
  channelActivity: number
  typicalActiveHour: boolean
  recentTopics: string[]
  urgencySignals: string[]
}

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

export class ContextPredictor {
  async predict(userId: string, channel: string): Promise<MultiDimContext> {
    try {
      const history = await getHistory(userId, 300)
      if (history.length === 0) {
        return {
          conversationRecency: 24,
          conversationFrequency: 0,
          channelActivity: 0,
          typicalActiveHour: false,
          recentTopics: [],
          urgencySignals: [],
        }
      }

      const latest = history[0]
      const now = Date.now()
      const recencyHours = (now - latest.createdAt.getTime()) / (60 * 60 * 1000)

      const sevenDaysAgo = new Date(now - 7 * DAY_MS)
      const recentSevenDays = history.filter((item) => item.createdAt >= sevenDaysAgo)
      const uniqueDays = new Set(recentSevenDays.map((item) => item.createdAt.toISOString().slice(0, 10))).size
      const frequency = uniqueDays > 0 ? recentSevenDays.length / uniqueDays : 0

      const channelMessages = recentSevenDays.filter((item) => (item.channel ?? "") === channel)
      const channelActivity = recentSevenDays.length > 0
        ? clamp(channelMessages.length / recentSevenDays.length)
        : 0

      const hourCounts = new Array(24).fill(0)
      for (const item of history.slice(0, 150)) {
        hourCounts[item.createdAt.getHours()] += 1
      }
      const topHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((entry) => entry.hour)

      const typicalActiveHour = topHours.includes(new Date(now).getHours())

      const topics = this.extractTopics(history.slice(0, 40).map((item) => item.content).join(" "))
      const urgencySignals = this.extractUrgencySignals(history.slice(0, 80).map((item) => item.content).join(" "))

      return {
        conversationRecency: Math.max(0, recencyHours),
        conversationFrequency: Math.max(0, frequency),
        channelActivity,
        typicalActiveHour,
        recentTopics: topics,
        urgencySignals,
      }
    } catch (error) {
      log.error("predict failed", { userId, channel, error })
      return {
        conversationRecency: 24,
        conversationFrequency: 0,
        channelActivity: 0,
        typicalActiveHour: false,
        recentTopics: [],
        urgencySignals: [],
      }
    }
  }

  private extractTopics(text: string): string[] {
    const counts = new Map<string, number>()

    for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length < 4 || STOPWORDS.has(token)) {
        continue
      }
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word)
  }

  private extractUrgencySignals(text: string): string[] {
    const lowered = text.toLowerCase()
    return URGENCY_TERMS.filter((term) => lowered.includes(term)).slice(0, 6)
  }
}

export const contextPredictor = new ContextPredictor()
