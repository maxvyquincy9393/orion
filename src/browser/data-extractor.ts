/**
 * @file data-extractor.ts
 * @description Structured data extraction from web pages using LLM assistance.
 *
 * ARCHITECTURE:
 *   Extends browserTool extract action with structured output.
 *   Input:  Playwright page + schema (what to extract)
 *   Output: typed JSON array (prices, tables, listings, article text)
 *
 *   Flow:
 *   1. Extract raw text / accessibility tree from page
 *   2. LLM parses into the requested ExtractionSchema format
 *   3. Returns clean JSON array ready for downstream use
 *
 * EXTRACTION TYPES:
 *   prices   → [{ name, price, currency, available }]
 *   table    → [{ header: string[], rows: string[][] }]
 *   listings → [{ title, description, url, metadata }]
 *   article  → { title, author, date, body, tags }
 *   custom   → free-form shape guided by customPrompt
 *
 * DIPAKAI from:
 *   researchAgent — extract structured data from each tab
 *   browserTool "extract" action (extended)
 *   RecipeEngine steps
 *
 * @module browser/data-extractor
 */

import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("browser.data-extractor")

const MAX_EXTRACT_CHARS = 12_000

// ── Types ─────────────────────────────────────────────────────────────────────

/** Schema type for structured extraction */
export type ExtractionSchema = "prices" | "table" | "listings" | "article" | "custom"

// ── Schema prompts ─────────────────────────────────────────────────────────────

const SCHEMA_PROMPTS: Record<ExtractionSchema, string> = {
  prices: `Extract product/service prices from this page content.
Return a JSON array: [{ "name": "...", "price": "...", "currency": "IDR", "available": true }]
Include all prices found. If no prices, return [].`,
  table: `Extract table data from this page content.
Return a JSON array: [{ "header": ["col1", "col2"], "rows": [["val1", "val2"], ...] }]
If multiple tables exist, include all. If no tables, return [].`,
  listings: `Extract listings/items from this page content (products, search results, news items, etc.).
Return a JSON array: [{ "title": "...", "description": "...", "url": "...", "metadata": {} }]
Include up to 20 results. If none, return [].`,
  article: `Extract article content from this page.
Return a JSON object: { "title": "...", "author": "...", "date": "...", "body": "...", "tags": [] }
body must be the main article text (up to 2000 chars). If not an article, return {}.`,
  custom: `Extract the requested data from this page content.
Return valid JSON (array or object). If nothing found, return [].`,
}

// ── DataExtractor ─────────────────────────────────────────────────────────────

export class DataExtractor {
  /**
   * Extract structured data from the current page using LLM.
   *
   * @param page - Playwright page object
   * @param schema - Type of data to extract
   * @param customPrompt - Required for schema="custom"; describe what to extract
   * @returns Array of extracted records (or single object for "article")
   */
  async extract(
    page: { evaluate: (fn: () => string) => Promise<string>; title: () => Promise<string> },
    schema: ExtractionSchema,
    customPrompt?: string,
  ): Promise<Record<string, unknown>[]> {
    // Get page text content
    const rawText = await page
      .evaluate(() => document.body.innerText)
      .catch(() => "")
    const title = await page.title().catch(() => "")
    const content = rawText.slice(0, MAX_EXTRACT_CHARS)

    const schemaInstruction =
      schema === "custom" && customPrompt
        ? `${SCHEMA_PROMPTS.custom}\n\nExtraction request: ${customPrompt}`
        : SCHEMA_PROMPTS[schema]

    const prompt = `Page title: "${title}"

Page content:
${content}

---
${schemaInstruction}

Respond ONLY with valid JSON, no markdown, no explanation.`

    try {
      const raw = (await orchestrator.generate("fast", { prompt })).trim()
      const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
      const parsed = JSON.parse(jsonStr) as Record<string, unknown> | Record<string, unknown>[]
      // Normalize to array
      const result = Array.isArray(parsed) ? parsed : [parsed]
      log.debug("data extracted", { schema, recordCount: result.length })
      return result
    } catch (err) {
      log.warn("data extraction failed", { schema, err: String(err) })
      return []
    }
  }
}

/** Singleton instance */
export const dataExtractor = new DataExtractor()
