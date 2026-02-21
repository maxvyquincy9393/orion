import * as fs from "fs"
import * as path from "path"
import { orchestrator } from "../engines/orchestrator"
import config from "../config"

interface HistoryMessage {
  role: string
  content: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

interface AnalyzeResult {
  peakHours: number[]
  commonTopics: { word: string; count: number }[]
  recurringTasks: string[]
  avgResponseTimeSeconds: number
  totalMessages: number
}

interface ProactiveSuggestion {
  triggerType: string
  suggestedTime: string
  messageTemplate: string
  confidence: number
  reason: string
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "under",
  "and", "but", "if", "or", "because", "until", "while", "this", "that",
  "these", "those", "i", "me", "my", "myself", "we", "our", "ours",
  "you", "your", "yours", "he", "him", "his", "she", "her", "hers",
  "it", "its", "they", "them", "their", "what", "which", "who", "whom",
])

export class PatternIntelligence {
  private userId: string

  constructor(userId = config.DEFAULT_USER_ID) {
    this.userId = userId
  }

  async analyzeHistory(userId: string, days = 14): Promise<AnalyzeResult> {
    const messages = await this.fetchHistory(userId)
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

    const filtered = messages.filter((m) => {
      if (!m.timestamp) return true
      const ts = new Date(m.timestamp).getTime()
      return ts >= cutoff
    })

    const hourCounts: Record<number, number> = {}
    const wordCounts: Record<string, number> = {}
    let totalResponseTime = 0
    let responseCount = 0

    for (const msg of filtered) {
      if (msg.timestamp) {
        const hour = new Date(msg.timestamp).getHours()
        hourCounts[hour] = (hourCounts[hour] || 0) + 1
      }

      if (msg.role === "user") {
        const words = msg.content.toLowerCase().match(/\b[a-z]{3,}\b/g) || []
        for (const word of words) {
          if (!STOP_WORDS.has(word)) {
            wordCounts[word] = (wordCounts[word] || 0) + 1
          }
        }
      }
    }

    const peakHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([h]) => parseInt(h))

    const commonTopics = Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }))

    return {
      peakHours,
      commonTopics,
      recurringTasks: this.extractRecurringTasks(filtered),
      avgResponseTimeSeconds: responseCount > 0 ? totalResponseTime / responseCount : 0,
      totalMessages: filtered.length,
    }
  }

  async suggestProactiveActions(userId: string): Promise<ProactiveSuggestion[]> {
    const analysis = await this.analyzeHistory(userId, 14)
    const suggestions: ProactiveSuggestion[] = []
    const now = new Date()
    const currentHour = now.getHours()

    if (analysis.peakHours.includes(currentHour)) {
      suggestions.push({
        triggerType: "peak_activity",
        suggestedTime: now.toISOString(),
        messageTemplate: "I noticed this is usually a busy time for you. Need any help?",
        confidence: 0.7,
        reason: "Current hour matches peak activity pattern",
      })
    }

    if (analysis.commonTopics.length > 0) {
      const topTopic = analysis.commonTopics[0]
      suggestions.push({
        triggerType: "topic_pattern",
        suggestedTime: now.toISOString(),
        messageTemplate: `I remember you often ask about ${topTopic.word}. Want to continue?`,
        confidence: 0.5 + (topTopic.count / 100) * 0.3,
        reason: `Frequently discussed topic: ${topTopic.word}`,
      })
    }

    for (const task of analysis.recurringTasks.slice(0, 2)) {
      suggestions.push({
        triggerType: "recurring_task",
        suggestedTime: now.toISOString(),
        messageTemplate: `You usually ${task}. Should I help with that?`,
        confidence: 0.6,
        reason: "Recurring task detected",
      })
    }

    return suggestions.slice(0, 5)
  }

  async getUserSummary(userId: string): Promise<string> {
    const analysis = await this.analyzeHistory(userId, 30)

    const prompt = `Summarize this user's interaction patterns in 2-3 sentences:
- Peak hours: ${analysis.peakHours.join(", ")}
- Common topics: ${analysis.commonTopics.map((t) => t.word).join(", ")}
- Recurring tasks: ${analysis.recurringTasks.join(", ")}
- Total messages analyzed: ${analysis.totalMessages}`

    try {
      return await orchestrator.generate("reasoning", { prompt })
    } catch {
      return `User has ${analysis.totalMessages} messages with peak activity at hours: ${analysis.peakHours.join(", ")}.`
    }
  }

  private async fetchHistory(userId: string): Promise<HistoryMessage[]> {
    const dbPath = path.resolve(".orion/history.db")

    try {
      if (!fs.existsSync(dbPath)) {
        return []
      }
      const content = await fs.promises.readFile(dbPath, "utf-8")
      const lines = content.trim().split("\n")
      return lines
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((m): m is HistoryMessage => m !== null)
    } catch {
      return []
    }
  }

  private extractRecurringTasks(messages: HistoryMessage[]): string[] {
    const tasks: Record<string, number> = {}

    for (const msg of messages) {
      if (msg.role !== "user") continue

      const content = msg.content.toLowerCase()
      const taskPatterns = [
        /check\s+(\w+)/,
        /review\s+(\w+)/,
        /update\s+(\w+)/,
        /send\s+(\w+)/,
        /create\s+(\w+)/,
      ]

      for (const pattern of taskPatterns) {
        const match = content.match(pattern)
        if (match) {
          const task = `${match[1]} ${match[0].split(" ")[0]}`
          tasks[task] = (tasks[task] || 0) + 1
        }
      }
    }

    return Object.entries(tasks)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([task]) => task)
  }
}

export const intelligence = new PatternIntelligence()
