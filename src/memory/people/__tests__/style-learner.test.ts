/**
 * @file style-learner.test.ts
 * @description Unit tests for StyleLearner.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

vi.mock("../people-graph.js", () => ({
  peopleGraph: {
    getById: vi.fn(),
    getInteractions: vi.fn(),
    updateCommunicationStyle: vi.fn(),
  },
}))

import { orchestrator } from "../../../engines/orchestrator.js"
import { peopleGraph } from "../people-graph.js"
import { StyleLearner } from "../style-learner.js"

const mockGenerate = vi.mocked(orchestrator.generate)
const mockGetById = vi.mocked(peopleGraph.getById)
const mockGetInteractions = vi.mocked(peopleGraph.getInteractions)
const mockUpdateStyle = vi.mocked(peopleGraph.updateCommunicationStyle)

const makePerson = (overrides = {}) => ({
  id: "person-1",
  userId: "user-1",
  name: "Alice",
  aliases: [],
  relationship: "colleague" as const,
  context: "work" as const,
  notes: "",
  interactionCount: 10,
  firstSeen: new Date(),
  lastSeen: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  communicationStyle: undefined,
  ...overrides,
})

const makeInteractions = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `i-${i}`,
    personId: "person-1",
    userId: "user-1",
    date: new Date(),
    type: "mention" as const,
    topic: "project",
    sentiment: "neutral" as const,
    channel: "chat",
    summary: `interaction ${i}`,
    createdAt: new Date(),
  }))

describe("StyleLearner", () => {
  let learner: StyleLearner

  beforeEach(() => {
    learner = new StyleLearner()
    vi.clearAllMocks()
  })

  it("updates style when enough new samples", async () => {
    mockGetById.mockResolvedValue(makePerson({ interactionCount: 10, communicationStyle: undefined }))
    mockGetInteractions.mockResolvedValue(makeInteractions(10))
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        formality: 4,
        greetings: ["Hi"],
        phrases: ["per my last email"],
        emojiUsage: 0,
        language: "en",
        messageLength: "medium",
        responseTime: "fast",
        sampleCount: 10,
      }),
    )
    mockUpdateStyle.mockResolvedValue(undefined)

    await learner.updateStyle("user-1", "person-1")

    expect(mockUpdateStyle).toHaveBeenCalledOnce()
    const callArg = mockUpdateStyle.mock.calls[0][1] as Record<string, unknown>
    expect(callArg.formality).toBe(4)
    expect(callArg.emojiUsage).toBe(0)
  })

  it("skips update when sample count is below minimum", async () => {
    mockGetById.mockResolvedValue(makePerson({ interactionCount: 2 }))

    await learner.updateStyle("user-1", "person-1")
    expect(mockUpdateStyle).not.toHaveBeenCalled()
  })

  it("skips update when not enough new samples since last inference", async () => {
    mockGetById.mockResolvedValue(
      makePerson({
        interactionCount: 7,
        communicationStyle: { sampleCount: 5 } as unknown,
      }),
    )

    await learner.updateStyle("user-1", "person-1")
    expect(mockUpdateStyle).not.toHaveBeenCalled()
  })

  it("rebuildStyle forces update regardless of threshold", async () => {
    mockGetById.mockResolvedValue(makePerson({ interactionCount: 3 }))
    mockGetInteractions.mockResolvedValue(makeInteractions(3))
    mockGenerate.mockResolvedValue(
      JSON.stringify({ formality: 2, greetings: [], phrases: [], emojiUsage: 1, language: "en", messageLength: "short", sampleCount: 3 }),
    )
    mockUpdateStyle.mockResolvedValue(undefined)

    const result = await learner.rebuildStyle("user-1", "person-1")
    expect(result).not.toBeNull()
    expect(mockUpdateStyle).toHaveBeenCalledOnce()
  })

  it("returns null from rebuildStyle when person not found", async () => {
    mockGetById.mockResolvedValue(null)
    const result = await learner.rebuildStyle("user-1", "missing-id")
    expect(result).toBeNull()
  })

  it("uses default style when LLM fails", async () => {
    mockGetById.mockResolvedValue(makePerson({ interactionCount: 10 }))
    mockGetInteractions.mockResolvedValue(makeInteractions(10))
    mockGenerate.mockRejectedValue(new Error("LLM down"))
    mockUpdateStyle.mockResolvedValue(undefined)

    await learner.updateStyle("user-1", "person-1")
    expect(mockUpdateStyle).toHaveBeenCalledOnce()
    const style = mockUpdateStyle.mock.calls[0][1] as Record<string, unknown>
    expect(style.formality).toBe(3) // default value
  })
})
