/**
 * @file quota-tracker.ts
 * @description Tracks API quota usage per provider per day.
 *
 * ARCHITECTURE / INTEGRATION:
 *   In-memory tracker with daily reset at midnight.
 *   Used alongside multi-account key manager for usage monitoring.
 *   Accessible via doctor/health endpoints.
 */
import { createLogger } from '../logger.js'

const log = createLogger('routing.quota-tracker')

/** Daily quota counters for a single provider. */
interface ProviderQuota {
  requests: number
  tokens: number
  lastResetAt: Date
}

class QuotaTracker {
  private quotas = new Map<string, ProviderQuota>()

  /** Get or create quota entry, resetting if the day has changed. */
  private getOrCreate(provider: string): ProviderQuota {
    if (!this.quotas.has(provider)) {
      this.quotas.set(provider, { requests: 0, tokens: 0, lastResetAt: new Date() })
    }
    const quota = this.quotas.get(provider)!
    const now = new Date()
    if (now.getDate() !== quota.lastResetAt.getDate()) {
      quota.requests = 0
      quota.tokens = 0
      quota.lastResetAt = now
    }
    return quota
  }

  /**
   * Record a successful API call for a provider.
   * @param provider - Provider name
   * @param tokensUsed - Number of tokens consumed
   */
  record(provider: string, tokensUsed = 0): void {
    const quota = this.getOrCreate(provider)
    quota.requests++
    quota.tokens += tokensUsed
    log.debug('quota recorded', { provider, requests: quota.requests, tokens: quota.tokens })
  }

  /**
   * Get current usage for a provider.
   * @param provider - Provider name
   * @returns Request count and token count for today.
   */
  getUsage(provider: string): { requests: number; tokens: number } {
    const quota = this.getOrCreate(provider)
    return { requests: quota.requests, tokens: quota.tokens }
  }

  /**
   * Get all providers' current usage.
   * @returns Map of provider → usage stats.
   */
  getAllUsage(): Record<string, { requests: number; tokens: number }> {
    const result: Record<string, { requests: number; tokens: number }> = {}
    for (const [provider, quota] of this.quotas) {
      result[provider] = { requests: quota.requests, tokens: quota.tokens }
    }
    return result
  }
}

/** Singleton quota tracker. */
export const quotaTracker = new QuotaTracker()
