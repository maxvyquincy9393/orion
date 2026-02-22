/**
 * browserTool — Autonomous web navigation and content extraction.
 *
 * Architecture based on Agent-E (arXiv 2407.13032):
 * - Planner separates from navigator — tool handles navigation only
 * - DOM distillation: accessibility tree primary, screenshot secondary
 * - Security: content scanned for prompt injection before returning
 *
 * Actions:
 *   navigate    — Open a URL and return page content
 *   click       — Click an element by text or selector
 *   fill        — Fill a form field
 *   screenshot  — Return current page as base64 PNG
 *   extract     — Extract structured content (links, text, tables)
 *   back        — Navigate back
 *
 * Research: arXiv 2407.13032 — Agent-E DOM distillation approach
 *           arXiv 2501.16150 — Computer Use Agent survey
 *
 * @module agents/tools/browser
 */

import { tool } from "ai"
import { z } from "zod"
import { filterToolResult } from "../../security/prompt-filter.js"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.browser")

// One browser instance per Orion session — reused across tool calls
let browserInstance: any = null
let currentPage: any = null
const MAX_CONTENT_CHARS = 8_000
const PAGE_TIMEOUT_MS = 15_000

async function getPlaywright() {
  try {
    const playwright = await import("playwright")
    return playwright
  } catch {
    return null
  }
}

async function getBrowser() {
  const playwright = await getPlaywright()
  if (!playwright) {
    throw new Error("Playwright not installed. Run: pnpm add playwright && npx playwright install chromium")
  }
  
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    })
    log.info("browser instance started")
  }
  return browserInstance
}

async function getPage() {
  const browser = await getBrowser()
  if (!currentPage || currentPage.isClosed()) {
    currentPage = await browser.newPage()
    await currentPage.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (compatible; Orion/1.0)",
    })
    log.info("new browser page created")
  }
  return currentPage
}

/**
 * Extract readable content from page using accessibility tree.
 * Falls back to text content if accessibility snapshot is empty.
 *
 * Based on Agent-E's hybrid context approach:
 * accessibility tree (fast, structured) + selective screenshot (for visual).
 */
async function extractPageContent(page: any): Promise<string> {
  try {
    // Primary: accessibility tree — structured, no HTML noise
    const snapshot = await page.accessibility.snapshot()
    if (snapshot) {
      const accText = JSON.stringify(snapshot, null, 2).slice(0, MAX_CONTENT_CHARS)
      const filtered = filterToolResult(accText)
      return filtered.sanitized
    }
  } catch {
    // fallback to text
  }

  // Secondary: plain text extraction
  const text = await page.evaluate(() => document.body.innerText)
  const filtered = filterToolResult(text.slice(0, MAX_CONTENT_CHARS))
  return filtered.sanitized
}

export const browserTool = tool({
  description: `Navigate and interact with websites. 
Actions: navigate(url), click(selector|text), fill(selector, value), screenshot, extract(type), back.
Returns page content as accessibility tree text.
Use for: reading live websites, filling forms, extracting data, web research.`,
  inputSchema: z.object({
    action: z.enum(["navigate", "click", "fill", "screenshot", "extract", "back"]),
    url: z.string().optional().describe("URL to navigate to (for navigate action)"),
    selector: z.string().optional().describe("CSS selector or text to target"),
    value: z.string().optional().describe("Value to fill (for fill action)"),
    extractType: z.enum(["text", "links", "tables", "all"]).optional().default("all"),
  }),
  execute: async ({ action, url, selector, value, extractType }) => {
    const playwright = await getPlaywright()
    if (!playwright) {
      return "Browser tool requires Playwright. Install with: pnpm add playwright && npx playwright install chromium"
    }
    
    try {
      const page = await getPage()

      if (action === "navigate") {
        if (!url) return "Error: url required for navigate action"
        await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" })
        const title = await page.title()
        const content = await extractPageContent(page)
        log.info("browser navigated", { url, title })
        return `Page: ${title}\nURL: ${page.url()}\n\n${content}`
      }

      if (action === "click") {
        if (!selector) return "Error: selector required for click action"
        await page.click(selector, { timeout: 5_000 })
        await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {})
        return await extractPageContent(page)
      }

      if (action === "fill") {
        if (!selector || value === undefined) return "Error: selector and value required for fill"
        await page.fill(selector, value)
        return `Filled '${selector}' with '${value.slice(0, 50)}'`
      }

      if (action === "screenshot") {
        const buffer = await page.screenshot({ type: "png", fullPage: false })
        return `data:image/png;base64,${buffer.toString("base64")}`
      }

      if (action === "extract") {
        if (extractType === "links") {
          const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll("a[href]"))
              .map((a) => ({
                text: (a as HTMLAnchorElement).textContent?.trim(),
                href: (a as HTMLAnchorElement).href,
              }))
              .filter((l) => l.href?.startsWith("http"))
              .slice(0, 50)
          )
          return JSON.stringify(links, null, 2)
        }
        return await extractPageContent(page)
      }

      if (action === "back") {
        await page.goBack({ timeout: PAGE_TIMEOUT_MS })
        return await extractPageContent(page)
      }

      return "Unknown action"
    } catch (err) {
      log.error("browserTool failed", { action, error: String(err) })
      return `Browser action failed: ${String(err)}`
    }
  },
})

/**
 * Clean up browser resources.
 * Call this on Orion shutdown.
 */
export async function shutdownBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close()
    browserInstance = null
    currentPage = null
    log.info("browser instance closed")
  }
}
