/**
 * UsageTracker - OC-11 Implementation
 * 
 * Based on research:
 * - Portkey/Maxim/Braintrust Observability patterns
 * - OpenTelemetry (OTel) for AI/LLM observability
 * 
 * Implements:
 * 1. Usage tracking with SQLite + ring buffer
 * 2. Pricing table for cost estimation
 * 3. Gateway instrumentation
 * 4. /api/usage/summary endpoint support
 * 
 * @module observability/usage-tracker
 */

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("observability.usage")

/**
 * Supported LLM providers for usage tracking
 */
type LLMProvider = "openai" | "anthropic" | "groq" | "google" | "ollama" | "openrouter" | "unknown"

/**
 * Usage record structure
 */
interface UsageRecord {
  id: string
  userId: string
  sessionId?: string
  /** LLM provider identifier (e.g., "groq", "anthropic", "openai") */
  provider: string
  model: string
  
  // Token counts
  promptTokens: number
  completionTokens: number
  totalTokens: number
  
  // Cost estimation
  estimatedCostUsd: number
  
  // Latency
  latencyMs: number
  
  // Metadata
  requestType: "chat" | "embedding" | "function_calling" | "tool_use"
  success: boolean
  errorType?: string
  
  // Timestamps
  timestamp: Date
  createdAt: Date
}

/**
 * Ring buffer configuration for high-throughput scenarios
 */
interface RingBufferConfig {
  /** Maximum records to keep in memory before flushing to DB */
  maxSize: number
  /** Flush interval in milliseconds */
  flushIntervalMs: number
  /** Whether to use ring buffer (true) or immediate write (false) */
  enabled: boolean
}

/**
 * Pricing information per model
 */
interface ModelPricing {
  provider: LLMProvider
  model: string
  /** Cost per 1K prompt tokens in USD */
  promptPricePer1k: number
  /** Cost per 1K completion tokens in USD */
  completionPricePer1k: number
}

/**
 * Default pricing table (USD per 1K tokens)
 * Updated periodically based on provider pricing
 */
const DEFAULT_PRICING_TABLE: ModelPricing[] = [
  // OpenAI
  { provider: "openai", model: "gpt-4o", promptPricePer1k: 0.0025, completionPricePer1k: 0.01 },
  { provider: "openai", model: "gpt-4o-mini", promptPricePer1k: 0.00015, completionPricePer1k: 0.0006 },
  { provider: "openai", model: "gpt-4-turbo", promptPricePer1k: 0.01, completionPricePer1k: 0.03 },
  
  // Anthropic
  { provider: "anthropic", model: "claude-3-opus", promptPricePer1k: 0.015, completionPricePer1k: 0.075 },
  { provider: "anthropic", model: "claude-3-sonnet", promptPricePer1k: 0.003, completionPricePer1k: 0.015 },
  { provider: "anthropic", model: "claude-3-haiku", promptPricePer1k: 0.00025, completionPricePer1k: 0.00125 },
  
  // Groq
  { provider: "groq", model: "llama-3.3-70b-versatile", promptPricePer1k: 0.00059, completionPricePer1k: 0.00079 },
  { provider: "groq", model: "llama-3.1-8b-instant", promptPricePer1k: 0.00005, completionPricePer1k: 0.00008 },
  { provider: "groq", model: "mixtral-8x7b", promptPricePer1k: 0.00024, completionPricePer1k: 0.00024 },
  
  // Google
  { provider: "google", model: "gemini-1.5-pro", promptPricePer1k: 0.00125, completionPricePer1k: 0.005 },
  { provider: "google", model: "gemini-1.5-flash", promptPricePer1k: 0.000075, completionPricePer1k: 0.0003 },
  
  // Ollama (local, effectively free)
  { provider: "ollama", model: "*", promptPricePer1k: 0, completionPricePer1k: 0 },
]

/**
 * Default ring buffer configuration
 */
const DEFAULT_RING_BUFFER_CONFIG: RingBufferConfig = {
  maxSize: 1000,
  flushIntervalMs: 5000, // 5 seconds
  enabled: true,
}

/**
 * Usage tracker with ring buffer and pricing
 * 
 * Features:
 * - High-throughput ingestion via ring buffer
 * - Automatic cost estimation
 * - Aggregated statistics
 * - Time-series data storage
 */
export class UsageTracker {
  private ringBuffer: UsageRecord[] = []
  private config: RingBufferConfig
  private pricingTable: Map<string, ModelPricing> = new Map()
  private flushTimer: NodeJS.Timeout | null = null
  private isShuttingDown = false

  constructor(config: Partial<RingBufferConfig> = {}) {
    this.config = { ...DEFAULT_RING_BUFFER_CONFIG, ...config }
    this.initializePricing()
    
    if (this.config.enabled) {
      this.startFlushTimer()
    }
  }

  /**
   * Initialize pricing table from defaults
   */
  private initializePricing(): void {
    for (const pricing of DEFAULT_PRICING_TABLE) {
      const key = `${pricing.provider}:${pricing.model}`
      this.pricingTable.set(key, pricing)
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flush()
    }, this.config.flushIntervalMs)
  }

  /**
   * Stop the flush timer (for shutdown)
   */
  stop(): void {
    this.isShuttingDown = true
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    // Final flush
    void this.flush()
  }

  /**
   * Record a usage event
   * 
   * @param record - Usage record to track
   */
  async recordUsage(record: Omit<UsageRecord, "id" | "createdAt" | "estimatedCostUsd">): Promise<void> {
    const estimatedCost = this.estimateCost(
      record.provider,
      record.model,
      record.promptTokens,
      record.completionTokens,
    )

    const fullRecord: UsageRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      estimatedCostUsd: estimatedCost,
      totalTokens: record.promptTokens + record.completionTokens,
    }

    if (this.config.enabled && !this.isShuttingDown) {
      // Add to ring buffer
      this.ringBuffer.push(fullRecord)
      
      // Flush if buffer is full
      if (this.ringBuffer.length >= this.config.maxSize) {
        await this.flush()
      }
    } else {
      // Immediate write if ring buffer disabled
      await this.writeToDatabase(fullRecord)
    }
  }

  /**
   * Flush ring buffer to database
   */
  private async flush(): Promise<void> {
    if (this.ringBuffer.length === 0) {
      return
    }

    const batch = [...this.ringBuffer]
    this.ringBuffer = []

    try {
      // Batch insert using Prisma - create array of promises
      const promises = batch.map((rec) =>
        prisma.usageEvent.create({
          data: {
            userId: rec.userId,
            sessionId: rec.sessionId,
            provider: rec.provider,
            model: rec.model,
            promptTokens: rec.promptTokens,
            completionTokens: rec.completionTokens,
            totalTokens: rec.totalTokens,
            estimatedCostUsd: rec.estimatedCostUsd,
            latencyMs: rec.latencyMs,
            requestType: rec.requestType,
            success: rec.success,
            errorType: rec.errorType,
            timestamp: rec.timestamp,
          },
        }),
      )
      
      await prisma.$transaction(promises)
      
      log.debug(`Flushed ${batch.length} usage records`)
    } catch (error) {
      log.error("Failed to flush usage records", error)
      // Put records back in buffer for retry
      this.ringBuffer.unshift(...batch)
    }
  }

  /**
   * Write single record to database
   */
  private async writeToDatabase(record: UsageRecord): Promise<void> {
    try {
      await prisma.usageEvent.create({
        data: {
          userId: record.userId,
          sessionId: record.sessionId,
          provider: record.provider,
          model: record.model,
          promptTokens: record.promptTokens,
          completionTokens: record.completionTokens,
          totalTokens: record.totalTokens,
          estimatedCostUsd: record.estimatedCostUsd,
          latencyMs: record.latencyMs,
          requestType: record.requestType,
          success: record.success,
          errorType: record.errorType,
          timestamp: record.timestamp,
        },
      })
    } catch (error) {
      log.error("Failed to write usage record", { record: record.id, error })
    }
  }

  /**
   * Estimate cost based on token usage
   * 
   * @param provider - LLM provider
   * @param model - Model name
   * @param promptTokens - Number of prompt tokens
   * @param completionTokens - Number of completion tokens
   * @returns Estimated cost in USD
   */
  estimateCost(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    // Try exact match first
    let pricing = this.pricingTable.get(`${provider}:${model}`)
    
    // Fall back to wildcard for ollama
    if (!pricing && provider === "ollama") {
      pricing = this.pricingTable.get("ollama:*")
    }
    
    if (!pricing) {
      // Default pricing if not found
      log.warn(`Unknown pricing for ${provider}:${model}, using defaults`)
      return (promptTokens + completionTokens) * 0.000001 // $1 per 1M tokens
    }

    const promptCost = (promptTokens / 1000) * pricing.promptPricePer1k
    const completionCost = (completionTokens / 1000) * pricing.completionPricePer1k
    
    return promptCost + completionCost
  }

  /**
   * Get usage summary for a user
   * 
   * @param userId - User identifier
   * @param startDate - Start of time range
   * @param endDate - End of time range
   * @returns Aggregated usage statistics
   */
  async getUserSummary(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalRequests: number
    totalTokens: number
    totalCostUsd: number
    avgLatencyMs: number
    successRate: number
    byProvider: Record<string, { requests: number; tokens: number; cost: number }>
    byModel: Record<string, { requests: number; tokens: number; cost: number }>
    daily: Array<{ date: string; requests: number; tokens: number; cost: number }>
  }> {
    const events = await prisma.usageEvent.findMany({
      where: {
        userId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        timestamp: "asc",
      },
    })

    // Aggregate statistics
    const totalRequests = events.length
    const totalTokens = events.reduce((sum, e) => sum + e.totalTokens, 0)
    const totalCostUsd = events.reduce((sum, e) => sum + e.estimatedCostUsd, 0)
    const avgLatencyMs = events.length > 0 
      ? events.reduce((sum, e) => sum + e.latencyMs, 0) / events.length 
      : 0
    const successfulRequests = events.filter((e) => e.success).length
    const successRate = totalRequests > 0 ? successfulRequests / totalRequests : 0

    // Group by provider
    const byProvider: Record<string, { requests: number; tokens: number; cost: number }> = {}
    for (const event of events) {
      const p = event.provider
      if (!byProvider[p]) {
        byProvider[p] = { requests: 0, tokens: 0, cost: 0 }
      }
      byProvider[p].requests++
      byProvider[p].tokens += event.totalTokens
      byProvider[p].cost += event.estimatedCostUsd
    }

    // Group by model
    const byModel: Record<string, { requests: number; tokens: number; cost: number }> = {}
    for (const event of events) {
      const m = event.model
      if (!byModel[m]) {
        byModel[m] = { requests: 0, tokens: 0, cost: 0 }
      }
      byModel[m].requests++
      byModel[m].tokens += event.totalTokens
      byModel[m].cost += event.estimatedCostUsd
    }

    // Daily aggregation
    const dailyMap = new Map<string, { requests: number; tokens: number; cost: number }>()
    for (const event of events) {
      const date = event.timestamp.toISOString().split("T")[0]
      const existing = dailyMap.get(date) ?? { requests: 0, tokens: 0, cost: 0 }
      existing.requests++
      existing.tokens += event.totalTokens
      existing.cost += event.estimatedCostUsd
      dailyMap.set(date, existing)
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      totalRequests,
      totalTokens,
      totalCostUsd,
      avgLatencyMs,
      successRate,
      byProvider,
      byModel,
      daily,
    }
  }

  /**
   * Get global usage summary (admin only)
   */
  async getGlobalSummary(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalRequests: number
    totalTokens: number
    totalCostUsd: number
    uniqueUsers: number
    topUsers: Array<{ userId: string; requests: number; cost: number }>
  }> {
    const events = await prisma.usageEvent.findMany({
      where: {
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        userId: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
    })

    const totalRequests = events.length
    const totalTokens = events.reduce((sum, e) => sum + e.totalTokens, 0)
    const totalCostUsd = events.reduce((sum, e) => sum + e.estimatedCostUsd, 0)
    
    const uniqueUsers = new Set(events.map((e) => e.userId)).size

    // Aggregate by user
    const userMap = new Map<string, { requests: number; cost: number }>()
    for (const event of events) {
      const existing = userMap.get(event.userId) ?? { requests: 0, cost: 0 }
      existing.requests++
      existing.cost += event.estimatedCostUsd
      userMap.set(event.userId, existing)
    }

    const topUsers = Array.from(userMap.entries())
      .map(([userId, stats]) => ({ userId, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)

    return {
      totalRequests,
      totalTokens,
      totalCostUsd,
      uniqueUsers,
      topUsers,
    }
  }

  /**
   * Update pricing for a specific model
   */
  setPricing(pricing: ModelPricing): void {
    const key = `${pricing.provider}:${pricing.model}`
    this.pricingTable.set(key, pricing)
  }

  /**
   * Get current ring buffer status (for monitoring)
   */
  getBufferStatus(): { size: number; maxSize: number; enabled: boolean } {
    return {
      size: this.ringBuffer.length,
      maxSize: this.config.maxSize,
      enabled: this.config.enabled,
    }
  }
}

// Export singleton instance
export const usageTracker = new UsageTracker()
