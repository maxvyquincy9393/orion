/**
 * @file multi-account.ts
 * @description Multi-account API key rotation — rotate when quota exhausted.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Reads comma-separated key lists from env (e.g. ANTHROPIC_API_KEYS="key1,key2").
 *   Rotates round-robin, skipping quota-exceeded keys for 1 hour.
 *   Used by engine adapters to select the next available API key.
 */
import { createLogger } from '../logger.js'
import config from '../config.js'

const log = createLogger('routing.multi-account')

/** Cooldown duration after a quota-exceeded event (1 hour). */
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000

/** Single key entry with quota state. */
interface KeyEntry {
  key: string
  quotaExceededAt: number | null
}

class MultiAccountKeyManager {
  private pools = new Map<string, KeyEntry[]>()
  private cursors = new Map<string, number>()

  constructor() {
    this.loadPools()
  }

  /** Load key pools from environment configuration. */
  private loadPools(): void {
    const keyLists: Record<string, string> = {
      anthropic: config.ANTHROPIC_API_KEYS || config.ANTHROPIC_API_KEY,
      openai: config.OPENAI_API_KEYS || config.OPENAI_API_KEY,
      gemini: config.GEMINI_API_KEYS || config.GEMINI_API_KEY,
      groq: config.GROQ_API_KEY,
      openrouter: config.OPENROUTER_API_KEY,
      deepseek: config.DEEPSEEK_API_KEY,
      mistral: config.MISTRAL_API_KEY,
      together: config.TOGETHER_API_KEY,
      fireworks: config.FIREWORKS_API_KEY,
      cohere: config.COHERE_API_KEY,
    }

    for (const [provider, keyList] of Object.entries(keyLists)) {
      if (!keyList) continue
      const keys = keyList.split(',').map(k => k.trim()).filter(Boolean)
      this.pools.set(provider, keys.map(key => ({ key, quotaExceededAt: null })))
      log.debug('loaded key pool', { provider, count: keys.length })
    }
  }

  /**
   * Get the next available key for a provider (round-robin, skip quota-exceeded).
   * @param provider - Provider name (e.g. 'anthropic')
   * @returns The next available API key, or null if all are quota-exceeded.
   */
  getKey(provider: string): string | null {
    const pool = this.pools.get(provider)
    if (!pool || pool.length === 0) return null

    const now = Date.now()
    const cursor = this.cursors.get(provider) ?? 0
    const len = pool.length

    for (let i = 0; i < len; i++) {
      const idx = (cursor + i) % len
      const entry = pool[idx]!
      const cooldownExpired = !entry.quotaExceededAt || now - entry.quotaExceededAt > QUOTA_COOLDOWN_MS
      if (cooldownExpired) {
        this.cursors.set(provider, (idx + 1) % len)
        return entry.key
      }
    }

    log.warn('all keys quota-exceeded for provider', { provider })
    return null
  }

  /**
   * Mark a key as quota-exceeded (e.g. after a 429 response).
   * @param provider - Provider name
   * @param key - The specific API key that hit quota
   */
  markQuotaExceeded(provider: string, key: string): void {
    const pool = this.pools.get(provider)
    const entry = pool?.find(e => e.key === key)
    if (entry) {
      entry.quotaExceededAt = Date.now()
      log.warn('key marked quota-exceeded', { provider, keyPrefix: key.slice(0, 8) })
    }
  }

  /**
   * Get pool stats for health checks.
   * @returns Per-provider stats with total and available key counts.
   */
  getStats(): Record<string, { total: number; available: number }> {
    const stats: Record<string, { total: number; available: number }> = {}
    const now = Date.now()
    for (const [provider, pool] of this.pools) {
      const available = pool.filter(
        e => !e.quotaExceededAt || now - e.quotaExceededAt > QUOTA_COOLDOWN_MS,
      ).length
      stats[provider] = { total: pool.length, available }
    }
    return stats
  }
}

/** Singleton multi-account key manager. */
export const multiAccountKeyManager = new MultiAccountKeyManager()
