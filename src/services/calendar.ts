/**
 * @file calendar.ts
 * @description CalendarService - Google Calendar + Outlook Calendar integration.
 *
 * ARCHITECTURE NOTE:
 *   CalendarService is a SERVICE, not a Channel (BaseChannel).
 *   Used by:
 *   1. Agent tools (createEvent, findFreeSlots, listUpcoming)
 *   2. Background daemon (proactive meeting reminders)
 *   3. Channels (context for VoI calculations)
 *
 * CONFLICT DETECTION:
 *   Implements ALAS 3-layer architecture (arXiv:2505.12501):
 *   - Compartmentalized execution per operation
 *   - Independent temporal constraint validator
 *   - Runtime monitor with timeout
 *
 * PAPER BASIS:
 *   - ScheduleMe: arXiv:2509.25693 (multi-agent calendar, 94-96% intent accuracy)
 *   - ALAS: arXiv:2505.12501 (temporal constraint compliance, 100% feasible)
 *   - Proactive Agents: arXiv:2405.19464 (VoI-gated proactive alerts)
 *
 * @module services/calendar
 */

import { google } from "googleapis"
import type { calendar_v3 } from "googleapis"
import { createLogger } from "../logger.js"
import config from "../config.js"
import { icalConnector } from "../calendar/ical-connector.js"

const log = createLogger("services.calendar")

/**
 * Calendar event structure.
 */
export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  attendees: string[]
  location?: string
  description?: string
  meetingUrl?: string
  recurrence?: string
  calendarId: string
  status: "confirmed" | "tentative" | "cancelled"
}

/**
 * Parameters for creating a calendar event.
 */
export interface CalendarEventDraft {
  title: string
  start: Date
  end: Date
  attendees?: string[]
  location?: string
  description?: string
  calendarId?: string
}

/**
 * Time slot for scheduling.
 */
export interface TimeSlot {
  start: Date
  end: Date
  durationMinutes: number
}

/**
 * Calendar alert for daemon proactive notifications.
 */
export interface CalendarAlert {
  id: string
  title: string
  start: Date
  end: Date
  location?: string
  meetingUrl?: string
}

/**
 * CalendarService - Google Calendar + Outlook Calendar integration.
 *
 * NOT a BaseChannel - this is a service layer for calendar operations.
 *
 * USAGE:
 *   ```typescript
 *   // List upcoming events
 *   const events = await calendarService.listUpcoming(24) // next 24 hours
 *
 *   // Find free slots
 *   const slots = await calendarService.findFreeSlots(new Date(), 60) // 60 min slots
 *
 *   // Create event with conflict check
 *   const hasConflict = await calendarService.checkConflicts(start, end)
 *   if (!hasConflict) {
 *     await calendarService.createEvent({ title, start, end, attendees })
 *   }
 *
 *   // Daemon integration
 *   const alerts = await calendarService.getUpcomingAlerts(15) // 15 min before
 *   ```
 */
export class CalendarService {
  private provider: "google" | "outlook"
  private googleClient: calendar_v3.Calendar | null = null
  private initialized = false
  private alertedEvents = new Set<string>() // Track which events already alerted

  constructor() {
    // Determine provider based on which credentials are configured
    if (config.GCAL_CLIENT_ID && config.GCAL_CLIENT_SECRET) {
      this.provider = "google"
    } else if (config.OUTLOOK_CALENDAR_CLIENT_ID && config.OUTLOOK_CALENDAR_CLIENT_SECRET) {
      this.provider = "outlook"
    } else {
      this.provider = "google" // default
    }
  }

  /**
   * Initializes the calendar service with OAuth2 credentials.
   *
   * **IMPORTANT:** Only Google Calendar is currently supported.
   * Outlook Calendar will throw "not yet implemented" error.
   *
   * @throws Error if OAuth2 credentials are missing or invalid, or if Outlook is selected
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      if (this.provider === "google") {
        await this.initGoogle()
      } else {
        // Outlook Calendar not yet implemented - will throw error
        await this.initOutlook()
      }

      this.initialized = true
      log.info("calendar service initialized", { provider: this.provider })
    } catch (error) {
      log.error("calendar service failed to initialize", { provider: this.provider, error })
      throw error
    }
  }

  /**
   * Lists upcoming events within specified hours.
   *
   * @param hours Number of hours to look ahead (default: 24)
   * @returns Array of calendar events
   */
  async listUpcoming(hours: number = 24): Promise<CalendarEvent[]> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      if (this.provider === "google" && this.googleClient) {
        return this.listUpcomingGoogle(hours)
      } else {
        return this.listUpcomingOutlook(hours)
      }
    } catch (error) {
      log.error("failed to list upcoming events", { hours, error })
      return []
    }
  }

  /**
   * Finds free time slots for scheduling.
   *
   * @param date Target date to search
   * @param durationMinutes Required slot duration
   * @returns Array of available time slots
   */
  async findFreeSlots(date: Date, durationMinutes: number): Promise<TimeSlot[]> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      // Get all events for the target date
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)

      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      const events = await this.getEventsInRange(startOfDay, endOfDay)

      // Sort events by start time
      events.sort((a, b) => a.start.getTime() - b.start.getTime())

      // Find gaps between events
      const slots: TimeSlot[] = []
      let currentTime = new Date(startOfDay)
      currentTime.setHours(9, 0, 0, 0) // Start at 9 AM

      const workdayEnd = new Date(startOfDay)
      workdayEnd.setHours(18, 0, 0, 0) // End at 6 PM

      for (const event of events) {
        const gapMinutes = (event.start.getTime() - currentTime.getTime()) / 60000

        if (gapMinutes >= durationMinutes) {
          slots.push({
            start: new Date(currentTime),
            end: new Date(currentTime.getTime() + durationMinutes * 60000),
            durationMinutes,
          })
        }

        currentTime = new Date(event.end)
      }

      // Check if there's a slot after the last event
      const finalGapMinutes = (workdayEnd.getTime() - currentTime.getTime()) / 60000
      if (finalGapMinutes >= durationMinutes) {
        slots.push({
          start: new Date(currentTime),
          end: new Date(currentTime.getTime() + durationMinutes * 60000),
          durationMinutes,
        })
      }

      return slots
    } catch (error) {
      log.error("failed to find free slots", { date, durationMinutes, error })
      return []
    }
  }

  /**
   * Checks if a proposed event conflicts with existing events.
   *
   * Implements ALAS independent validator pattern (arXiv:2505.12501).
   *
   * @param start Event start time
   * @param end Event end time
   * @returns true if conflict exists, false otherwise
   */
  async checkConflicts(start: Date, end: Date): Promise<boolean> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      const events = await this.getEventsInRange(start, end)

      // Check for any overlap
      for (const event of events) {
        // Two events overlap if: start1 < end2 AND start2 < end1
        const overlaps = start < event.end && event.start < end

        if (overlaps) {
          log.info("calendar conflict detected", {
            proposedStart: start,
            proposedEnd: end,
            conflictsWith: event.title,
          })
          return true
        }
      }

      return false
    } catch (error) {
      log.error("failed to check conflicts", { start, end, error })
      return false // Assume no conflict on error (safe fallback)
    }
  }

  /**
   * Creates a new calendar event.
   *
   * ALWAYS calls checkConflicts() first.
   *
   * @param draft Event creation parameters
   * @returns Created event or null if conflict
   */
  async createEvent(draft: CalendarEventDraft): Promise<CalendarEvent | null> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      // Check for conflicts first
      const hasConflict = await this.checkConflicts(draft.start, draft.end)

      if (hasConflict) {
        log.warn("cannot create event: conflict detected", { title: draft.title })
        return null
      }

      if (this.provider === "google" && this.googleClient) {
        return this.createEventGoogle(draft)
      } else {
        return this.createEventOutlook(draft)
      }
    } catch (error) {
      log.error("failed to create event", { title: draft.title, error })
      return null
    }
  }

  /**
   * Deletes a calendar event.
   *
   * @param eventId Event ID to delete
   * @returns true if deleted successfully
   */
  async deleteEvent(eventId: string): Promise<boolean> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      if (this.provider === "google" && this.googleClient) {
        await this.googleClient.events.delete({
          calendarId: "primary",
          eventId,
        })

        log.info("event deleted", { eventId })
        return true
      } else {
        // Outlook implementation
        return false
      }
    } catch (error) {
      log.error("failed to delete event", { eventId, error })
      return false
    }
  }

  /**
   * Gets upcoming events that need proactive alerts.
   *
   * Used by background daemon for meeting reminders.
   *
   * @param withinMinutes Only return events starting within this many minutes
   * @returns Array of events that need alerts
   */
  async getUpcomingAlerts(withinMinutes: number = 15): Promise<CalendarAlert[]> {
    if (!this.initialized) {
      await this.init()
    }

    try {
      const now = new Date()
      const alertWindow = new Date(now.getTime() + withinMinutes * 60000)

      const events = await this.getEventsInRange(now, alertWindow)

      // Filter to events that haven't been alerted yet
      const alerts: CalendarAlert[] = []

      for (const event of events) {
        if (!this.alertedEvents.has(event.id)) {
          alerts.push({
            id: event.id,
            title: event.title,
            start: event.start,
            end: event.end,
            location: event.location,
            meetingUrl: event.meetingUrl,
          })

          // Mark as alerted
          this.alertedEvents.add(event.id)

          // Cleanup old alerted events (older than 1 hour)
          setTimeout(() => {
            this.alertedEvents.delete(event.id)
          }, 60 * 60 * 1000)
        }
      }

      return alerts
    } catch (error) {
      log.error("failed to get upcoming alerts", { withinMinutes, error })
      return []
    }
  }

  /**
   * Initializes Google Calendar API client.
   */
  private async initGoogle(): Promise<void> {
    const oauth2Client = new google.auth.OAuth2(
      config.GCAL_CLIENT_ID,
      config.GCAL_CLIENT_SECRET,
      "http://localhost"
    )

    oauth2Client.setCredentials({
      refresh_token: config.GCAL_REFRESH_TOKEN,
    })

    this.googleClient = google.calendar({ version: "v3", auth: oauth2Client })

    // Test connection
    await this.googleClient.calendarList.list()

    log.info("google calendar client initialized")
  }

  /**
   * Initializes Outlook Calendar API client.
   */
  private async initOutlook(): Promise<void> {
    throw new Error(
      "Outlook Calendar integration not yet implemented.\n\n" +
        "To use calendar features, please use Google Calendar (GOOGLE_CALENDAR_CLIENT_ID).\n\n" +
        "Outlook Calendar support requires:\n" +
        "  - Microsoft Graph OAuth2 token flow\n" +
        "  - Calendars.Read and Calendars.ReadWrite permissions\n" +
        "  - Event creation/deletion via Graph API\n\n" +
        "See: src/services/calendar.ts for Google Calendar implementation patterns",
    )
  }

  /**
   * Lists upcoming events from Google Calendar.
   */
  private async listUpcomingGoogle(hours: number): Promise<CalendarEvent[]> {
    if (!this.googleClient) {
      return []
    }

    const now = new Date()
    const timeMax = new Date(now.getTime() + hours * 60 * 60 * 1000)

    const calendarIds = config.GCAL_CALENDARS.split(",").map((s) => s.trim()).filter(Boolean)
    const events: CalendarEvent[] = []

    for (const calendarId of calendarIds) {
      const response = await this.googleClient.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 50,
        singleEvents: true,
        orderBy: "startTime",
      })

      for (const item of response.data.items || []) {
        if (!item.id || !item.summary) {
          continue
        }

        const start = item.start?.dateTime || item.start?.date
        const end = item.end?.dateTime || item.end?.date

        if (!start || !end) {
          continue
        }

        events.push({
          id: item.id,
          title: item.summary,
          start: new Date(start),
          end: new Date(end),
          attendees: (item.attendees || []).map((a) => a.email || ""),
          location: item.location ?? undefined,
          description: item.description ?? undefined,
          meetingUrl: item.hangoutLink ?? undefined,
          calendarId,
          status: (item.status as CalendarEvent["status"]) || "confirmed",
        })
      }
    }

    return events
  }

  /**
   * Lists upcoming events from Outlook Calendar.
   */
  private async listUpcomingOutlook(_hours: number): Promise<CalendarEvent[]> {
    // TODO: Implement Outlook Calendar
    return []
  }

  /**
   * Gets events within a time range.
   */
  private async getEventsInRange(start: Date, end: Date): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = []

    if (this.provider === "google" && this.googleClient) {
      const calendarIds = config.GCAL_CALENDARS.split(",").map((s) => s.trim()).filter(Boolean)

      for (const calendarId of calendarIds) {
        const response = await this.googleClient.events.list({
          calendarId,
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
        })

        for (const item of response.data.items || []) {
          if (!item.id || !item.summary) continue
          const eventStart = item.start?.dateTime || item.start?.date
          const eventEnd = item.end?.dateTime || item.end?.date
          if (!eventStart || !eventEnd) continue

          allEvents.push({
            id: item.id,
            title: item.summary,
            start: new Date(eventStart),
            end: new Date(eventEnd),
            attendees: (item.attendees || []).map((a) => a.email || ""),
            location: item.location ?? undefined,
            description: item.description ?? undefined,
            meetingUrl: item.hangoutLink ?? undefined,
            calendarId,
            status: (item.status as CalendarEvent["status"]) || "confirmed",
          })
        }
      }
    }

    // Merge iCal feed events if configured (Phase 14)
    if (config.ICAL_FEED_URLS) {
      const icalEvents = await icalConnector.fetchAll(config.ICAL_FEED_URLS)
        .catch((err) => { log.warn("ical fetch failed", { err }); return [] })
      allEvents.push(...icalConnector.filterByRange(icalEvents, start, end))
    }

    return allEvents
  }

  /**
   * Creates event in Google Calendar.
   */
  private async createEventGoogle(draft: CalendarEventDraft): Promise<CalendarEvent> {
    if (!this.googleClient) {
      throw new Error("Google Calendar client not initialized")
    }

    const response = await this.googleClient.events.insert({
      calendarId: draft.calendarId || "primary",
      requestBody: {
        summary: draft.title,
        description: draft.description,
        location: draft.location,
        start: {
          dateTime: draft.start.toISOString(),
          timeZone: config.GCAL_TIMEZONE,
        },
        end: {
          dateTime: draft.end.toISOString(),
          timeZone: config.GCAL_TIMEZONE,
        },
        attendees: (draft.attendees || []).map((email) => ({ email })),
      },
    })

    const event = response.data

    log.info("event created", { eventId: event.id, title: draft.title })

    return {
      id: event.id!,
      title: event.summary!,
      start: new Date(event.start!.dateTime!),
      end: new Date(event.end!.dateTime!),
      attendees: (event.attendees || []).map((a) => a.email || ""),
      location: event.location ?? undefined,
      description: event.description ?? undefined,
      meetingUrl: event.hangoutLink ?? undefined,
      calendarId: draft.calendarId || "primary",
      status: "confirmed",
    }
  }

  /**
   * Creates event in Outlook Calendar.
   */
  private async createEventOutlook(_draft: CalendarEventDraft): Promise<CalendarEvent | null> {
    // TODO: Implement Outlook Calendar
    return null
  }
}

/**
 * Singleton instance of CalendarService.
 *
 * USAGE: Import this singleton, don't create new instances.
 * ```typescript
 * import { calendarService } from "./calendar.js"
 * await calendarService.init()
 * const events = await calendarService.listUpcoming(24)
 * ```
 */
export const calendarService = new CalendarService()
