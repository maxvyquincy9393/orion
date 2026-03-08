/**
 * @file calendar.ts
 * @description Calendar tool for agent orchestrator.
 *
 * Provides calendar operations: list events, find free slots, create/delete events.
 *
 * @module agents/tools/calendar
 */

import { tool } from "ai"
import { z } from "zod"
import { calendarService } from "../../services/calendar.js"
import type { CalendarEventDraft } from "../../services/calendar.js"
import { nlDateTimeParser } from "../../calendar/nl-datetime-parser.js"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.calendar")

/**
 * Calendar tool for managing calendar events.
 *
 * Actions:
 * - list: List upcoming events
 * - findSlots: Find available time slots
 * - create: Create new event (with conflict detection)
 * - delete: Delete existing event
 */
export const calendarTool = tool({
  description: "Manage calendar events: list upcoming, find free slots, create/delete events",
  inputSchema: z.object({
    action: z.enum(["list", "findSlots", "create", "delete"]).describe("Calendar action to perform"),
    hours: z.number().optional().describe("Hours to look ahead (for list)"),
    date: z.string().optional().describe("Target date (for findSlots)"),
    duration: z.number().optional().describe("Required slot duration in minutes (for findSlots)"),
    title: z.string().optional().describe("Event title (for create)"),
    start: z.string().optional().describe("Event start time ISO (for create)"),
    end: z.string().optional().describe("Event end time ISO (for create)"),
    attendees: z.array(z.string()).optional().describe("Attendee emails (for create)"),
    location: z.string().optional().describe("Event location (for create)"),
    description: z.string().optional().describe("Event description (for create)"),
    eventId: z.string().optional().describe("Event ID (for delete)"),
  }),
  execute: async (input) => {
    const { action, hours, date, duration, title, start, end, attendees, location, description, eventId } = input
    try {
      // Initialize calendar service if needed
      await calendarService.init()

      switch (action) {
        case "list": {
          const events = await calendarService.listUpcoming(hours || 24)
          return {
            success: true,
            events: events.map((e) => ({
              id: e.id,
              title: e.title,
              start: e.start.toISOString(),
              end: e.end.toISOString(),
              attendees: e.attendees,
              location: e.location,
              meetingUrl: e.meetingUrl,
            })),
          }
        }

        case "findSlots": {
          if (!date || !duration) {
            return { success: false, error: "date and duration required for findSlots" }
          }

          const slots = await calendarService.findFreeSlots(new Date(date), duration)
          return {
            success: true,
            slots: slots.map((s) => ({
              start: s.start.toISOString(),
              end: s.end.toISOString(),
              durationMinutes: s.durationMinutes,
            })),
          }
        }

        case "create": {
          if (!title || !start) {
            return { success: false, error: "title and start required for create" }
          }

          // Phase 14: Parse NL datetime if start is not a valid ISO timestamp
          let startDate: Date
          let endDate: Date | undefined

          const isIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start)
          if (isIso) {
            startDate = new Date(start)
            endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60_000)
          } else {
            const parsed = await nlDateTimeParser.parse(`${start}${end ? ` ${end}` : ""}`)
            startDate = parsed.start
            endDate = parsed.end ?? new Date(startDate.getTime() + 60 * 60_000)
          }

          const draft: CalendarEventDraft = {
            title,
            start: startDate,
            end: endDate,
            attendees,
            location,
            description,
          }

          // Check conflicts first
          const hasConflict = await calendarService.checkConflicts(draft.start, draft.end)
          if (hasConflict) {
            return { success: false, error: "Event conflicts with existing calendar entry" }
          }

          const event = await calendarService.createEvent(draft)
          if (!event) {
            return { success: false, error: "Failed to create event" }
          }

          return {
            success: true,
            event: {
              id: event.id,
              title: event.title,
              start: event.start.toISOString(),
              end: event.end.toISOString(),
              meetingUrl: event.meetingUrl,
            },
          }
        }

        case "delete": {
          if (!eventId) {
            return { success: false, error: "eventId required for delete" }
          }

          const deleted = await calendarService.deleteEvent(eventId)
          return { success: deleted, error: deleted ? undefined : "Failed to delete event" }
        }

        default:
          return { success: false, error: "Unknown calendar action" }
      }
    } catch (error) {
      log.error("calendar tool failed", { action, error })
      return { success: false, error: String(error) }
    }
  },
})
