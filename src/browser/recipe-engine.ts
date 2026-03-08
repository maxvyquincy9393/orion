/**
 * @file recipe-engine.ts
 * @description Pre-built automation templates (recipes) for common browser tasks.
 *
 * ARCHITECTURE:
 *   Recipe = sequence of high-level steps executed by browserTool.
 *   Steps: navigate, smart_fill, click, extract, confirm.
 *   SmartFormFiller handles field mapping — recipe does NOT hardcode selectors.
 *   User-defined recipes stored in: .edith/recipes/*.json
 *
 * PAPER BASIS:
 *   WebArena arXiv:2307.13854 — recipe-based agent is 3× more reliable
 *   for sites visited repeatedly vs freeform LLM-driven agent.
 *
 * BUILT-IN RECIPES:
 *   kereta-api     — search KAI train schedule
 *   traveloka-hotel — hotel search with filter
 *   google-search  — search + extract top results
 *   tokopedia-search — product search + price compare
 *
 * USER-DEFINED:
 *   User describes task in NL → EDITH generates recipe → saves to .edith/recipes/
 *
 * @module browser/recipe-engine
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { createLogger } from "../logger.js"

const log = createLogger("browser.recipe-engine")

const RECIPES_DIR = ".edith/recipes"

/** Maximum wall-clock time allowed for a single recipe execution before aborting. */
const RECIPE_EXECUTION_TIMEOUT_MS = 60_000

/**
 * Lowercase substrings that indicate a CAPTCHA or bot-challenge page.
 * Checked against page title + body text returned by the browser tool.
 */
const CAPTCHA_INDICATORS = [
  "captcha",
  "i am not a robot",
  "i'm not a robot",
  "verify you are human",
  "cloudflare",
  "just a moment",
  "access denied",
  "challenge",
  "bot detection",
]

/**
 * Returns true when the page content string contains a known CAPTCHA / bot-challenge signal.
 * @param pageContent - Raw text or JSON string returned by the browser tool after navigation.
 */
function detectCaptcha(pageContent: string): boolean {
  const lower = pageContent.toLowerCase()
  return CAPTCHA_INDICATORS.some((indicator) => lower.includes(indicator))
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single step in an automation recipe */
export interface RecipeStep {
  /** browserTool action name */
  action: string
  /** Parameters for the action (url, intent, selector, etc.) */
  params: Record<string, unknown>
  /** If true, pause and ask user confirmation before this step */
  confirmRequired?: boolean
  /** Human-readable description of what EDITH is doing */
  description: string
}

/** A complete automation recipe */
export interface Recipe {
  /** Unique identifier */
  id: string
  /** Display name */
  name: string
  /** What the recipe does */
  description: string
  /** Keywords for intent matching */
  trigger: string[]
  /** Ordered list of steps */
  steps: RecipeStep[]
  /** Inputs required before starting (e.g., ["destination", "date"]) */
  requiredInputs: string[]
}

// ── Built-in Recipes ──────────────────────────────────────────────────────────

const BUILT_IN_RECIPES: Recipe[] = [
  {
    id: "google-search",
    name: "Google Search",
    description: "Search Google and extract top results",
    trigger: ["cari di google", "google", "search", "googling"],
    requiredInputs: ["query"],
    steps: [
      {
        action: "navigate",
        params: { url: "https://www.google.com" },
        description: "Opening Google...",
      },
      {
        action: "smart_fill",
        params: { intent: "search for: {query}" },
        description: "Filling search query...",
      },
      {
        action: "click",
        params: { selector: "input[name='btnK']" },
        description: "Submitting search...",
      },
      {
        action: "extract",
        params: { extractType: "listings" },
        description: "Extracting search results...",
      },
    ],
  },
  {
    id: "kereta-api",
    name: "Cari Tiket Kereta KAI",
    description: "Cari jadwal dan harga tiket kereta di KAI Access",
    trigger: ["kereta", "kai", "tiket kereta", "jadwal kereta", "train"],
    requiredInputs: ["from", "to", "date"],
    steps: [
      {
        action: "navigate",
        params: { url: "https://kai.id" },
        description: "Membuka kai.id...",
      },
      {
        action: "smart_fill",
        params: { intent: "cari kereta dari {from} ke {to} tanggal {date}" },
        description: "Mengisi form pencarian jadwal...",
      },
      {
        action: "extract",
        params: { extractType: "prices" },
        description: "Mengambil daftar kereta dan harga...",
      },
    ],
  },
  {
    id: "traveloka-hotel",
    name: "Cari Hotel Traveloka",
    description: "Cari hotel di Traveloka dengan filter harga dan lokasi",
    trigger: ["hotel", "traveloka", "penginapan", "book hotel"],
    requiredInputs: ["city", "checkin", "checkout"],
    steps: [
      {
        action: "navigate",
        params: { url: "https://www.traveloka.com/hotel" },
        description: "Membuka Traveloka Hotel...",
      },
      {
        action: "smart_fill",
        params: { intent: "cari hotel di {city} check-in {checkin} check-out {checkout}" },
        description: "Mengisi form pencarian hotel...",
      },
      {
        action: "extract",
        params: { extractType: "listings" },
        description: "Mengambil daftar hotel...",
      },
    ],
  },
  {
    id: "tokopedia-search",
    name: "Cari Produk Tokopedia",
    description: "Cari produk di Tokopedia dan bandingkan harga",
    trigger: ["tokopedia", "beli di tokped", "produk tokopedia", "tokped"],
    requiredInputs: ["product"],
    steps: [
      {
        action: "navigate",
        params: { url: "https://www.tokopedia.com" },
        description: "Membuka Tokopedia...",
      },
      {
        action: "smart_fill",
        params: { intent: "cari produk: {product}" },
        description: "Mencari produk...",
      },
      {
        action: "extract",
        params: { extractType: "prices" },
        description: "Mengambil daftar harga produk...",
      },
    ],
  },
]

// ── RecipeEngine ──────────────────────────────────────────────────────────────

export class RecipeEngine {
  private userRecipes: Recipe[] = []
  private loaded = false

  /**
   * Find a recipe matching the user intent using keyword matching.
   * Checks user-defined recipes first, then built-ins.
   *
   * @param intent - User request string
   * @returns Matching recipe or null if no match found
   */
  findRecipe(intent: string): Recipe | null {
    const lower = intent.toLowerCase()
    const all = [...this.userRecipes, ...BUILT_IN_RECIPES]
    return (
      all.find((r) => r.trigger.some((kw) => lower.includes(kw.toLowerCase()))) ?? null
    )
  }

  /**
   * Execute a recipe with user-provided inputs.
   * Substitutes {placeholder} patterns in step params with actual inputs.
   *
   * @param recipe - Recipe to execute
   * @param inputs - Key-value inputs from user (e.g., {from: "Jakarta", to: "Bandung"})
   * @returns Summary of execution result
   */
  async execute(recipe: Recipe, inputs: Record<string, string>): Promise<string> {
    log.info("recipe execution started", { id: recipe.id, name: recipe.name })

    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error("Recipe execution timed out"))
    }, RECIPE_EXECUTION_TIMEOUT_MS)

    try {
      return await this.runSteps(recipe, inputs, abortController.signal)
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  /**
   * Internal step runner, separated so the AbortController timeout wrapper in
   * `execute()` stays clean.
   *
   * @param recipe - Recipe being executed
   * @param inputs - User-supplied substitution values
   * @param signal - AbortSignal from the circuit-breaker timeout
   * @returns Formatted execution summary
   */
  private async runSteps(
    recipe: Recipe,
    inputs: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    const results: string[] = []
    results.push(`🍳 Running recipe: **${recipe.name}**`)

    for (const step of recipe.steps) {
      // Circuit breaker: abort if timeout fired between steps
      if (signal.aborted) {
        log.warn("recipe aborted by circuit breaker", { id: recipe.id, step: step.action })
        results.push(`  ⏱️ Recipe timed out (>${RECIPE_EXECUTION_TIMEOUT_MS / 1000}s). Stopping.`)
        break
      }

      // Substitute placeholders in params
      const resolvedParams = this.resolveParams(step.params, inputs)
      results.push(`  ⏳ ${step.description}`)

      if (step.confirmRequired) {
        results.push(`  ⚠️ Confirmation required before: "${step.description}". Reply 'confirm' to continue.`)
        // Stop here — user must confirm before continuing
        break
      }

      try {
        const { browserTool } = await import("../agents/tools/browser.js")
        const executeFn = browserTool.execute
        if (!executeFn) throw new Error("browserTool.execute is not available")
        // Cast to bypass the SDK's generic ToolExecutionOptions constraint — our
        // execute implementation does not use the second options argument.
        const result = await (executeFn as (args: Record<string, unknown>) => Promise<string>)(
          resolvedParams,
        )

        // CAPTCHA / bot-challenge detection — bail out early rather than hanging
        if (step.action === "navigate" && detectCaptcha(result as string)) {
          log.warn("CAPTCHA detected after navigation, aborting recipe", {
            id: recipe.id,
            url: resolvedParams["url"],
          })
          results.push(`  🚫 CAPTCHA or bot-challenge detected. Recipe aborted to avoid hanging.`)
          break
        }

        // Try to parse JSON result and extract summary
        const summary = this.summarizeResult(result as string, step.action)
        results.push(`  ✅ ${summary}`)
      } catch (err) {
        log.warn("recipe step failed", { stepAction: step.action, err: String(err) })
        results.push(`  ❌ Step failed: ${String(err)}`)
        break
      }
    }

    return results.join("\n")
  }

  /**
   * List all available recipes (built-in + user-defined).
   */
  listRecipes(): Recipe[] {
    return [...BUILT_IN_RECIPES, ...this.userRecipes]
  }

  /**
   * Save a user-defined recipe to disk.
   * @param recipe - Recipe to save
   */
  async saveRecipe(recipe: Recipe): Promise<void> {
    await mkdir(RECIPES_DIR, { recursive: true })
    const file = join(RECIPES_DIR, `${recipe.id}.json`)
    await writeFile(file, JSON.stringify(recipe, null, 2), "utf8")
    this.userRecipes = this.userRecipes.filter((r) => r.id !== recipe.id)
    this.userRecipes.push(recipe)
    log.info("user recipe saved", { id: recipe.id })
  }

  /**
   * Load user-defined recipes from disk.
   * Called lazily on first use.
   */
  async loadUserRecipes(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const files = await readdir(RECIPES_DIR).catch(() => [] as string[])
      for (const file of files) {
        if (!file.endsWith(".json")) continue
        const raw = await readFile(join(RECIPES_DIR, file), "utf8").catch(() => null)
        if (!raw) continue
        try {
          const recipe = JSON.parse(raw) as Recipe
          if (recipe.id && recipe.steps) {
            this.userRecipes.push(recipe)
          }
        } catch {
          log.warn("invalid recipe file", { file })
        }
      }
      log.debug("user recipes loaded", { count: this.userRecipes.length })
    } catch {
      // recipes dir may not exist
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private resolveParams(
    params: Record<string, unknown>,
    inputs: Record<string, string>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(params)) {
      if (typeof val === "string") {
        resolved[key] = val.replace(/\{(\w+)\}/g, (_, k: string) => inputs[k] ?? `{${k}}`)
      } else {
        resolved[key] = val
      }
    }
    return resolved
  }

  private summarizeResult(result: string, action: string): string {
    if (!result || result.length < 10) return `${action} done`
    try {
      const parsed = JSON.parse(result) as Record<string, unknown>
      if (Array.isArray(parsed)) return `${action}: ${parsed.length} results found`
      if (parsed.title) return `${action}: "${String(parsed.title).slice(0, 50)}"`
      return `${action} done`
    } catch {
      return result.slice(0, 100)
    }
  }
}

/** Singleton instance */
export const recipeEngine = new RecipeEngine()
