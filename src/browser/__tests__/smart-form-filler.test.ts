/**
 * SmartFormFiller — intent→field mapping, field extraction from BrowserObservation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { SmartFormFiller, type FormFieldInfo } from "../smart-form-filler.js"
import type { BrowserObservation } from "../../agents/tools/browser.js"

// Mock the orchestrator — smart-form-filler calls orchestrator.generate()
vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

import { orchestrator } from "../../engines/orchestrator.js"

const mockGenerate = vi.mocked(orchestrator.generate)

const makeObservation = (elements: Partial<BrowserObservation["elements"][0]>[]): BrowserObservation => ({
  title: "Test Page",
  url: "https://example.com",
  content: "",
  elements: elements.map((e, i) => ({
    id: `e${String(i).padStart(2, "0")}`,
    tag: "input",
    text: "",
    role: "textbox",
    ariaLabel: "",
    placeholder: "",
    href: "",
    isVisible: true,
    ...e,
  })),
  timestamp: Date.now(),
})

describe("SmartFormFiller.extractFields()", () => {
  const filler = new SmartFormFiller()

  it("only returns form elements (input, select, textarea)", () => {
    const obs = makeObservation([
      { tag: "input", placeholder: "Search" },
      { tag: "button", text: "Submit" },
      { tag: "a", href: "https://example.com" },
      { tag: "select", ariaLabel: "Country" },
    ])
    const fields = filler.extractFields(obs)
    expect(fields).toHaveLength(2)
    expect(fields.map((f) => f.tag)).toEqual(["input", "select"])
  })

  it("maps ariaLabel as field label", () => {
    const obs = makeObservation([{ tag: "input", ariaLabel: "Email address" }])
    const fields = filler.extractFields(obs)
    expect(fields[0]?.label).toBe("Email address")
  })

  it("falls back to placeholder as label if no ariaLabel", () => {
    const obs = makeObservation([{ tag: "input", ariaLabel: "", placeholder: "Enter your name" }])
    const fields = filler.extractFields(obs)
    expect(fields[0]?.label).toBe("Enter your name")
  })

  it("returns empty array when no form elements on page", () => {
    const obs = makeObservation([{ tag: "p" }, { tag: "h1" }, { tag: "div" }])
    const fields = filler.extractFields(obs)
    expect(fields).toHaveLength(0)
  })

  it("preserves edithId from element", () => {
    const obs = makeObservation([{ tag: "input", id: "e42" }])
    const fields = filler.extractFields(obs)
    expect(fields[0]?.edithId).toBe("e42")
  })
})

describe("SmartFormFiller.plan()", () => {
  const filler = new SmartFormFiller()

  const fields: FormFieldInfo[] = [
    { edithId: "e00", tag: "input", label: "Dari (Origin)", type: "text", required: true },
    { edithId: "e01", tag: "input", label: "Ke (Destination)", type: "text", required: true },
    { edithId: "e02", tag: "input", label: "Tanggal", type: "date", required: true },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns fills from LLM response for ticket booking intent", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      fills: [
        { edithId: "e00", value: "Jakarta", confidence: 0.95 },
        { edithId: "e01", value: "Bandung", confidence: 0.95 },
      ],
      missingInfo: ["date"],
      warnings: [],
    }))

    const plan = await filler.plan("book tiket Bandung dari Jakarta", fields, {})
    expect(plan.fills).toHaveLength(2)
    expect(plan.fills[0]?.value).toBe("Jakarta")
    expect(plan.missingInfo).toContain("date")
  })

  it("returns warning for password fields", async () => {
    const passwordFields: FormFieldInfo[] = [
      { edithId: "e00", tag: "input", label: "Password", type: "password", required: true },
    ]
    mockGenerate.mockResolvedValue(JSON.stringify({
      fills: [],
      missingInfo: [],
      warnings: ["field 'password' detected — beneran mau diisi?"],
    }))

    const plan = await filler.plan("fill password", passwordFields, {})
    expect(plan.warnings.length).toBeGreaterThan(0)
    expect(plan.warnings[0]).toMatch(/password/i)
  })

  it("returns missingInfo when critical fields cannot be derived", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      fills: [],
      missingInfo: ["tanggal keberangkatan"],
      warnings: [],
    }))

    const plan = await filler.plan("book tiket Bandung", fields, {})
    expect(plan.missingInfo).toContain("tanggal keberangkatan")
  })

  it("handles LLM returning code-fenced JSON gracefully", async () => {
    mockGenerate.mockResolvedValue("```json\n{\"fills\":[],\"missingInfo\":[],\"warnings\":[]}\n```")
    const plan = await filler.plan("test", fields, {})
    expect(plan.fills).toHaveLength(0)
  })

  it("returns fallback missingInfo if LLM produces invalid JSON", async () => {
    mockGenerate.mockResolvedValue("this is not json at all")
    const plan = await filler.plan("test", fields, {})
    expect(plan.missingInfo.length).toBeGreaterThan(0)
    expect(plan.fills).toHaveLength(0)
  })

  it("includes context in LLM prompt", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({ fills: [], missingInfo: [], warnings: [] }))
    await filler.plan("test", fields, { email: "user@example.com", name: "Tony" })
    const callArg = mockGenerate.mock.calls[0]?.[1]?.prompt ?? ""
    expect(callArg).toContain("email: user@example.com")
    expect(callArg).toContain("name: Tony")
  })

  it("LLM error → returns fallback plan without throwing", async () => {
    mockGenerate.mockRejectedValue(new Error("LLM unavailable"))
    const plan = await filler.plan("test", fields, {})
    expect(plan.fills).toHaveLength(0)
    expect(plan.missingInfo.length).toBeGreaterThan(0)
  })

  it("empty fields array → returns empty plan", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({ fills: [], missingInfo: [], warnings: [] }))
    const plan = await filler.plan("book hotel", [], {})
    expect(plan.fills).toHaveLength(0)
  })

  it("confidence from LLM is preserved in fills", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({
      fills: [{ edithId: "e00", value: "Jakarta", confidence: 0.75 }],
      missingInfo: [],
      warnings: [],
    }))
    const plan = await filler.plan("test", fields, {})
    expect(plan.fills[0]?.confidence).toBe(0.75)
  })

  it("plan is called with 'fast' task type", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({ fills: [], missingInfo: [], warnings: [] }))
    await filler.plan("test", fields, {})
    expect(mockGenerate).toHaveBeenCalledWith("fast", expect.any(Object))
  })

  it("textarea tag is treated as form field", () => {
    const obs = makeObservation([{ tag: "textarea", placeholder: "Notes" }])
    const fields2 = filler.extractFields(obs)
    expect(fields2[0]?.tag).toBe("textarea")
  })

  it("select tag is treated as form field", () => {
    const obs = makeObservation([{ tag: "select", ariaLabel: "Country" }])
    const fields2 = filler.extractFields(obs)
    expect(fields2[0]?.tag).toBe("select")
  })
})
