/**
 * @file news-curator.ts
 * @description Fetches and curates news headlines for morning briefing context.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses NewsAPI if NEWS_API_KEY is configured and NEWS_ENABLED=true.
 *   Results cached for 30 minutes. Used by morning briefing protocol.
 */
import { createLogger } from '../logger.js'
import config from '../config.js'

const log = createLogger('ambient.news')

/** A curated news headline. */
export interface NewsHeadline {
  title: string
  source: string
  publishedAt: Date
  url: string
  category?: string
}

/** NewsAPI article shape (partial). */
interface NewsApiArticle {
  title: string
  source: { name: string }
  publishedAt: string
  url: string
}

class NewsCurator {
  private cache: NewsHeadline[] = []
  private cacheExpiry = 0
  private readonly CACHE_TTL_MS = 30 * 60 * 1000

  /**
   * Fetch top headlines, using cache if still fresh.
   * @param limit - Maximum number of headlines to return
   * @returns Array of curated headlines (empty if not enabled or fetch fails)
   */
  async getTopHeadlines(limit = 5): Promise<NewsHeadline[]> {
    if (this.cache.length > 0 && Date.now() < this.cacheExpiry) {
      return this.cache.slice(0, limit)
    }

    const apiKey = config.NEWS_API_KEY
    if (!apiKey || config.NEWS_ENABLED !== 'true') {
      log.debug('news not enabled or no API key')
      return []
    }

    try {
      const res = await fetch(
        `https://newsapi.org/v2/top-headlines?language=en&pageSize=${limit}`,
        {
          headers: { 'X-Api-Key': apiKey },
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (!res.ok) throw new Error(`NewsAPI ${res.status}`)
      const data = await res.json() as { articles: NewsApiArticle[] }
      this.cache = data.articles.map(a => ({
        title: a.title,
        source: a.source.name,
        publishedAt: new Date(a.publishedAt),
        url: a.url,
      }))
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS
      return this.cache.slice(0, limit)
    } catch (err) {
      log.warn('news fetch failed', { err })
      return []
    }
  }
}

/** Singleton news curator. */
export const newsCurator = new NewsCurator()
