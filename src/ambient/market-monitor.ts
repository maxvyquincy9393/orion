/**
 * @file market-monitor.ts
 * @description Monitors crypto and stock market prices.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses free CoinGecko API for crypto prices — no API key needed.
 *   Per-coin cache with 5-minute TTL to avoid rate limits.
 *   Used by morning briefing for financial context.
 */
import { createLogger } from '../logger.js'

const log = createLogger('ambient.market')

/** Market price snapshot for a single asset. */
export interface MarketSnapshot {
  symbol: string
  price: number
  change24h: number
  currency: string
  fetchedAt: Date
}

/** CoinGecko simple price response shape. */
type CoinGeckoResponse = Record<string, { usd: number; usd_24h_change: number }>

class MarketMonitor {
  private cache = new Map<string, MarketSnapshot>()
  private cacheExpiry = new Map<string, number>()
  private readonly CACHE_TTL_MS = 5 * 60 * 1000

  /**
   * Get crypto price via CoinGecko (free, no key required).
   * @param coinId - CoinGecko coin ID (e.g. 'bitcoin', 'ethereum')
   * @returns Snapshot or null if fetch fails
   */
  async getCrypto(coinId: string): Promise<MarketSnapshot | null> {
    const now = Date.now()
    const expiry = this.cacheExpiry.get(coinId) ?? 0
    if (now < expiry) return this.cache.get(coinId) ?? null

    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(10_000) },
      )
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
      const data = await res.json() as CoinGeckoResponse
      const d = data[coinId]
      if (!d) return null

      const snapshot: MarketSnapshot = {
        symbol: coinId.toUpperCase(),
        price: d.usd,
        change24h: d.usd_24h_change ?? 0,
        currency: 'USD',
        fetchedAt: new Date(),
      }
      this.cache.set(coinId, snapshot)
      this.cacheExpiry.set(coinId, now + this.CACHE_TTL_MS)
      return snapshot
    } catch (err) {
      log.warn('market fetch failed', { coinId, err })
      return null
    }
  }

  /**
   * Get a formatted market summary string.
   * @param coins - CoinGecko coin IDs to include
   * @returns Comma-separated price summary or empty string if all fetches fail
   */
  async getSummary(coins = ['bitcoin', 'ethereum']): Promise<string> {
    const snapshots = await Promise.all(coins.map(c => this.getCrypto(c)))
    return snapshots
      .filter((s): s is MarketSnapshot => s !== null)
      .map(s => `${s.symbol}: $${s.price.toLocaleString()} (${s.change24h > 0 ? '+' : ''}${s.change24h.toFixed(1)}%)`)
      .join(', ')
  }
}

/** Singleton market monitor. */
export const marketMonitor = new MarketMonitor()
