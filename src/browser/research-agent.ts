/**
 * @file research-agent.ts
 * @description Multi-tab parallel web research with LLM synthesis.
 *
 * ARCHITECTURE:
 *   Creates N browser contexts (isolated, different sessions).
 *   In parallel: each context navigates one source URL.
 *   DataExtractor pulls structured data from each tab.
 *   LLM synthesizes: merges + compares + generates answer.
 *
 *   Flow:
 *   1. ResearchPlan: query + list of source URLs
 *   2. Open up to BROWSER_MAX_TABS parallel browser contexts
 *   3. Navigate + extract each source in parallel (Promise.allSettled)
 *   4. LLM synthesis: produce comparison or summary from all sources
 *   5. Return ResearchResult with sources, synthesis, and citations
 *
 * PAPER BASIS:
 *   WebAgent arXiv:2307.12856 — multi-step task decomposition + error recovery
 *   → basis for research plan decomposition and per-tab error isolation.
 *   WebArena arXiv:2307.13854 — parallel multi-source research is most reliable
 *   with structured extraction vs freeform browsing.
 *
 * LIMITS:
 *   Max concurrent tabs: config.BROWSER_MAX_TABS (default 5)
 *   Timeout per tab: 30 seconds
 *   Total research timeout: 90 seconds
 *
 * DIPAKAI from:
 *   browserTool action "research"
 *   skills/browser-skill.ts "web_research" intent
 *
 * @module browser/research-agent
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import { guardUrl } from "../security/tool-guard.js"
import config from "../config.js"
import { dataExtractor, type ExtractionSchema } from "./data-extractor.js"

const log = createLogger("browser.research-agent")

const TAB_TIMEOUT_MS = 30_000
const TOTAL_TIMEOUT_MS = 90_000
const MAX_SYNTHESIS_CHARS = 16_000

// ── Types ─────────────────────────────────────────────────────────────────────

/** Input plan for a research session */
export interface ResearchPlan {
  /** Natural language research query */
  query: string
  /** List of URLs to visit in parallel */
  sources: string[]
  /** What type of data to extract from each source */
  extractSchema: ExtractionSchema
  /** Optional custom synthesis instruction for the LLM */
  synthesisPrompt?: string
}

/** Data extracted from a single source */
export interface SourceResult {
  url: string
  title: string
  data: Record<string, unknown>[]
  error?: string
}

/** Complete result from a research session */
export interface ResearchResult {
  query: string
  sources: SourceResult[]
  /** LLM-generated comparison / summary / answer */
  synthesis: string
  /** Citation strings: "[1] Source Title — URL" */
  citations: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPlaywright() {
  try {
    return await import("playwright")
  } catch {
    return null
  }
}

/**
 * Navigate and extract a single URL in an isolated browser context.
 * Returns SourceResult with data or error.
 */
async function scrapeSource(
  browserfn: () => Promise<{ newContext: () => Promise<unknown> }>,
  url: string,
  schema: ExtractionSchema,
): Promise<SourceResult> {
  const guard = guardUrl(url)
  if (!guard.allowed) {
    return { url, title: "", data: [], error: `URL blocked: ${guard.reason}` }
  }

  let context: { newPage: () => Promise<unknown>; close: () => Promise<void> } | null = null
  try {
    const browser = await browserfn()
    context = (await (browser as { newContext: () => Promise<unknown> }).newContext()) as {
      newPage: () => Promise<unknown>
      close: () => Promise<void>
    }
    const page = await context.newPage() as {
      goto: (url: string, opts: unknown) => Promise<void>
      title: () => Promise<string>
      evaluate: (fn: () => string) => Promise<string>
    }

    // Navigate with per-tab timeout
    await Promise.race([
      page.goto(url, { timeout: TAB_TIMEOUT_MS, waitUntil: "domcontentloaded" }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("tab timeout")), TAB_TIMEOUT_MS),
      ),
    ])

    const title = await page.title().catch(() => url)
    const data = await dataExtractor.extract(page as Parameters<typeof dataExtractor.extract>[0], schema)

    return { url, title, data }
  } catch (err) {
    log.debug("source scrape failed", { url, err: String(err) })
    return { url, title: "", data: [], error: String(err) }
  } finally {
    if (context) await context.close().catch(() => {})
  }
}

// ── ResearchAgent ─────────────────────────────────────────────────────────────

export class ResearchAgent {
  /**
   * Execute a parallel multi-source research plan.
   * Sources are scraped concurrently (up to BROWSER_MAX_TABS).
   * Results are synthesized by the LLM.
   *
   * @param plan - Research plan with query, sources, and extraction schema
   * @returns ResearchResult with per-source data and synthesized answer
   */
  async research(plan: ResearchPlan): Promise<ResearchResult> {
    const { query, sources, extractSchema, synthesisPrompt } = plan
    const playwright = await getPlaywright()

    if (!playwright) {
      return {
        query,
        sources: [],
        synthesis: "Browser tool requires Playwright. Install with: pnpm add playwright && npx playwright install chromium",
        citations: [],
      }
    }

    log.info("research started", { query: query.slice(0, 80), sourceCount: sources.length })

    // Cap parallel tabs
    const maxTabs = config.BROWSER_MAX_TABS ?? 5
    const targetSources = sources.slice(0, maxTabs)

    // Launch browser for contexts
    const browser = await playwright.chromium.launch({
      headless: config.BROWSER_HEADLESS ?? true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    })
    const browserfn = async () => browser

    try {
      // Parallel scrape with total timeout gate
      const scrapePromises = targetSources.map((url) =>
        scrapeSource(browserfn, url, extractSchema),
      )

      const settled = (await Promise.race([
        Promise.allSettled(scrapePromises),
        new Promise<PromiseSettledResult<SourceResult>[]>((_, reject) =>
          setTimeout(() => reject(new Error("total research timeout")), TOTAL_TIMEOUT_MS),
        ),
      ])) as PromiseSettledResult<SourceResult>[]

      const results: SourceResult[] = settled.map((r) =>
        r.status === "fulfilled"
          ? r.value
          : { url: "unknown", title: "", data: [], error: "Promise rejected" },
      )

      const successfulResults = results.filter((r) => !r.error && r.data.length > 0)

      // Build synthesis prompt
      const sourceSummaries = successfulResults
        .map((r, i) => {
          const dataStr = JSON.stringify(r.data.slice(0, 5)).slice(0, 2000)
          return `[${i + 1}] ${r.title} (${r.url})\n${dataStr}`
        })
        .join("\n\n")
        .slice(0, MAX_SYNTHESIS_CHARS)

      const llmPrompt = synthesisPrompt
        ? `${synthesisPrompt}\n\nSources:\n${sourceSummaries}`
        : `Research query: "${query}"

Data collected from ${successfulResults.length} sources:
${sourceSummaries}

Synthesize a clear, concise answer to the research query. Compare sources if relevant.
Include key findings and highlight the best options if applicable.
Be direct and structured (use bullet points or table if helpful).`

      let synthesis = "No synthesis available — no data collected from sources."
      if (successfulResults.length > 0) {
        synthesis = await orchestrator
          .generate("reasoning", { prompt: llmPrompt })
          .catch(() => "Synthesis failed — LLM unavailable.")
      }

      const citations = successfulResults.map(
        (r, i) => `[${i + 1}] ${r.title || r.url} — ${r.url}`,
      )

      log.info("research complete", {
        query: query.slice(0, 80),
        sourcesAttempted: targetSources.length,
        sourcesSuccess: successfulResults.length,
      })

      return { query, sources: results, synthesis, citations }
    } finally {
      await browser.close().catch(() => {})
    }
  }
}

/** Singleton instance */
export const researchAgent = new ResearchAgent()
