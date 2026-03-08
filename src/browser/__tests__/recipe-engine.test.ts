/**
 * RecipeEngine — intent matching, recipe execution, user recipe persistence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { RecipeEngine, type Recipe } from "../recipe-engine.js"

// Mock browserTool so recipe execution doesn't open a real browser
vi.mock("../../agents/tools/browser.js", () => ({
  browserTool: {
    execute: vi.fn().mockResolvedValue(JSON.stringify({ title: "Result", url: "https://example.com", elements: [], content: "", timestamp: Date.now() })),
  },
}))

describe("RecipeEngine.findRecipe()", () => {
  const engine = new RecipeEngine()

  it("matches 'cari kereta Bandung' to kereta-api recipe", () => {
    const recipe = engine.findRecipe("cari kereta Bandung dari Jakarta besok")
    expect(recipe).not.toBeNull()
    expect(recipe?.id).toBe("kereta-api")
  })

  it("matches 'book hotel Bali' to traveloka-hotel recipe", () => {
    const recipe = engine.findRecipe("book hotel Bali bulan depan")
    expect(recipe).not.toBeNull()
    expect(recipe?.id).toBe("traveloka-hotel")
  })

  it("matches 'cari di google' to google-search recipe", () => {
    const recipe = engine.findRecipe("cari di google: cara masak rendang")
    expect(recipe).not.toBeNull()
    expect(recipe?.id).toBe("google-search")
  })

  it("matches 'tokopedia' to tokopedia-search recipe", () => {
    const recipe = engine.findRecipe("cari laptop gaming di tokopedia")
    expect(recipe).not.toBeNull()
    expect(recipe?.id).toBe("tokopedia-search")
  })

  it("returns null for unknown intent", () => {
    const recipe = engine.findRecipe("bagaimana cuaca hari ini di Jakarta Selatan?")
    expect(recipe).toBeNull()
  })

  it("case-insensitive matching", () => {
    const recipe = engine.findRecipe("CARI KERETA JAKARTA BANDUNG")
    expect(recipe).not.toBeNull()
    expect(recipe?.id).toBe("kereta-api")
  })

  it("partial word match works", () => {
    const recipe = engine.findRecipe("tiket kereta api besok pagi")
    expect(recipe?.id).toBe("kereta-api")
  })
})

describe("RecipeEngine.listRecipes()", () => {
  it("returns at least 4 built-in recipes", () => {
    const engine = new RecipeEngine()
    const list = engine.listRecipes()
    expect(list.length).toBeGreaterThanOrEqual(4)
  })

  it("each recipe has required fields", () => {
    const engine = new RecipeEngine()
    for (const r of engine.listRecipes()) {
      expect(r.id).toBeDefined()
      expect(r.name).toBeDefined()
      expect(r.trigger.length).toBeGreaterThan(0)
      expect(r.steps.length).toBeGreaterThan(0)
    }
  })
})

describe("RecipeEngine.execute()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("executes recipe steps and returns summary string", async () => {
    const engine = new RecipeEngine()
    const recipe = engine.findRecipe("cari kereta Bandung")!
    const result = await engine.execute(recipe, { from: "Jakarta", to: "Bandung", date: "2024-03-15" })
    expect(result).toContain(recipe.name)
  })

  it("substitutes {placeholder} in step params", async () => {
    const { browserTool } = await import("../../agents/tools/browser.js")
    const mockExecute = vi.mocked(browserTool.execute)

    const engine = new RecipeEngine()
    const customRecipe: Recipe = {
      id: "test-recipe",
      name: "Test Recipe",
      description: "test",
      trigger: ["test placeholders"],
      requiredInputs: ["city"],
      steps: [
        {
          action: "navigate",
          params: { url: "https://example.com/{city}" },
          description: "navigate to city",
        },
      ],
    }
    await engine.execute(customRecipe, { city: "bandung" })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/bandung" }),
    )
  })

  it("stops at confirmRequired step and returns confirmation prompt", async () => {
    const engine = new RecipeEngine()
    const recipe: Recipe = {
      id: "confirm-test",
      name: "Confirm Test",
      description: "test",
      trigger: ["confirm test"],
      requiredInputs: [],
      steps: [
        { action: "navigate", params: { url: "https://a.com" }, description: "Navigate" },
        { action: "click", params: { selector: "#pay" }, confirmRequired: true, description: "Confirm payment" },
        { action: "extract", params: {}, description: "should not reach" },
      ],
    }
    const result = await engine.execute(recipe, {})
    expect(result).toContain("Confirmation required")
    expect(result).not.toContain("should not reach")
  })
})
