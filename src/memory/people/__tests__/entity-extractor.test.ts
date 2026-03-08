/**
 * @file entity-extractor.test.ts
 * @description Unit tests for PeopleEntityExtractor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../config.js", () => ({
  default: {
    PEOPLE_EXTRACTION_ENABLED: true,
  },
}))

vi.mock("../../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

import { orchestrator } from "../../../engines/orchestrator.js"
import { PeopleEntityExtractor } from "../entity-extractor.js"

const mockGenerate = vi.mocked(orchestrator.generate)

describe("PeopleEntityExtractor", () => {
  let extractor: PeopleEntityExtractor

  beforeEach(() => {
    extractor = new PeopleEntityExtractor()
    vi.clearAllMocks()
  })

  it("returns empty refs for short messages", async () => {
    const result = await extractor.extract("ok")
    expect(result.refs).toHaveLength(0)
  })

  it("returns empty refs when extraction is disabled", async () => {
    vi.doMock("../../config.js", () => ({
      default: { PEOPLE_EXTRACTION_ENABLED: false },
    }))
    const result = await extractor.extract("I had a meeting with Alice today at work")
    expect(result.refs).toHaveLength(0)
  })

  it("parses LLM JSON into refs", async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify([
        {
          name: "Alice",
          relationship: "colleague",
          context: "work",
          topic: "project deadline",
          sentiment: "neutral",
          snippet: "Alice is handling the deployment",
        },
      ]),
    )

    const result = await extractor.extract(
      "I talked with Alice about the deployment deadline",
    )
    expect(result.refs).toHaveLength(1)
    expect(result.refs[0].name).toBe("Alice")
    expect(result.refs[0].relationship).toBe("colleague")
    expect(result.refs[0].sentiment).toBe("neutral")
  })

  it("strips markdown code fence from LLM output", async () => {
    mockGenerate.mockResolvedValue(
      '```json\n[{"name":"Bob","relationship":"friend","context":"personal","sentiment":"positive","snippet":"Bob helped me"}]\n```',
    )

    const result = await extractor.extract("Bob helped me out this weekend")
    expect(result.refs).toHaveLength(1)
    expect(result.refs[0].name).toBe("Bob")
  })

  it("returns empty refs on malformed JSON", async () => {
    mockGenerate.mockResolvedValue("this is not json")
    const result = await extractor.extract("I met with someone important today at the office")
    expect(result.refs).toHaveLength(0)
  })

  it("handles LLM errors gracefully", async () => {
    mockGenerate.mockRejectedValue(new Error("LLM unavailable"))
    const result = await extractor.extract(
      "I had a meeting with Carol about the budget",
    )
    expect(result.refs).toHaveLength(0)
  })

  it("attaches messageId to result", async () => {
    mockGenerate.mockResolvedValue("[]")
    const result = await extractor.extract("hello world testing the extraction module", "msg-123")
    expect(result.messageId).toBe("msg-123")
  })
})
