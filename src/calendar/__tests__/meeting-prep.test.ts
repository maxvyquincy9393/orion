/**
 * @file meeting-prep.test.ts
 * @description Tests for MeetingPrep — brief compilation, formatting, and graceful fallbacks.
 *
 * Phase 14 — Calendar & Schedule Intelligence
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../../memory/store.js", () => ({
  memory: {
    search: vi.fn(),
  },
}))

vi.mock("../../memory/rag.js", () => ({
  rag: {
    queryKnowledgeBase: vi.fn(),
  },
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

vi.mock("../../config.js", () => ({
  default: {
    GCAL_TIMEZONE: "Asia/Jakarta",
    KNOWLEDGE_BASE_ENABLED: false,
  },
}))

import { MeetingPrep } from "../meeting-prep.js"
import { memory } from "../../memory/store.js"
import { rag } from "../../memory/rag.js"
import { orchestrator } from "../../engines/orchestrator.js"
import config from "../../config.js"

const mockMemory = memory as unknown as { search: ReturnType<typeof vi.fn> }
const mockRag = rag as unknown as { queryKnowledgeBase: ReturnType<typeof vi.fn> }
const mockOrch = orchestrator as unknown as { generate: ReturnType<typeof vi.fn> }
const mockConfig = config as unknown as { KNOWLEDGE_BASE_ENABLED: boolean }

const MEETING_EVENT = {
  id: "evt-001",
  title: "Design Review",
  start: new Date("2026-03-10T09:00:00Z"),
  end: new Date("2026-03-10T10:00:00Z"),
  description: "Review the new UI designs",
  attendees: ["alice@example.com", "bob@example.com"],
  calendarId: "primary",
  status: "confirmed" as const,
}

describe("MeetingPrep.prepareFor()", () => {
  let prep: MeetingPrep

  beforeEach(() => {
    vi.clearAllMocks()
    prep = new MeetingPrep()
    mockMemory.search.mockResolvedValue([])
    mockOrch.generate.mockResolvedValue('["Point A", "Point B", "Point C"]')
  })

  it("returns a valid MeetingBrief with all required fields", async () => {
    const brief = await prep.prepareFor(MEETING_EVENT, "user1")
    expect(brief.eventId).toBe("evt-001")
    expect(brief.title).toBe("Design Review")
    expect(brief.startTime).toBeInstanceOf(Date)
    expect(Array.isArray(brief.attendeeContext)).toBe(true)
    expect(Array.isArray(brief.relatedDocs)).toBe(true)
    expect(Array.isArray(brief.suggestedTalkingPoints)).toBe(true)
    expect(Array.isArray(brief.previousMeetings)).toBe(true)
  })

  it("includes attendee context from memory search", async () => {
    mockMemory.search.mockImplementation(async (_uid: string, query: string) => {
      if (query.includes("alice")) {
        return [{ content: "Alice mentioned the color palette issue last time.", metadata: {} }]
      }
      return []
    })

    const brief = await prep.prepareFor(MEETING_EVENT, "user1")
    const alice = brief.attendeeContext.find((a) => a.identifier === "alice@example.com")
    expect(alice).toBeDefined()
    expect(alice!.lastInteraction).toContain("Alice")
  })

  it("still works when memory returns nothing for attendees", async () => {
    mockMemory.search.mockResolvedValue([])
    const brief = await prep.prepareFor(MEETING_EVENT, "user1")
    expect(brief.attendeeContext).toHaveLength(2)
    expect(brief.attendeeContext[0].lastInteraction).toBeUndefined()
  })

  it("queries knowledge base when KNOWLEDGE_BASE_ENABLED=true", async () => {
    mockConfig.KNOWLEDGE_BASE_ENABLED = true
    mockRag.queryKnowledgeBase.mockResolvedValue(
      "[1] Design System v3.pdf\n[2] UI Spec Draft.md\n",
    )
    mockMemory.search.mockResolvedValue([])

    await prep.prepareFor(MEETING_EVENT, "user1")
    expect(mockRag.queryKnowledgeBase).toHaveBeenCalled()
    mockConfig.KNOWLEDGE_BASE_ENABLED = false // restore
  })

  it("falls back to memory when KB not enabled", async () => {
    mockConfig.KNOWLEDGE_BASE_ENABLED = false
    mockMemory.search.mockResolvedValue([
      { content: "Last meeting notes", metadata: { title: "Design notes" } },
    ])
    const brief = await prep.prepareFor(MEETING_EVENT, "user1")
    expect(mockRag.queryKnowledgeBase).not.toHaveBeenCalled()
    // relatedDocs may have "Design notes" from memory
    expect(brief).toBeDefined()
  })

  it("returns talking points from LLM", async () => {
    mockOrch.generate.mockResolvedValue('["Discuss design tokens", "Accessibility review", "Timeline"]')
    const brief = await prep.prepareFor(MEETING_EVENT, "user1")
    expect(brief.suggestedTalkingPoints).toHaveLength(3)
    expect(brief.suggestedTalkingPoints[0]).toBe("Discuss design tokens")
  })

  it("returns empty talking points when LLM fails", async () => {
    mockOrch.generate.mockRejectedValue(new Error("LLM timeout"))
    const brief = await prep.prepareFor(MEETING_EVENT, "user1")
    expect(brief.suggestedTalkingPoints).toEqual([])
  })

  it("returns empty talking points when LLM returns no JSON array", async () => {
    mockOrch.generate.mockResolvedValue("Sure, here are some ideas:")
    const brief = await prep.prepareFor(MEETING_EVENT, "user1")
    expect(brief.suggestedTalkingPoints).toEqual([])
  })
})

describe("MeetingPrep.formatBrief()", () => {
  it("includes title and time in output", () => {
    const prep = new MeetingPrep()
    const brief = {
      eventId: "ev1",
      title: "Sprint Planning",
      startTime: new Date("2026-03-10T09:00:00Z"),
      attendeeContext: [{ identifier: "alice@example.com", lastInteraction: "Talked about backlog" }],
      relatedDocs: ["sprint-doc.md"],
      suggestedTalkingPoints: ["Capacity planning", "Priority changes"],
      previousMeetings: ["Last sprint we finished 18 points."],
    }

    const formatted = prep.formatBrief(brief)
    expect(formatted).toContain("Sprint Planning")
    expect(formatted).toContain("alice@example.com")
    expect(formatted).toContain("Talked about backlog")
    expect(formatted).toContain("sprint-doc.md")
    expect(formatted).toContain("Capacity planning")
    expect(formatted).toContain("Last sprint")
  })

  it("omits empty sections gracefully", () => {
    const prep = new MeetingPrep()
    const brief = {
      eventId: "ev2",
      title: "Sync",
      startTime: new Date("2026-03-10T14:00:00Z"),
      attendeeContext: [],
      relatedDocs: [],
      suggestedTalkingPoints: [],
      previousMeetings: [],
    }

    const formatted = prep.formatBrief(brief)
    expect(formatted).toContain("Sync")
    expect(formatted).not.toContain("Attendees")
    expect(formatted).not.toContain("Related")
    expect(formatted).not.toContain("Talking points")
  })
})
