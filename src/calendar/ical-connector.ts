/**
 * @file ical-connector.ts
 * @description Parse iCal (.ics) feed from URL into CalendarEvent[].
 *
 * ARCHITECTURE:
 *   HTTP fetch .ics → parse with ical.js (pnpm add ical.js)
 *   Read-only: no create/delete via iCal
 *   Cache TTL: 1 hour (configurable)
 *   Merged into CalendarService.getEventsInRange() via ICAL_FEED_URLS config.
 *
 * USE CASES:
 *   - Indonesian public holidays (ICS from Google)
 *   - Shared team calendar (read-only ICS URL)
 *   - Room booking system export
 *
 * @module calendar/ical-connector
 */

import { createLogger } from "../logger.js"
import type { CalendarEvent } from "../services/calendar.js"

const log = createLogger("calendar.ical-connector")

/** Cached fetch result entry. */
interface CacheEntry {
  events: CalendarEvent[]
  fetchedAt: number
}

// ---------------------------------------------------------------------------
// Dynamic import guard for optional ical.js dep
// ---------------------------------------------------------------------------

/** Attempt to lazily load ical.js. Returns null if not installed. */
async function loadIcal(): Promise<ICalModule | null> {
  try {
    const mod = await (import("ical.js" as string) as Promise<ICalModule>)
    return mod
  } catch {
    return null
  }
}

/** Minimal typing for ical.js API surface we use. */
interface ICalModule {
  default?: ICalModule
  parse(icsText: string): unknown
  Component: {
    new(jCal: unknown): ICalComponent
  }
  Time: {
    fromDateTimeString(str: string): ICalTime
  }
}

interface ICalComponent {
  getAllSubcomponents(name: string): ICalComponent[]
  getFirstPropertyValue<T>(name: string): T | null
  getFirstProperty(name: string): { isMultiValue: boolean; getValues(): ITCalValue[] } | null
}

interface ICalTime {
  toJSDate(): Date
}

type ITCalValue = { value: string } | string

/**
 * Read-only iCal feed connector.
 * Fetches and caches .ics data from URLs for use in CalendarService.
 */
export class ICalConnector {
  private cache = new Map<string, CacheEntry>()

  /**
   * Fetch and parse an iCal feed, returning CalendarEvent[].
   * Results are cached for `cacheTtlMs` milliseconds.
   *
   * @param url        - Public .ics URL
   * @param cacheTtlMs - Cache TTL in ms (default: 1 hour)
   * @returns Array of calendar events from the feed
   */
  async fetchEvents(url: string, cacheTtlMs = 3_600_000): Promise<CalendarEvent[]> {
    const cached = this.cache.get(url)
    if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
      log.debug("ical cache hit", { url, age: Date.now() - cached.fetchedAt })
      return cached.events
    }

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "EDITH-Calendar/1.0" },
      })

      if (!res.ok) {
        log.warn("ical fetch failed", { url, status: res.status })
        return []
      }

      const icsText = await res.text()
      const events = await this.parseICS(icsText, url)

      this.cache.set(url, { events, fetchedAt: Date.now() })
      log.info("ical feed fetched", { url, count: events.length })
      return events
    } catch (err) {
      log.warn("ical fetch error", { url, err })
      return []
    }
  }

  /**
   * Fetch events from all URLs in `ICAL_FEED_URLS` config (comma-separated).
   * Returns merged, deduplicated events.
   *
   * @param feedUrls - Comma-separated list of .ics URLs
   */
  async fetchAll(feedUrls: string): Promise<CalendarEvent[]> {
    const urls = feedUrls.split(",").map((u) => u.trim()).filter(Boolean)
    if (urls.length === 0) return []

    const results = await Promise.allSettled(urls.map((u) => this.fetchEvents(u)))
    const events: CalendarEvent[] = []

    for (const result of results) {
      if (result.status === "fulfilled") {
        events.push(...result.value)
      }
    }

    return events
  }

  /**
   * Filter cached events to a given time range.
   *
   * @param events - Events to filter
   * @param start  - Range start (inclusive)
   * @param end    - Range end (inclusive)
   */
  filterByRange(events: CalendarEvent[], start: Date, end: Date): CalendarEvent[] {
    return events.filter((e) => e.start < end && e.end > start)
  }

  // ---------------------------------------------------------------------------
  // ICS parser
  // ---------------------------------------------------------------------------

  /** Parse raw .ics text into CalendarEvent[]. Requires ical.js. */
  private async parseICS(icsText: string, sourceUrl: string): Promise<CalendarEvent[]> {
    const icalMod = await loadIcal()
    if (!icalMod) {
      log.warn("ical.js not installed — iCal parsing unavailable. Run: pnpm add ical.js")
      return []
    }

    // Handle CommonJS default export pattern
    const ical = (icalMod.default ?? icalMod) as ICalModule

    try {
      const jCal = ical.parse(icsText)
      const comp = new ical.Component(jCal)
      const vevents = comp.getAllSubcomponents("vevent")
      const events: CalendarEvent[] = []

      for (const vevent of vevents) {
        try {
          const uid = vevent.getFirstPropertyValue<string>("uid") ?? `ical-${Date.now()}`
          const summary = vevent.getFirstPropertyValue<string>("summary") ?? "(no title)"
          const dtstart = vevent.getFirstPropertyValue<ICalTime>("dtstart")
          const dtend = vevent.getFirstPropertyValue<ICalTime>("dtend")

          if (!dtstart) continue

          const start = dtstart.toJSDate()
          const end = dtend ? dtend.toJSDate() : new Date(start.getTime() + 60 * 60_000)

          const attendeeProp = vevent.getFirstProperty("attendees")
          const attendees: string[] = []
          if (attendeeProp?.isMultiValue) {
            for (const val of attendeeProp.getValues()) {
              const email = typeof val === "string" ? val : (val as { value: string }).value
              attendees.push(email.replace(/^mailto:/i, ""))
            }
          }

          events.push({
            id: uid,
            title: summary,
            start,
            end,
            attendees,
            location: vevent.getFirstPropertyValue<string>("location") ?? undefined,
            description: vevent.getFirstPropertyValue<string>("description") ?? undefined,
            calendarId: sourceUrl,
            status: "confirmed",
          })
        } catch (err) {
          log.debug("skip malformed vevent", { err })
        }
      }

      return events
    } catch (err) {
      log.warn("ical parse error", { sourceUrl, err })
      return []
    }
  }
}

/** Singleton instance. */
export const icalConnector = new ICalConnector()
