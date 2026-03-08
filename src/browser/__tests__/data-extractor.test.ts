/**
 * DataExtractor — structured data extraction from page content via LLM.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { DataExtractor } from "../data-extractor.js"

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

import { orchestrator } from "../../engines/orchestrator.js"

const mockGenerate = vi.mocked(orchestrator.generate)

const makePage = (bodyText: string, title = "Test Page") => ({
  evaluate: vi.fn().mockResolvedValue(bodyText),
  title: vi.fn().mockResolvedValue(title),
})

describe("DataExtractor.extract()", () => {
  const extractor = new DataExtractor()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("prices schema → returns array of price objects", async () => {
    const priceData = [
      { name: "ASUS ROG", price: "14999000", currency: "IDR", available: true },
      { name: "Lenovo Legion", price: "13999000", currency: "IDR", available: true },
    ]
    mockGenerate.mockResolvedValue(JSON.stringify(priceData))
    const page = makePage("ASUS ROG Rp 14.999.000 Lenovo Legion Rp 13.999.000")

    const result = await extractor.extract(page as never, "prices")
    expect(result).toHaveLength(2)
    expect((result[0] as { name: string }).name).toBe("ASUS ROG")
  })

  it("table schema → returns header and rows", async () => {
    const tableData = [{ header: ["Kereta", "Jam", "Harga"], rows: [["Parahyangan", "07:00", "150000"]] }]
    mockGenerate.mockResolvedValue(JSON.stringify(tableData))
    const page = makePage("Kereta Parahyangan berangkat 07:00 harga 150000")

    const result = await extractor.extract(page as never, "table")
    expect(result[0]).toHaveProperty("header")
    expect((result[0] as { rows: string[][] }).rows).toHaveLength(1)
  })

  it("article schema → wraps single object in array", async () => {
    const article = { title: "News", author: "EDITH", date: "2024-01-01", body: "content", tags: [] }
    mockGenerate.mockResolvedValue(JSON.stringify(article))
    const page = makePage("News by EDITH on 2024-01-01")

    const result = await extractor.extract(page as never, "article")
    expect(result).toHaveLength(1)
    expect((result[0] as { title: string }).title).toBe("News")
  })

  it("listings schema → returns array of listing objects", async () => {
    const listings = [
      { title: "Product A", description: "desc", url: "https://a.com", metadata: {} },
      { title: "Product B", description: "desc", url: "https://b.com", metadata: {} },
    ]
    mockGenerate.mockResolvedValue(JSON.stringify(listings))
    const page = makePage("Product A desc Product B desc")

    const result = await extractor.extract(page as never, "listings")
    expect(result).toHaveLength(2)
  })

  it("LLM returns empty array → returns []", async () => {
    mockGenerate.mockResolvedValue("[]")
    const page = makePage("page with no structured data")

    const result = await extractor.extract(page as never, "prices")
    expect(result).toHaveLength(0)
  })

  it("LLM error → returns [] without throwing", async () => {
    mockGenerate.mockRejectedValue(new Error("engine failure"))
    const page = makePage("some page")

    const result = await extractor.extract(page as never, "prices")
    expect(result).toHaveLength(0)
  })

  it("custom schema uses customPrompt in extraction", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify([{ found: true }]))
    const page = makePage("some page content")

    await extractor.extract(page as never, "custom", "extract all phone numbers")
    const prompt = mockGenerate.mock.calls[0]?.[1]?.prompt ?? ""
    expect(prompt).toContain("extract all phone numbers")
  })

  it("strips markdown code fence from LLM response", async () => {
    mockGenerate.mockResolvedValue("```json\n[{\"ok\":true}]\n```")
    const page = makePage("content")

    const result = await extractor.extract(page as never, "listings")
    expect((result[0] as { ok: boolean }).ok).toBe(true)
  })
})
