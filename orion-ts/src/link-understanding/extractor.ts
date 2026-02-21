import { createLogger } from "../logger.js"
import { guardUrl } from "../security/tool-guard.js"

const log = createLogger("link-understanding.extractor")

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

const BLOCKED_DOMAINS = [
  "localhost",
  "127.0.0.1",
  "10.",
  "192.168.",
  "172.16",
  "172.17",
  "172.18",
  "172.19",
  "172.20",
  "172.21",
  "172.22",
  "172.23",
  "172.24",
  "172.25",
  "172.26",
  "172.27",
  "172.28",
  "172.29",
  "172.30",
  "172.31",
  "169.254.",
]

const FETCH_TIMEOUT_MS = 10000
const MAX_CONTENT_LENGTH = 10000
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_URLS_PER_MESSAGE = 10

interface CacheEntry {
  content: { title: string; text: string; url: string } | null
  fetchedAt: number
}

export class LinkExtractor {
  private cache = new Map<string, CacheEntry>()

  extractUrls(text: string): string[] {
    const matches = text.match(URL_REGEX)
    if (!matches) {
      return []
    }

    const validUrls: string[] = []
    for (const url of matches) {
      try {
        const parsed = new URL(url)
        const hostname = parsed.hostname.toLowerCase()

        const isBlocked = BLOCKED_DOMAINS.some(
          (blocked) => hostname === blocked || hostname.startsWith(blocked)
        )

        const guard = guardUrl(url)

        if (!isBlocked && guard.allowed) {
          validUrls.push(url)
        }
      } catch {
        continue
      }
    }

    return [...new Set(validUrls)].slice(0, MAX_URLS_PER_MESSAGE)
  }

  async fetchContent(url: string): Promise<{ title: string; text: string; url: string } | null> {
    try {
      const cached = this.cache.get(url)
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.content
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; OrionBot/1.0)",
          },
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        log.warn("fetchContent failed", { url, status: response.status })
        return null
      }

      const html = await response.text()
      const { title, text } = this.parseHtml(html, url)

      const result = { title, text, url }
      this.cache.set(url, { content: result, fetchedAt: Date.now() })

      return result
    } catch (error) {
      log.error("fetchContent error", { url, error })
      return null
    }
  }

  private parseHtml(html: string, url: string): { title: string; text: string } {
    let title = ""

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (titleMatch) {
      title = this.stripHtml(titleMatch[1]).trim()
    }

    let text = html

    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")

    text = this.stripHtml(text)

    text = text.replace(/\s+/g, " ").trim()

    if (text.length > MAX_CONTENT_LENGTH) {
      text = text.slice(0, MAX_CONTENT_LENGTH) + "..."
    }

    if (!title) {
      try {
        const parsedUrl = new URL(url)
        title = parsedUrl.hostname
      } catch {
        title = "Untitled"
      }
    }

    return { title, text }
  }

  private stripHtml(input: string): string {
    return input
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim()
  }
}

export const linkExtractor = new LinkExtractor()
