import { orchestrator } from "../engines/orchestrator.js"
import { linkExtractor } from "./extractor.js"
import { createLogger } from "../logger.js"

const log = createLogger("link-understanding.summarizer")
const MAX_SUMMARIZED_LINKS = 5

const SUMMARIZE_PROMPT = `Summarize this web page content in 2-3 sentences. Focus on the main points.

Title: {title}
URL: {url}
Content:
{content}

Summary:`

export class LinkSummarizer {
  async summarize(content: {
    title: string
    text: string
    url: string
  }): Promise<string> {
    try {
      const prompt = SUMMARIZE_PROMPT.replace("{title}", content.title)
        .replace("{url}", content.url)
        .replace("{content}", content.text.slice(0, 3000))

      const summary = await orchestrator.generate("fast", { prompt })
      return summary.trim()
    } catch (error) {
      log.error("summarize failed", error)
      return `[${content.title}](${content.url})`
    }
  }

  async processMessage(message: string): Promise<{
    original: string
    linkSummaries: Array<{ url: string; summary: string }>
    enrichedContext: string
  }> {
    try {
      const urls = linkExtractor.extractUrls(message)

      if (urls.length === 0) {
        return {
          original: message,
          linkSummaries: [],
          enrichedContext: message,
        }
      }

      const linkSummaries: Array<{ url: string; summary: string }> = []

      const fetched = await Promise.all(
        urls.slice(0, MAX_SUMMARIZED_LINKS).map(async (url) => ({
          url,
          content: await linkExtractor.fetchContent(url),
        })),
      )

      for (const item of fetched) {
        if (!item.content) {
          continue
        }
        const summary = await this.summarize(item.content)
        linkSummaries.push({ url: item.url, summary })
      }

      let enrichedContext = message

      if (linkSummaries.length > 0) {
        const summariesText = linkSummaries
          .map((s) => `[Link Summary] ${s.url}\n${s.summary}`)
          .join("\n\n")

        enrichedContext = `${message}\n\n---\n${summariesText}`
      }

      return {
        original: message,
        linkSummaries,
        enrichedContext,
      }
    } catch (error) {
      log.error("processMessage failed", error)
      return {
        original: message,
        linkSummaries: [],
        enrichedContext: message,
      }
    }
  }
}

export const linkSummarizer = new LinkSummarizer()
