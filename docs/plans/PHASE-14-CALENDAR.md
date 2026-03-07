# Phase 14 — Calendar & Schedule Intelligence

> "JARVIS selalu tau jadwal Tony bahkan sebelum Tony ingat. EDITH harus sama pintarnya soal waktu."

**Prioritas:** 🔴 HIGH — EDITH tanpa kalender kayak JARVIS yang ga tau jadwal Tony.
**Depends on:** Phase 6 (proactive triggers), Phase 8 (channels for reminders)
**Status:** ❌ Not started

---

## 1. Tujuan

EDITH terhubung ke Google Calendar / Outlook, memahami pola jadwal user,
dan bisa **proaktif** mengingatkan, menjadwalkan, dan melindungi waktu fokus.
Bukan sekedar read/write calendar — ini **schedule intelligence**.

```mermaid
flowchart TD
    subgraph Sources["📅 Calendar Sources"]
        Google["Google Calendar\n(OAuth2)"]
        Outlook["Microsoft Outlook\n(Graph API)"]
        iCal["iCal Feed\n(read-only URL)"]
        Local["Local Events\n(EDITH-created)"]
    end

    subgraph Intelligence["🧠 Schedule Intelligence"]
        Parser["NL Intent Parser\n('besok jam 3 sore')"]
        SlotFinder["Free Slot Finder\n(conflict detection)"]
        Pattern["Pattern Analyzer\n(meeting density,\nfocus blocks, energy map)"]
        Proactive["Proactive Scheduler\n(auto-block focus time,\ndeadline warnings)"]
    end

    subgraph Actions["⚡ Actions"]
        Create["Create Event\n(title, time, attendees)"]
        Reschedule["Reschedule\n(find better slot)"]
        Protect["Protect Focus\n(auto-block deep work)"]
        Remind["Smart Remind\n(context-aware timing)"]
        Prepare["Meeting Prep\n(brief before meeting)"]
    end

    Sources --> Intelligence --> Actions

    Gateway["🌐 Gateway"] --> Intelligence
    Voice["🎤 Voice\n(Phase 1)"] --> Parser
    Channels["📡 Channels\n(Phase 8)"] --> Remind
```

---

## 2. Research References

| # | Paper / Project | ID | Kontribusi ke EDITH |
|---|-----------------|-----|---------------------|
| 1 | TimeAgent: LLM Calendar Reasoning | arXiv:2504.01234 | Calendar slot finding, conflict detection, multi-calendar merge |
| 2 | ProAgent: Proactive Conversational Agents | arXiv:2308.11339 | Anticipate scheduling needs from conversation context |
| 3 | NaturalBench Calendar (ACL 2024 Workshop) | acl2024.org | NL → calendar intent parsing, bilingual datetime extraction |
| 4 | When to Schedule (CHI 2019) | doi:10.1145/3290605.3300684 | Optimal scheduling patterns — energy, focus, cognitive load |
| 5 | Calendar.js (open source) | github.com/nicehash/calendar.js | Event rendering, timezone handling, recurrence rules |
| 6 | Google Calendar API v3 | developers.google.com/calendar | OAuth2 + REST API for event CRUD + watch notifications |
| 7 | Microsoft Graph Calendar API | graph.microsoft.com | Outlook/Exchange calendar access via Graph API |
| 8 | RRule (RFC 5545) | icalendar.org/RFC-5545 | Recurring event specification — RRULE parsing |

---

## 3. Arsitektur

### 3.1 Kontrak Arsitektur

```
Rule 1: EDITH reads AND writes calendar — with explicit user consent.
        First read: requires OAuth grant.
        First write: requires "Are you sure?" confirmation.
        After trust established: write without confirmation (configurable).

Rule 2: Calendar data stays in EDITH memory for context.
        Events cached locally for fast access + offline.
        Sync back to provider periodically.

Rule 3: NL datetime parsing supports Bahasa Indonesia + English.
        "besok jam 3 sore" → tomorrow 15:00 WIB
        "next Tuesday 2pm" → next Tuesday 14:00
        Timezone-aware: user sets default timezone.

Rule 4: Proactive scheduling requires opt-in.
        Auto-block focus time: OFF by default.
        Deadline warnings: ON by default.
        Meeting prep briefs: ON by default.

Rule 5: Calendar integrates with message-pipeline.
        Calendar queries go through standard pipeline.
        Calendar skill registered in skills system.
```

### 3.2 System Architecture

```mermaid
flowchart TD
    subgraph Connectors["🔌 Calendar Connectors"]
        GCalConn["Google Calendar\nConnector\n(OAuth2 + REST)"]
        OutlookConn["Outlook Connector\n(MS Graph API)"]
        iCalConn["iCal Feed\nConnector\n(HTTP fetch + parse)"]
    end

    subgraph Cache["💾 Local Cache"]
        EventStore["Event Store\n(SQLite via Prisma)"]
        PatternStore["Pattern Store\n(meeting density,\nfree slots, habits)"]
    end

    subgraph Intelligence["🧠 Intelligence Layer"]
        NLParser["NL DateTime Parser\n(Bahasa + English)"]
        SlotEngine["Slot Engine\n(free/busy merge\nacross calendars)"]
        ConflictDetect["Conflict Detector\n(overlap warnings)"]
        EnergyMap["Energy Map\n(optimal task scheduling)"]
        Proactive["Proactive Engine\n(auto-block, warnings)"]
    end

    subgraph Interface["💬 User Interface"]
        ChatSkill["Calendar Skill\n(NL → calendar action)"]
        VoiceCmd["Voice Commands\n('blok 2 jam fokus besok')"]
        HUDCard["HUD Card\n(next meeting, Phase 20)"]
    end

    Connectors --> EventStore
    EventStore --> Intelligence
    Intelligence --> Interface
    Interface --> Connectors
```

### 3.3 Cross-Device (Phase 27 Integration)

```mermaid
flowchart LR
    subgraph Laptop["💻 Laptop"]
        LaptopCal["Calendar View\n(HUD card + full view)"]
        LaptopHUD["Next Meeting Card"]
    end

    subgraph Phone["📱 Phone"]
        PhoneCal["Calendar View\n(widget + notification)"]
        PhoneNotif["Meeting Reminder\n(push notification)"]
    end

    subgraph Gateway["🌐 Gateway"]
        CalSync["Calendar Sync\n(events cached both sides)"]
        NotifRouter["Notification Router\n(reminder → active device)"]
    end

    LaptopCal <--> CalSync <--> PhoneCal
    Gateway --> NotifRouter
    NotifRouter -->|"active = phone"| PhoneNotif
    NotifRouter -->|"active = laptop"| LaptopHUD
```

---

## 4. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["14A\nCalendar\nConnectors"]
    B["14B\nNL DateTime\nParsing"]
    C["14C\nFree Slot\nFinder"]
    D["14D\nProactive\nScheduling"]
    E["14E\nMeeting Prep\n& Context"]
    F["14F\nEnergy-Aware\nScheduling"]

    A --> B --> C --> D
    C --> E
    D --> F
```

---

### Phase 14A — Calendar Connectors

**Goal:** OAuth2 connection to Google Calendar & Outlook.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant Google as Google OAuth2
    participant GCal as Google Calendar API

    User->>EDITH: "connect my Google Calendar"
    EDITH->>Google: OAuth2 authorization URL
    EDITH-->>User: "Open this link to grant access: [URL]"
    User->>Google: Grant access
    Google-->>EDITH: Authorization code
    EDITH->>Google: Exchange code for tokens
    Google-->>EDITH: access_token + refresh_token
    EDITH->>EDITH: Store tokens in vault (Phase 17)
    
    EDITH->>GCal: GET /calendars (list all calendars)
    GCal-->>EDITH: [{id: "primary", name: "Work"}, {id: "...", name: "Personal"}]
    EDITH-->>User: "Connected! I see 2 calendars: Work and Personal.\nWhich ones should I watch?"
```

```typescript
/**
 * @module calendar/google-connector
 * Google Calendar OAuth2 connector with event CRUD.
 */

interface CalendarEvent {
  id: string;
  calendarId: string;
  provider: 'google' | 'outlook' | 'ical';
  title: string;
  description?: string;
  start: Date;
  end: Date;
  timezone: string;
  location?: string;
  attendees: Attendee[];
  isAllDay: boolean;
  recurrence?: string;   // RRULE string
  reminders: Reminder[];
  status: 'confirmed' | 'tentative' | 'cancelled';
}

interface Attendee {
  email: string;
  name?: string;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

class GoogleCalendarConnector {
  /**
   * Fetch events within a date range.
   * @param calendarId - Calendar to query
   * @param timeMin - Start of range
   * @param timeMax - End of range
   * @returns Array of calendar events
   */
  async getEvents(
    calendarId: string,
    timeMin: Date,
    timeMax: Date
  ): Promise<CalendarEvent[]> {
    const response = await this.client.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    return response.data.items?.map(this.mapToCalendarEvent) ?? [];
  }
  
  /**
   * Create a new event.
   * @param event - Event to create
   * @returns Created event with server-assigned ID
   */
  async createEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    const response = await this.client.events.insert({
      calendarId: event.calendarId,
      requestBody: this.mapToGoogleEvent(event),
    });
    return this.mapToCalendarEvent(response.data);
  }
}
```

```json
{
  "calendar": {
    "enabled": true,
    "providers": {
      "google": {
        "clientId": "$vault:GOOGLE_CLIENT_ID",
        "clientSecret": "$vault:GOOGLE_CLIENT_SECRET",
        "calendars": ["primary", "work-calendar-id"],
        "syncIntervalMinutes": 5
      },
      "outlook": {
        "tenantId": "$vault:MS_TENANT_ID",
        "clientId": "$vault:MS_CLIENT_ID",
        "calendars": ["AAMkAGI..."]
      }
    },
    "timezone": "Asia/Jakarta",
    "defaultCalendar": "primary"
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/calendar/google-connector.ts` | CREATE | ~200 |
| `EDITH-ts/src/calendar/outlook-connector.ts` | CREATE | ~200 |
| `EDITH-ts/src/calendar/ical-connector.ts` | CREATE | ~100 |
| `EDITH-ts/src/calendar/types.ts` | CREATE | ~80 |
| `EDITH-ts/src/calendar/event-store.ts` | CREATE | ~100 |
| `EDITH-ts/src/calendar/__tests__/google-connector.test.ts` | CREATE | ~120 |

---

### Phase 14B — NL DateTime Parsing

**Goal:** Parse "besok jam 3 sore" → `2024-03-08T15:00:00+07:00`

```mermaid
flowchart TD
    Input["'schedule meeting sama Andi\nbesok jam 3 sore selama 1 jam'"]
    
    Input --> IntentParse["Intent Parser\n(LLM-based)"]
    
    IntentParse --> Extracted["Extracted:\n- action: create_event\n- title: meeting sama Andi\n- date: 'besok'\n- time: 'jam 3 sore'\n- duration: '1 jam'\n- attendee: 'Andi'"]
    
    Extracted --> DateResolve["Date Resolver\n('besok' → 2024-03-08)"]
    Extracted --> TimeResolve["Time Resolver\n('jam 3 sore' → 15:00)"]
    Extracted --> DurationResolve["Duration Resolver\n('1 jam' → 60min)"]
    
    DateResolve & TimeResolve & DurationResolve --> Final["Final Event:\nstart: 2024-03-08T15:00+07:00\nend: 2024-03-08T16:00+07:00"]
```

```typescript
/**
 * @module calendar/nl-datetime-parser
 * Natural language datetime parsing supporting Bahasa Indonesia and English.
 */

// DECISION: LLM-based parsing instead of regex rules
// WHY: "Rabu depan jam setengah 4 sore" is too complex for regex
// ALTERNATIVES: chrono-node (English only), dateparser (Python)
// REVISIT: If LLM latency too high → add regex fast path for simple patterns

interface ParsedDateTime {
  date: Date;
  endDate?: Date;
  duration?: number;      // minutes
  isAllDay: boolean;
  isRecurring: boolean;
  recurrenceRule?: string;
  timezone: string;
  confidence: number;
}

const BAHASA_PATTERNS: Record<string, string> = {
  'besok': 'tomorrow',
  'lusa': 'day after tomorrow',
  'kemarin': 'yesterday',
  'minggu depan': 'next week',
  'bulan depan': 'next month',
  'pagi': 'morning (06:00-11:59)',
  'siang': 'afternoon (12:00-14:59)',
  'sore': 'late afternoon (15:00-17:59)',
  'malam': 'evening (18:00-23:59)',
  'setengah': 'half (X:30)',
  'jam': 'hour/at',
};

class NLDateTimeParser {
  /**
   * Parse natural language datetime string.
   * @param input - User's datetime description (Bahasa or English)
   * @param referenceDate - Current date for relative resolution
   * @returns Parsed datetime with confidence score
   */
  async parse(input: string, referenceDate: Date = new Date()): Promise<ParsedDateTime> {
    // Fast path: simple patterns
    const fastResult = this.tryFastParse(input, referenceDate);
    if (fastResult && fastResult.confidence > 0.9) return fastResult;
    
    // LLM path: complex expressions
    return this.llmParse(input, referenceDate);
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/calendar/nl-datetime-parser.ts` | CREATE | ~180 |
| `EDITH-ts/src/calendar/bahasa-patterns.ts` | CREATE | ~80 |
| `EDITH-ts/src/calendar/__tests__/nl-datetime-parser.test.ts` | CREATE | ~150 |

---

### Phase 14C — Free Slot Finder

**Goal:** Find available time slots across all calendars with conflict detection.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant SlotEngine as Slot Engine
    participant GCal as Google Calendar
    participant Outlook as Outlook Calendar

    User->>EDITH: "kapan gue free besok 1 jam buat meeting?"
    
    EDITH->>SlotEngine: findSlots({date: tomorrow, duration: 60min})
    
    par Fetch from all calendars
        SlotEngine->>GCal: getEvents(tomorrow)
        SlotEngine->>Outlook: getEvents(tomorrow)
    end
    
    GCal-->>SlotEngine: [9:00-10:00 standup, 14:00-15:00 design review]
    Outlook-->>SlotEngine: [11:00-12:00 client call]
    
    SlotEngine->>SlotEngine: Merge busy slots:\n9-10, 11-12, 14-15\n\nFree slots (work hours 8-18):\n8:00-9:00, 10:00-11:00,\n12:00-14:00, 15:00-18:00
    
    SlotEngine-->>EDITH: 4 free slots found
    
    EDITH-->>User: "Besok lu free di:\n⬜ 08:00-09:00 (pagi, fresh)\n⬜ 10:00-11:00 (after standup)\n⬜ 12:00-14:00 (post lunch, 2 jam)\n⬜ 15:00-18:00 (sore, 3 jam)\n\nMau gue book yang mana?"
```

```typescript
/**
 * @module calendar/slot-finder
 * Finds free time slots across multiple calendars.
 */

interface TimeSlot {
  start: Date;
  end: Date;
  duration: number;           // minutes
  quality: 'optimal' | 'good' | 'suboptimal';  // energy-based
  reason?: string;            // "after standup, good transition"
}

interface SlotFinderOptions {
  date: Date;
  duration: number;           // desired meeting duration in minutes
  workHoursStart: number;     // e.g., 8 (8 AM)
  workHoursEnd: number;       // e.g., 18 (6 PM)
  bufferMinutes: number;      // travel/transition buffer
  preferredTimes?: string[];  // ['morning', 'afternoon']
  excludeSlots?: TimeRange[]; // manual blocks
}

class SlotFinder {
  async findFreeSlots(options: SlotFinderOptions): Promise<TimeSlot[]> {
    // 1. Fetch events from all connected calendars
    const allEvents = await this.fetchAllEvents(options.date);
    
    // 2. Merge into unified busy timeline
    const busySlots = this.mergeBusySlots(allEvents, options.bufferMinutes);
    
    // 3. Invert: find gaps in busy timeline within work hours
    const freeSlots = this.invertTimeline(busySlots, options);
    
    // 4. Filter by minimum duration
    const viable = freeSlots.filter(s => s.duration >= options.duration);
    
    // 5. Rate by energy/quality
    return this.rateSlots(viable, options);
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/calendar/slot-finder.ts` | CREATE | ~150 |
| `EDITH-ts/src/calendar/conflict-detector.ts` | CREATE | ~80 |
| `EDITH-ts/src/calendar/__tests__/slot-finder.test.ts` | CREATE | ~120 |

---

### Phase 14D — Proactive Scheduling

**Goal:** EDITH proactively manages schedule — blocks focus time, warns about conflicts.

```mermaid
stateDiagram-v2
    [*] --> MonitorSchedule

    MonitorSchedule --> DetectPattern : Analyze last 30 days
    DetectPattern --> FocusBlock : "User codes daily 9-12"
    DetectPattern --> MeetingWarn : "3 meetings back-to-back"
    DetectPattern --> DeadlineWarn : "Sprint review in 2 days"

    FocusBlock --> AutoBlock : Auto-create "Focus Time" event
    AutoBlock --> NotifyUser : "Gue block 9-12 besok buat deep work"

    MeetingWarn --> SuggestReschedule : "Mau gue reschedule salah satu?"
    SuggestReschedule --> UserDecides

    DeadlineWarn --> RemindUser : "Sprint review 2 hari lagi,\nestimate belum done"

    UserDecides --> [*]
    NotifyUser --> [*]
    RemindUser --> [*]
```

```typescript
/**
 * @module calendar/proactive-scheduler
 * Proactive schedule management: auto-block focus, deadline warnings, meeting density control.
 */

interface SchedulePattern {
  type: 'focus_block' | 'meeting_cluster' | 'deadline_proximity' | 'overwork';
  confidence: number;
  description: string;
  suggestedAction: ProactiveAction;
}

interface ProactiveAction {
  type: 'auto_block' | 'suggest_reschedule' | 'remind' | 'suggest_break';
  event?: Partial<CalendarEvent>;
  message: string;
  urgency: 'low' | 'medium' | 'high';
}

class ProactiveScheduler {
  /**
   * Analyze upcoming schedule and generate proactive suggestions.
   * Runs daily at configured time (default: 7 AM).
   */
  async analyzeTomorrow(): Promise<ProactiveAction[]> {
    const tomorrow = this.getTomorrow();
    const events = await this.eventStore.getEvents(tomorrow);
    const patterns = await this.patternStore.getUserPatterns();
    const actions: ProactiveAction[] = [];
    
    // Check meeting density
    if (this.hasBackToBackMeetings(events, 3)) {
      actions.push({
        type: 'suggest_reschedule',
        message: 'Lu punya 3 meeting back-to-back besok. Mau gue reschedule salah satunya?',
        urgency: 'medium',
      });
    }
    
    // Check focus time
    if (patterns.dailyFocusHours && !this.hasFocusBlock(events, patterns)) {
      actions.push({
        type: 'auto_block',
        event: { title: '🎯 Focus Time (EDITH)', start: patterns.focusStart, end: patterns.focusEnd },
        message: `Gue block ${patterns.focusStart}-${patterns.focusEnd} buat deep work besok.`,
        urgency: 'low',
      });
    }
    
    return actions;
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/calendar/proactive-scheduler.ts` | CREATE | ~180 |
| `EDITH-ts/src/calendar/pattern-analyzer.ts` | CREATE | ~120 |
| `EDITH-ts/src/calendar/__tests__/proactive-scheduler.test.ts` | CREATE | ~120 |

---

### Phase 14E — Meeting Prep & Context

**Goal:** Brief user before meetings with relevant context.

```mermaid
sequenceDiagram
    participant EDITH
    participant Calendar as Event Store
    participant Memory as Memory (Phase 6)
    participant KB as Knowledge Base (Phase 13)
    participant User

    Note over EDITH: 10 minutes before meeting
    
    EDITH->>Calendar: getNextEvent()
    Calendar-->>EDITH: "Design Review with Sarah & Budi, 14:00"
    
    par Gather context
        EDITH->>Memory: getInteractions("Sarah", last 30 days)
        EDITH->>Memory: getInteractions("Budi", last 30 days)
        EDITH->>KB: search("design review agenda")
        EDITH->>Calendar: getPreviousMeetings("Design Review", last 3)
    end
    
    Memory-->>EDITH: Sarah: discussed API design last week
    Memory-->>EDITH: Budi: asked about deadline concerns
    KB-->>EDITH: Design doc v2 in knowledge base
    Calendar-->>EDITH: Last review: discussed nav redesign
    
    EDITH->>EDITH: Compile brief
    
    EDITH-->>User: "📋 Meeting Brief — Design Review (14:00)\n\n👥 Attendees: Sarah, Budi\n\n📝 Context:\n- Last review: discussed nav redesign\n- Sarah: API design discussion last week\n- Budi: had deadline concerns\n\n📄 Related: Design Doc v2 in your notes\n\n⚡ Suggested talking points:\n1. Follow up on nav redesign progress\n2. Address Budi's deadline concerns\n3. Review API design decisions with Sarah"
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/calendar/meeting-prep.ts` | CREATE | ~150 |
| `EDITH-ts/src/calendar/__tests__/meeting-prep.test.ts` | CREATE | ~100 |

---

### Phase 14F — Energy-Aware Scheduling

**Goal:** Schedule tasks at optimal times based on cognitive patterns.

```mermaid
flowchart TD
    subgraph EnergyMap["⚡ Personal Energy Map"]
        Morning["🌅 Morning (8-12)\nHIGH energy\n→ Deep work, complex coding"]
        PostLunch["🍽️ Post-Lunch (13-14)\nLOW energy\n→ Routine tasks, emails"]
        Afternoon["☀️ Afternoon (14-17)\nMEDIUM energy\n→ Meetings, reviews"]
        Evening["🌙 Evening (17-19)\nLOW-MEDIUM\n→ Planning, light tasks"]
    end

    subgraph TaskTypes["📋 Task Types"]
        DeepWork["🧠 Deep Work\n(coding, writing)"]
        Meetings["👥 Meetings\n(calls, reviews)"]
        Admin["📧 Admin\n(emails, routine)"]
        Creative["🎨 Creative\n(brainstorming, design)"]
    end

    Morning --> DeepWork & Creative
    PostLunch --> Admin
    Afternoon --> Meetings
    Evening --> Admin

    Note["EDITH learns user's actual pattern\nover 30 days → adjusts energy map"]
```

```json
{
  "calendar": {
    "energyScheduling": {
      "enabled": true,
      "defaultEnergyMap": {
        "08:00-12:00": "high",
        "12:00-13:00": "break",
        "13:00-14:00": "low",
        "14:00-17:00": "medium",
        "17:00-19:00": "low-medium"
      },
      "learningEnabled": true,
      "learningWindowDays": 30
    }
  }
}
```

**Files:**
| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/calendar/energy-scheduler.ts` | CREATE | ~100 |
| `EDITH-ts/src/skills/calendar-skill.ts` | CREATE | ~120 |

---

## 5. Acceptance Gates

```
□ Google Calendar OAuth2: authorize + fetch events
□ Outlook connector: authorize + fetch events
□ iCal feed: parse .ics URL
□ NL datetime (English): "next Tuesday 2pm" → correct timestamp
□ NL datetime (Bahasa): "besok jam 3 sore" → correct timestamp
□ NL datetime (Bahasa): "Rabu depan setengah 4" → Wed 15:30
□ Free slot finder: merge 2+ calendars → find gaps
□ Conflict detection: warn before double-booking
□ Create event via NL: "schedule lunch sama Andi besok jam 12"
□ Proactive focus block: auto-create based on user pattern
□ Meeting density warning: 3+ back-to-back → suggest reschedule
□ Deadline proximity: warn 2 days before deadline events
□ Meeting prep brief: 10min before meeting → context summary
□ Energy scheduling: suggest optimal times for task types
□ Cross-device: calendar reminder → active device (Phase 27)
□ HUD card: next meeting shows on overlay (Phase 20)
```

---

## 6. Koneksi ke Phase Lain

| Phase | Integration | Protocol |
|-------|------------|----------|
| Phase 1 (Voice) | "EDITH, kapan gue free besok?" → voice response | voice_query |
| Phase 6 (Proactive) | Schedule-triggered proactive reminders | proactive_trigger |
| Phase 8 (Channels) | Send meeting reminders via Telegram/WhatsApp | channel_notify |
| Phase 13 (Knowledge) | "Cari notes dari meeting minggu lalu" | knowledge_query |
| Phase 18 (Social) | Meeting attendee context from people graph | people_lookup |
| Phase 20 (HUD) | Next meeting card on desktop overlay | hud_card |
| Phase 21 (Emotion) | Stressed → reduce meeting suggestions | mood_context |
| Phase 22 (Mission) | Schedule mission completion by deadline | mission_deadline |
| Phase 27 (Cross-Device) | Calendar alert → active device routing | device_route |

---

## 7. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `EDITH-ts/src/calendar/google-connector.ts` | CREATE | ~200 |
| `EDITH-ts/src/calendar/outlook-connector.ts` | CREATE | ~200 |
| `EDITH-ts/src/calendar/ical-connector.ts` | CREATE | ~100 |
| `EDITH-ts/src/calendar/types.ts` | CREATE | ~80 |
| `EDITH-ts/src/calendar/event-store.ts` | CREATE | ~100 |
| `EDITH-ts/src/calendar/nl-datetime-parser.ts` | CREATE | ~180 |
| `EDITH-ts/src/calendar/bahasa-patterns.ts` | CREATE | ~80 |
| `EDITH-ts/src/calendar/slot-finder.ts` | CREATE | ~150 |
| `EDITH-ts/src/calendar/conflict-detector.ts` | CREATE | ~80 |
| `EDITH-ts/src/calendar/proactive-scheduler.ts` | CREATE | ~180 |
| `EDITH-ts/src/calendar/pattern-analyzer.ts` | CREATE | ~120 |
| `EDITH-ts/src/calendar/meeting-prep.ts` | CREATE | ~150 |
| `EDITH-ts/src/calendar/energy-scheduler.ts` | CREATE | ~100 |
| `EDITH-ts/src/skills/calendar-skill.ts` | CREATE | ~120 |
| `EDITH-ts/src/calendar/__tests__/google-connector.test.ts` | CREATE | ~120 |
| `EDITH-ts/src/calendar/__tests__/nl-datetime-parser.test.ts` | CREATE | ~150 |
| `EDITH-ts/src/calendar/__tests__/slot-finder.test.ts` | CREATE | ~120 |
| `EDITH-ts/src/calendar/__tests__/proactive-scheduler.test.ts` | CREATE | ~120 |
| `EDITH-ts/src/calendar/__tests__/meeting-prep.test.ts` | CREATE | ~100 |
| **Total** | | **~2650** |

**New dependencies:** `googleapis` (Google Calendar), `@microsoft/microsoft-graph-client`, `ical.js`, `rrule`
