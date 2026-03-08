/**
 * @file browser-skill.ts
 * @description Browser skill wrapper for EDITH skill system.
 *
 * ARCHITECTURE:
 *   Implements the Skill interface from src/skills/manager.ts.
 *   Registered in SkillManager at startup.
 *   Checks RecipeEngine first for known sites, falls back to freeform browserTool.
 *
 * INTENTS HANDLED:
 *   - web_navigation:  "buka/pergi ke [URL]"
 *   - web_research:    "cari/compare [topik] di [sumber]"
 *   - web_form:        "isi form / book / daftar di [situs]"
 *   - web_extract:     "ambil data dari [URL]"
 *   - web_recipe:      "jalankan recipe [nama]"
 *
 * TRIGGER: RegExp matching common web navigation + research patterns.
 *
 * WIRED via:
 *   src/core/startup.ts or wherever skillManager.register() is called.
 *
 * @module skills/browser-skill
 */

import { createLogger } from "../logger.js"
import type { Skill } from "./manager.js"
import { recipeEngine } from "../browser/recipe-engine.js"
import { researchAgent } from "../browser/research-agent.js"
import { browserTool } from "../agents/tools/browser.js"

const log = createLogger("skills.browser")

/** Extract a URL from an intent string. Returns null if none found. */
function extractUrl(intent: string): string | null {
  const match = intent.match(/https?:\/\/\S+/)
  return match ? match[0] ?? null : null
}

/** Extract multiple URLs or quoted site names from an intent string. */
function extractSources(intent: string): string[] {
  const urls = intent.match(/https?:\/\/\S+/g) ?? []
  return urls
}

export const browserSkill: Skill = {
  name: "browser",
  description:
    "Navigate web, fill forms, research, extract data from websites. Use for: cari di internet, buka URL, book tiket/hotel, compare harga, ambil data dari situs.",
  trigger:
    /(?:buka|pergi ke|navigate to|open)\s+https?:\/\/\S+|(?:cari|search|google|googling|research|compare|bandingkan)\s+.{3,}(?:\s+di\s+(?:web|google|internet|situs|tokopedia|shopee|traveloka|kai))?|(?:book|pesan|beli)\s+(?:tiket|hotel|produk|item)|(?:ambil|extract|scrape)\s+(?:data|info|harga)\s+(?:dari|from)\s+\S+/i,

  execute: async (input: string, _userId: string): Promise<string> => {
    log.info("browser skill invoked", { intent: input.slice(0, 80) })

    // 1. Load user-defined recipes (lazy)
    await recipeEngine.loadUserRecipes()

    // 2. Try recipe match first
    const recipe = recipeEngine.findRecipe(input)
    if (recipe) {
      log.info("recipe matched", { recipeId: recipe.id, recipeName: recipe.name })
      return recipeEngine.execute(recipe, {})
    }

    // 3. Multi-source research intent
    const isResearch = /(?:compare|bandingkan|cari di|research|banding)\b/i.test(input)
    const sources = extractSources(input)
    if (isResearch && sources.length > 1) {
      const result = await researchAgent.research({
        query: input,
        sources,
        extractSchema: "listings",
      })
      return [result.synthesis, "", ...result.citations].join("\n")
    }

    // 4. Direct URL navigation
    const url = extractUrl(input)
    if (url) {
      const executeFn = browserTool.execute
      if (!executeFn) return "Browser tool execute is not available."
      const result = await (executeFn as (args: Record<string, unknown>) => Promise<string>)(
        { action: "navigate", url },
      )
      return typeof result === "string" ? result : JSON.stringify(result)
    }

    // 5. Generic research (no URLs — Google search)
    // Extract search query from intent
    const queryMatch = input.match(/(?:cari|search|google|googling|research)\s+(.+?)(?:\s+di\s+\S+)?$/i)
    const query = queryMatch?.[1]?.trim() ?? input.trim()
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`
    const executeFn = browserTool.execute
    if (!executeFn) return "Browser tool execute is not available."
    const result = await (executeFn as (args: Record<string, unknown>) => Promise<string>)(
      { action: "navigate", url: searchUrl },
    )
    return typeof result === "string" ? result : JSON.stringify(result)
  },
}
