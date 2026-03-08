/**
 * @file meeting-prep.ts
 * @description Compile a meeting brief from memory + knowledge base.
 *
 * ARCHITECTURE:
 *   Called from daemon.checkCalendarAlerts() after a 15-min alert is sent.
 *   Or: called from calendarTool "prep" action if user requests manual prep.
 *   Queries Phase 13 knowledge base (if KNOWLEDGE_BASE_ENABLED) and memory.
 *
 * OUTPUT FORMAT:
 *   📋 Brief: {title} ({time})
 *   👥 Attendees: name + last interaction
 *   📝 Related: notes/docs relevant to meeting topic
 *   ⚡ Talking points: LLM-generated suggestions
 *
 * @module calendar/meeting-prep
 */

import { memory } from "../memory/store.js"
import { rag } from "../memory/rag.js"
import { orchestrator } from "../engines/orchestrator.js"
import config from "../config.js"
import type { CalendarEvent } from "../services/calendar.js"

/** Context about a single attendee. */
export interface AttendeeContext {
  /** Email or display name. */
  identifier: string
  /** Human-readable last interaction description. */
  lastInteraction?: string
  /** Unresolved items from memory. */
  openItems?: string[]
}

/** Full meeting brief. */
export interface MeetingBrief {
  eventId: string
  title: string
  startTime: Date
  attendeeContext: AttendeeContext[]
  relatedDocs: string[]
  suggestedTalkingPoints: string[]
  previousMeetings: string[]
}

/**
 * Compiles and formats meeting briefs.
 */
export class MeetingPrep {
  /**
   * Prepare a brief for an upcoming meeting.
   *
   * @param event  - Calendar event to prepare for
   * @param userId - User ID for memory & KB queries
   */
  async prepareFor(event: CalendarEvent, userId: string): Promise<MeetingBrief> {
    const [attendeeContext, relatedDocs, previousMeetings] = await Promise.all([
      this.buildAttendeeContext(event.attendees, userId),
      this.findRelatedDocs(event.title, userId),
      this.findPreviousMeetings(event.title, userId),
    ])

    const suggestedTalkingPoints = await this.generateTalkingPoints(
      event,
      attendeeContext,
      previousMeetings,
    )

    return {
      eventId: event.id,
      title: event.title,
      startTime: event.start,
      attendeeContext,
      relatedDocs,
      suggestedTalkingPoints,
      previousMeetings,
    }
  }

  /**
   * Format a brief as a readable string for channel delivery.
   */
  formatBrief(brief: MeetingBrief): string {
    const timeStr = brief.startTime.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: config.GCAL_TIMEZONE,
    })

    const lines: string[] = [
      `📋 **Brief: ${brief.title}** (${timeStr})`,
    ]

    if (brief.attendeeContext.length > 0) {
      lines.push("\n👥 **Attendees:**")
      for (const a of brief.attendeeContext) {
        lines.push(`  • ${a.identifier}${a.lastInteraction ? ` — ${a.lastInteraction}` : ""}`)
        for (const item of a.openItems ?? []) {
          lines.push(`    ↳ ${item}`)
        }
      }
    }

    if (brief.relatedDocs.length > 0) {
      lines.push("\n📄 **Related:**")
      for (const doc of brief.relatedDocs) {
        lines.push(`  • ${doc}`)
      }
    }

    if (brief.previousMeetings.length > 0) {
      lines.push("\n🕐 **Previous:** " + brief.previousMeetings.slice(0, 3).join("; "))
    }

    if (brief.suggestedTalkingPoints.length > 0) {
      lines.push("\n⚡ **Talking points:**")
      brief.suggestedTalkingPoints.forEach((pt, i) => {
        lines.push(`  ${i + 1}. ${pt}`)
      })
    }

    return lines.join("\n")
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async buildAttendeeContext(
    attendees: string[],
    userId: string,
  ): Promise<AttendeeContext[]> {
    const result: AttendeeContext[] = []

    for (const identifier of attendees.slice(0, 5)) {
      try {
        const searchResults = await memory.search(userId, identifier, 3)
        const lastInteraction = searchResults[0]?.content
          ? `${searchResults[0].content.slice(0, 80).trimEnd()}…`
          : undefined

        result.push({ identifier, lastInteraction })
      } catch {
        result.push({ identifier })
      }
    }

    return result
  }

  private async findRelatedDocs(title: string, userId: string): Promise<string[]> {
    try {
      if (config.KNOWLEDGE_BASE_ENABLED) {
        const kbResult = await rag.queryKnowledgeBase(userId, title, 3)
        if (kbResult) {
          // Extract source names from the formatted result lines
          const sources = kbResult
            .split("\n")
            .filter((l) => l.startsWith("["))
            .map((l) => l.replace(/^\[\d+\]\s*/, "").split("\n")[0])
            .slice(0, 3)
          if (sources.length > 0) return sources
        }
      }

      const memResults = await memory.search(userId, title, 3)
      return memResults
        .map((r) => String(r.metadata?.title ?? r.metadata?.source ?? ""))
        .filter(Boolean)
        .slice(0, 3)
    } catch {
      return []
    }
  }

  private async findPreviousMeetings(title: string, userId: string): Promise<string[]> {
    try {
      const results = await memory.search(userId, `meeting ${title}`, 3)
      return results
        .map((r) => r.content.slice(0, 80).trimEnd())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  private async generateTalkingPoints(
    event: CalendarEvent,
    attendees: AttendeeContext[],
    previousMeetings: string[],
  ): Promise<string[]> {
    try {
      const context = [
        `Meeting: ${event.title}`,
        event.description ? `Agenda: ${event.description.slice(0, 200)}` : "",
        attendees.length > 0
          ? `Attendees: ${attendees.map((a) => a.identifier).join(", ")}`
          : "",
        previousMeetings.length > 0
          ? `Previous context: ${previousMeetings[0]?.slice(0, 150)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")

      const prompt =
        `Generate 3 concise talking points for this meeting. Return as JSON array of strings:\n${context}`

      const raw = await orchestrator.generate("fast", { prompt })
      const match = raw.match(/\[[\s\S]*?\]/)
      if (!match) return []

      const parsed = JSON.parse(match[0]) as string[]
      return parsed.slice(0, 3)
    } catch {
      return []
    }
  }
}

/** Singleton instance. */
export const meetingPrep = new MeetingPrep()
