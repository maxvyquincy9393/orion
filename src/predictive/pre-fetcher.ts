/**
 * @file pre-fetcher.ts
 * @description Pre-fetches data based on predicted intents to reduce response latency.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Receives preloadHint from intent predictor and warms up relevant caches.
 *   In-memory store with 5-minute TTL per entry.
 *   Cleanup should be called periodically to prevent memory leaks.
 */
import { createLogger } from '../logger.js'

const log = createLogger('predictive.pre-fetcher')

/** A cached pre-fetch entry. */
interface PrefetchEntry {
  data: string
  expiry: number
}

/** TTL for pre-fetched entries. */
const PREFETCH_TTL_MS = 5 * 60 * 1000

class PreFetcher {
  private prefetchCache = new Map<string, PrefetchEntry>()

  /**
   * Pre-fetch data based on a hint string.
   * @param userId - User to pre-fetch for
   * @param hint - Hint describing what data to pre-fetch
   */
  async prefetch(userId: string, hint: string): Promise<void> {
    if (!hint) return
    const key = `${userId}:${hint}`
    if (this.prefetchCache.has(key)) return

    log.debug('pre-fetching data', { userId, hint })

    this.prefetchCache.set(key, {
      data: `prefetched:${hint}`,
      expiry: Date.now() + PREFETCH_TTL_MS,
    })
  }

  /**
   * Get pre-fetched data if available and not expired.
   * @param userId - User to look up
   * @param hint - Hint key to retrieve
   * @returns Pre-fetched data string or null if not available
   */
  get(userId: string, hint: string): string | null {
    const key = `${userId}:${hint}`
    const cached = this.prefetchCache.get(key)
    if (!cached || Date.now() > cached.expiry) {
      this.prefetchCache.delete(key)
      return null
    }
    return cached.data
  }

  /** Remove all expired pre-fetch entries from cache. */
  cleanup(): void {
    const now = Date.now()
    for (const [key, value] of this.prefetchCache) {
      if (now > value.expiry) this.prefetchCache.delete(key)
    }
  }
}

/** Singleton pre-fetcher. */
export const preFetcher = new PreFetcher()
