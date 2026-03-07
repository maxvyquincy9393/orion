import { searchMessages } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const logger = createLogger("intelligence")

export class PatternIntelligence {
  async analyzeHistory(userId: string, days = 14) {
    const messages = await searchMessages(userId, "", days)

    if (!messages.length) {
      return {
        peakHours: [] as number[],
        commonTopics: [] as { word: string; count: number }[],
        recurringTasks: [] as string[],
        avgResponseTimeSeconds: 0,
        totalMessages: 0,
      }
    }

    const hourCounts = new Array(24).fill(0)
    messages.forEach((msg) => {
      hourCounts[new Date(msg.createdAt).getHours()] += 1
    })

    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((entry) => entry.hour)

    const stopwords = new Set([
      "that",
      "this",
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
    ])

    const wordCount = new Map<string, number>()
    messages.forEach((msg) => {
      msg.content
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 4 && !stopwords.has(word))
        .forEach((word) => wordCount.set(word, (wordCount.get(word) ?? 0) + 1))
    })

    const commonTopics = [...wordCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }))

    const phraseCounts = new Map<string, number>()
    messages.forEach((msg) => {
      const words = msg.content.split(" ")
      for (let i = 0; i < words.length - 2; i += 1) {
        const phrase = words.slice(i, i + 3).join(" ").toLowerCase()
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
      }
    })

    const recurringTasks = [...phraseCounts.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phrase]) => phrase)

    const pairs: number[] = []
    for (let i = 0; i < messages.length - 1; i += 1) {
      if (messages[i].role === "user" && messages[i + 1].role === "assistant") {
        const delta =
          new Date(messages[i + 1].createdAt).getTime() -
          new Date(messages[i].createdAt).getTime()
        pairs.push(delta / 1000)
      }
    }

    const avgResponseTimeSeconds = pairs.length
      ? pairs.reduce((acc, value) => acc + value, 0) / pairs.length
      : 0

    return {
      peakHours,
      commonTopics,
      recurringTasks,
      avgResponseTimeSeconds,
      totalMessages: messages.length,
    }
  }

  async suggestProactiveActions(userId: string) {
    const analysis = await this.analyzeHistory(userId)
    const suggestions: {
      triggerType: string
      suggestedTime: string
      messageTemplate: string
      confidence: number
      reason: string
    }[] = []

    analysis.peakHours.slice(0, 2).forEach((hour) => {
      suggestions.push({
        triggerType: "scheduled",
        suggestedTime: `${hour}:00`,
        messageTemplate: "Good morning! Ready to start?",
        confidence: 0.8,
        reason: `User is most active at ${hour}:00`,
      })
    })

    if (analysis.avgResponseTimeSeconds > 300) {
      suggestions.push({
        triggerType: "inactivity",
        suggestedTime: "adaptive",
        messageTemplate: "Checking in — anything you need?",
        confidence: 0.6,
        reason: "Average response time > 5 minutes",
      })
    }

    logger.info(`${suggestions.length} suggestions for ${userId}`)
    return suggestions.slice(0, 5)
  }

  async getUserSummary(userId: string): Promise<string> {
    const analysis = await this.analyzeHistory(userId, 30)
    const prompt = `Based on this user activity analysis, write a brief personal summary (3-4 sentences): - Most active hours: ${analysis.peakHours.join(", ")} - Top topics: ${analysis.commonTopics
      .slice(0, 5)
      .map((topic) => topic.word)
      .join(", ")} - Recurring tasks: ${analysis.recurringTasks.join(", ")} - Total messages analyzed: ${analysis.totalMessages}`

    try {
      return await orchestrator.generate("reasoning", { prompt })
    } catch {
      return (
        `Active at hours: ${analysis.peakHours.join(", ")}. ` +
        `Top topics: ${analysis.commonTopics
          .slice(0, 3)
          .map((topic) => topic.word)
          .join(", ")}.`
      )
    }
  }
}

export const intelligence = new PatternIntelligence()
