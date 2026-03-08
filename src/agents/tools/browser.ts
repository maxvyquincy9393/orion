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
import { guardUrl } from "../../security/tool-guard.js"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.browser")

// One browser instance per EDITH session — reused across tool calls
let browserInstance: any = null
let currentPage: any = null
const MAX_CONTENT_CHARS = 8_000
const PAGE_TIMEOUT_MS = 15_000
const MAX_ELEMENTS = 50

// ── Circuit Breaker ──────────────────────────────────────────────────────────

/** Per-action hard timeout (ms) — prevents infinite hangs on slow/broken pages. */
const ACTION_TIMEOUT_MS: Record<string, number> = {
  navigate: 15_000,
  click: 8_000,
  fill: 5_000,
  smart_fill: 20_000,
  research: 90_000,
  default: 10_000,
}

/**
 * Wrap an async action with a hard timeout circuit breaker.
 * Rejects with a user-friendly error if the action exceeds the limit.
 */
async function withCircuitBreaker<T>(fn: () => Promise<T>, action: string): Promise<T> {
  const timeoutMs = ACTION_TIMEOUT_MS[action] ?? ACTION_TIMEOUT_MS.default
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`action '${action}' timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ])
}

// ── CAPTCHA Detection ────────────────────────────────────────────────────────

/** Signals that indicate a CAPTCHA or bot-challenge page. */
const CAPTCHA_SIGNALS = ["captcha", "challenge", "cloudflare", "recaptcha", "hcaptcha"]

/**
 * Detect CAPTCHA or bot-challenge page after navigation/click.
 * @param page - Playwright page
 * @returns true if CAPTCHA detected
 */
async function detectCaptcha(page: any): Promise<boolean> {
  const title = (await page.title().catch(() => "")).toLowerCase()
  const url = page.url().toLowerCase()
  return CAPTCHA_SIGNALS.some((s) => title.includes(s) || url.includes(s))
}

// ── Payment Gate ─────────────────────────────────────────────────────────────

/** Signals that indicate a payment confirmation action. */
const PAYMENT_SIGNALS = [
  "checkout",
  "payment",
  "pay now",
  "bayar",
  "konfirmasi pembayaran",
  "place order",
  "beli sekarang",
  "lanjut bayar",
]

/**
 * Check if an action is about to trigger a payment.
 * Payment actions always require explicit user confirmation.
 * @param selector - CSS selector or text that will be clicked
 * @param pageTitle - Current page title for additional context
 */
function isPaymentAction(selector: string, pageTitle: string): boolean {
  const combined = (selector + " " + pageTitle).toLowerCase()
  return PAYMENT_SIGNALS.some((s) => combined.includes(s))
}

/**
 * SeeAct grounding: textual choice > visual annotation.
 * Tag interactable elements so the planner can act by stable IDs instead of brittle pixels.
 */
const SOM_INJECTION_SCRIPT = `(() => {
  const selectors = [
    "button",
    "a[href]",
    "input",
    "select",
    "textarea",
    "[role='button']",
    "[role='link']",
    "[tabindex]"
  ];

  let counter = 0;
  const seen = new WeakSet();
  document.querySelectorAll(selectors.join(",")).forEach((element) => {
    if (!(element instanceof HTMLElement) || seen.has(element)) {
      return;
    }
    seen.add(element);
    if (!element.dataset.edithId) {
      element.dataset.edithId = "e" + String(counter).padStart(2, "0");
      counter += 1;
    }
  });
  return counter;
})()`

export interface BrowserInteractableElement {
  id: string
  tag: string
  text: string
  role: string
  ariaLabel: string
  placeholder: string
  href: string
  isVisible: boolean
}

export interface BrowserObservation {
  title: string
  url: string
  content: string
  elements: BrowserInteractableElement[]
  timestamp: number
}

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
      "User-Agent": "Mozilla/5.0 (compatible; EDITH/1.0)",
    })
    log.info("new browser page created")
  }
  return currentPage
}

export async function injectSetOfMark(page: any): Promise<number> {
  return page.evaluate(SOM_INJECTION_SCRIPT)
}

function normalizeInteractableElements(elements: BrowserInteractableElement[]): BrowserInteractableElement[] {
  return elements
    .filter((element) => element.isVisible)
    // Filter ke MAX_ELEMENTS: context window budget.
    .slice(0, MAX_ELEMENTS)
}

export async function extractInteractableElements(page: any): Promise<BrowserInteractableElement[]> {
  const rawElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[data-edith-id]"))
      .map((element) => {
        const htmlElement = element as HTMLElement
        const rect = htmlElement.getBoundingClientRect()
        return {
          id: htmlElement.dataset.edithId ?? "",
          tag: htmlElement.tagName.toLowerCase(),
          text: htmlElement.innerText?.trim().slice(0, 80) ?? "",
          role: htmlElement.getAttribute("role") ?? "",
          ariaLabel: htmlElement.getAttribute("aria-label") ?? "",
          placeholder: (htmlElement as HTMLInputElement).placeholder ?? "",
          href: (htmlElement as HTMLAnchorElement).href ?? "",
          isVisible: rect.height > 0 && rect.width > 0,
        }
      })
      .filter((element) => element.id)
  })

  return normalizeInteractableElements(rawElements)
}

function buildEdithSelector(edithId: string): string {
  return `[data-edith-id="${edithId}"]`
}

export async function getCurrentBrowserObservation(): Promise<BrowserObservation | null> {
  if (!currentPage || currentPage.isClosed()) {
    return null
  }

  const title = await currentPage.title().catch(() => "")
  const content = await extractPageContent(currentPage)
  const elements = await extractInteractableElements(currentPage).catch(() => [])

  return {
    title,
    url: currentPage.url(),
    content,
    elements,
    timestamp: Date.now(),
  }
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
Actions: navigate(url), click(selector|text), fill(selector, value), click_element(edithId), fill_element(edithId, value), screenshot, extract(type), back, smart_fill(intent), research(query, sources).
Returns page content as accessibility tree text.
Use for: reading live websites, filling forms, extracting data, web research.
smart_fill: LLM-driven form filling from user intent (no selector knowledge needed).
research: multi-source parallel research with synthesis.`,
  inputSchema: z.object({
    action: z.enum([
      "navigate",
      "click",
      "fill",
      "click_element",
      "fill_element",
      "screenshot",
      "extract",
      "back",
      "smart_fill",
      "research",
    ]),
    url: z.string().optional().describe("URL to navigate to (for navigate action)"),
    selector: z.string().optional().describe("CSS selector or text to target"),
    value: z.string().optional().describe("Value to fill (for fill action)"),
    edithId: z.string().optional().describe("data-edith-id assigned by the Set-of-Mark injector"),
    extractType: z.enum(["text", "links", "tables", "all"]).optional().default("all"),
    intent: z.string().optional().describe("User intent string for smart_fill (e.g. 'book tiket Bandung Sabtu pagi')"),
    query: z.string().optional().describe("Research query for research action"),
    sources: z.array(z.string()).optional().describe("List of URLs or search queries for research action"),
  }),
  execute: async ({ action, url, selector, value, edithId, extractType, intent, query, sources }) => {
    const playwright = await getPlaywright()
    if (!playwright) {
      return "Browser tool requires Playwright. Install with: pnpm add playwright && npx playwright install chromium"
    }
    
    try {
      if (action === "navigate") {
        if (!url) return "Error: url required for navigate action"
        const guard = guardUrl(url)
        if (!guard.allowed) {
          return `Browser action failed: ${guard.reason ?? "URL blocked"}`
        }
        const page = await getPage()
        await withCircuitBreaker(
          () => page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" }),
          "navigate",
        )
        await injectSetOfMark(page)
        // CAPTCHA check after navigation
        if (await detectCaptcha(page)) {
          return "⚠️ CAPTCHA detected. Please solve it manually, then tell me to continue."
        }
        const title = await page.title()
        const observation = await getCurrentBrowserObservation()
        log.info("browser navigated", { url, title })
        return JSON.stringify(observation)
      }

      const page = await getPage()

      if (action === "click") {
        if (!selector) return "Error: selector required for click action"
        // Payment gate: check before clicking
        const pageTitle = await page.title().catch(() => "")
        if (isPaymentAction(selector, pageTitle)) {
          return `⚠️ Payment action detected. Selector: "${selector}" on page "${pageTitle}". Please confirm: reply 'confirm' to proceed with payment.`
        }
        await withCircuitBreaker(
          () => page.click(selector, { timeout: 5_000 }),
          "click",
        )
        await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {})
        await injectSetOfMark(page)
        // CAPTCHA check after click (could navigate to challenge page)
        if (await detectCaptcha(page)) {
          return "⚠️ CAPTCHA detected after click. Please solve it manually, then tell me to continue."
        }
        const observation = await getCurrentBrowserObservation()
        return JSON.stringify(observation)
      }

      if (action === "fill") {
        if (!selector || value === undefined) return "Error: selector and value required for fill"
        // Payment gate: check before filling payment fields
        const pageTitle = await page.title().catch(() => "")
        if (isPaymentAction(selector, pageTitle)) {
          return `⚠️ Payment field detected. Selector: "${selector}". Please confirm before filling payment details.`
        }
        await withCircuitBreaker(
          () => page.fill(selector, value),
          "fill",
        )
        return `Filled '${selector}' with '${value.slice(0, 50)}'`
      }

      if (action === "click_element") {
        if (!edithId) return "Error: edithId required for click_element"
        // data-edith-id grounding: no pixel coordinates needed.
        await page.click(buildEdithSelector(edithId), { timeout: 5_000 })
        await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {})
        await injectSetOfMark(page)
        const observation = await getCurrentBrowserObservation()
        return JSON.stringify(observation)
      }

      if (action === "fill_element") {
        if (!edithId || value === undefined) return "Error: edithId and value required for fill_element"
        await page.fill(buildEdithSelector(edithId), value)
        const observation = await getCurrentBrowserObservation()
        return JSON.stringify(observation)
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
        await injectSetOfMark(page)
        const observation = await getCurrentBrowserObservation()
        return JSON.stringify(observation)
      }

      if (action === "smart_fill") {
        if (!intent) return "Error: intent required for smart_fill action"
        const { smartFormFiller } = await import("../../browser/smart-form-filler.js")
        const observation = await getCurrentBrowserObservation()
        if (!observation) return "Error: no active browser page for smart_fill"
        const fields = smartFormFiller.extractFields(observation)
        if (fields.length === 0) return "No form fields detected on current page."
        const plan = await withCircuitBreaker(
          () => smartFormFiller.plan(intent, fields, {}),
          "smart_fill",
        )
        if (plan.missingInfo.length > 0) {
          return `Smart fill needs more info: ${plan.missingInfo.join(", ")}`
        }
        if (plan.warnings.length > 0) {
          return `⚠️ Smart fill warning: ${plan.warnings.join("; ")}. Reply 'confirm' to proceed.`
        }
        // Execute fills
        for (const fill of plan.fills) {
          await page.fill(`[data-edith-id="${fill.edithId}"]`, fill.value).catch(() => {})
        }
        const updatedObs = await getCurrentBrowserObservation()
        return JSON.stringify({ filled: plan.fills.length, observation: updatedObs })
      }

      if (action === "research") {
        if (!query) return "Error: query required for research action"
        const { researchAgent } = await import("../../browser/research-agent.js")
        const result = await withCircuitBreaker(
          () => researchAgent.research({ query, sources: sources ?? [], extractSchema: "article" }),
          "research",
        )
        return JSON.stringify(result)
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
 * Call this on EDITH shutdown.
 */
export async function shutdownBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close()
    browserInstance = null
    currentPage = null
    log.info("browser instance closed")
  }
}

export const __browserTestUtils = {
  SOM_INJECTION_SCRIPT,
  normalizeInteractableElements,
  buildEdithSelector,
}
