# Phase 8 — Extended Channels (Email, Calendar, SMS, Phone Calls)

**Prioritas:** 🟡 MEDIUM-HIGH — Lengkapi EDITH sebagai communication hub
**Depends on:** Phase 1 (voice untuk phone calls), Phase 6 (notifications)
**Status Saat Ini:** Telegram/Discord/WhatsApp/Signal/Slack/LINE/Matrix/Teams ✅ | Email ❌ | Calendar ❌ | SMS ❌ | Phone Calls ❌

---

## 1. Tujuan

EDITH saat ini bisa chat via 9+ messaging platforms tapi **tidak bisa email, SMS, atau telepon**. Phase ini menjadikan EDITH sebagai komunikasi hub yang benar-benar komprehensif — seperti JARVIS yang bisa "Email Ms. Potts" atau "Call the Pentagon."

```mermaid
flowchart TD
    User["🗣️ User command"]

    subgraph Channels["📡 All Channels (after Phase 8)"]
        direction LR
        C1["✅ Telegram"]
        C2["✅ Discord"]
        C3["✅ WhatsApp"]
        C4["✅ Slack"]
        C5["✅ Signal"]
        C6["✅ Line/Matrix/Teams"]
        C7["📧 Email\n(Gmail + Outlook)\nNEW"]
        C8["📅 Calendar\n(Google + Outlook)\nNEW"]
        C9["💬 SMS\n(Twilio / Android)\nNEW"]
        C10["📞 Phone Calls\n(Twilio Voice)\nNEW"]
    end

    User --> Channels
```

---

## 2. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["8A\nEmail\n(Gmail + Outlook)"]
    B["8B\nCalendar\n(Google + Outlook)"]
    C["8C\nSMS\n(Twilio / Android ADB)"]
    D["8D\nPhone Calls\n(Twilio Voice + STT/TTS)"]
    E["8E\nCalendar Proactivity\n(meeting alerts, prep)"]

    A --> E
    B --> E
    C --> D
```

---

### Phase 8A — Email (Gmail + Outlook)

**Goal:** EDITH bisa baca, kirim, search, dan summarize email.

```mermaid
sequenceDiagram
    participant User
    participant EDITH
    participant Gmail as Gmail API
    participant LLM

    User->>EDITH: "Ada email penting hari ini?"
    EDITH->>Gmail: messages.list(q="is:unread after:today")
    Gmail-->>EDITH: [email list]
    EDITH->>LLM: summarize + classify importance
    LLM-->>EDITH: "3 emails: 1 dari client (urgent),\n2 newsletter (skip)"
    EDITH-->>User: "Sir, ada email urgent dari client\nsoal deadline project. Mau saya balas?"

    User->>EDITH: "Ya, balas: 'Noted, akan selesai Jumat'"
    EDITH->>LLM: draft reply (match user writing style)
    LLM-->>EDITH: draft text
    EDITH->>User: "Draft: '...'. Kirim sekarang?"
    User->>EDITH: "Kirim"
    EDITH->>Gmail: messages.send(draft)
```

**Providers:** Gmail API (OAuth2) + Microsoft Graph API (Outlook/Office365)

**edith.json config:**
```json
{
  "env": {
    "GMAIL_CLIENT_ID": "...",
    "GMAIL_CLIENT_SECRET": "...",
    "GMAIL_REFRESH_TOKEN": "...",
    "OUTLOOK_CLIENT_ID": "...",
    "OUTLOOK_CLIENT_SECRET": "...",
    "OUTLOOK_REFRESH_TOKEN": "..."
  },
  "channels": {
    "email": {
      "enabled": true,
      "provider": "gmail",
      "checkIntervalMinutes": 15,
      "importanceFilter": "high",
      "autoSummarize": true,
      "draftBeforeSend": true
    }
  }
}
```

**File:** `EDITH-ts/src/channels/email.ts` (NEW, ~250 lines)
**Dependency:** `pnpm add googleapis @microsoft/microsoft-graph-client`

---

### Phase 8B — Calendar Integration

**Goal:** EDITH tahu jadwal user, bisa buat event, beri reminder proaktif sebelum meeting.

```mermaid
flowchart TD
    EDITH["EDITH Calendar Module"]

    subgraph Read["📖 Read Operations"]
        R1["getEvents(today/week)"]
        R2["findFreeSlots(duration)"]
        R3["getNextMeeting()"]
    end

    subgraph Write["✏️ Write Operations"]
        W1["createEvent(title, time, attendees)"]
        W2["updateEvent(id, changes)"]
        W3["deleteEvent(id)"]
        W4["addReminder(eventId, minutesBefore)"]
    end

    subgraph Proactive["🔔 Proactive (Phase 8E)"]
        P1["10 min before meeting:\nbrief + agenda TTS"]
        P2["Travel time alert:\n'Sir, traffic is bad, leave in 15min'"]
        P3["Prep reminder:\n'You have weekly sync in 1hr.\nRecap from last meeting: ...'"]
    end

    EDITH --> Read & Write & Proactive
```

**File:** `EDITH-ts/src/channels/calendar.ts` (NEW, ~200 lines)

---

### Phase 8C — SMS (Twilio + Android ADB fallback)

**Self-hosted path:** Untuk SMS tanpa Twilio, bisa pakai Android phone yang connected via ADB sebagai SMS gateway — truly free, no API needed.

```mermaid
flowchart TD
    SMS_Out["Send SMS request"]

    Check{SMS provider\ndi edith.json?}
    SMS_Out --> Check

    Check -->|"twilio.accountSid\nexists"| Twilio["Twilio SMS API\ncloud, ~$0.0079/msg"]
    Check -->|"android.adbHost\nexists"| ADB["Android ADB Bridge\nReal SIM card\nlocal, free"]
    Check -->|"none"| Warn["⚠️ Warning: no SMS\nprovider configured"]

    Twilio & ADB --> Delivered["SMS delivered ✅"]
```

**Android ADB SMS (fully self-hosted):**
```typescript
// Send SMS via connected Android phone — no API cost
await execa('adb', ['shell', 'am', 'start',
  '-a', 'android.intent.action.SENDTO',
  '-d', `sms:${phoneNumber}`,
  '--es', 'sms_body', message,
  '--ez', 'exit_on_sent', 'true',
])
```

**edith.json config:**
```json
{
  "env": {
    "TWILIO_ACCOUNT_SID": "optionali jika mau Twilio",
    "TWILIO_AUTH_TOKEN": "...",
    "TWILIO_PHONE_NUMBER": "+1..."
  },
  "channels": {
    "sms": {
      "enabled": true,
      "provider": "auto",
      "android": {
        "adbHost": "127.0.0.1",
        "adbPort": 5037
      }
    }
  }
}
```

**File:** `EDITH-ts/src/channels/sms.ts` (NEW, ~150 lines)

---

### Phase 8D — Phone Calls (Twilio Voice)

**Goal:** EDITH bisa menerima dan melakukan telepon dengan **real-time STT + TTS bridge** — user bicara di phone, EDITH jawab via LLM, text-to-speech ke caller.

```mermaid
sequenceDiagram
    participant Caller as 📞 Caller
    participant Twilio as Twilio Voice
    participant GW as EDITH Gateway
    participant STT as Whisper STT
    participant LLM as EDITH LLM
    participant TTS as TTS Engine

    Caller->>Twilio: Incoming call
    Twilio->>GW: POST /voice/incoming (TwiML webhook)
    GW-->>Twilio: TwiML: <Stream> WebSocket URL

    loop real-time conversation
        Caller->>Twilio: speak
        Twilio->>GW: audio stream (mulaw 8kHz)
        GW->>STT: transcribe chunk
        STT-->>GW: transcript
        GW->>LLM: generate response
        LLM-->>GW: response text
        GW->>TTS: synthesize
        TTS-->>GW: audio
        GW-->>Twilio: play audio to caller
    end
```

**Self-hosted alternative:** Tanpa Twilio, bisa pakai **FreePBX + Asterisk (VoIP)** sebagai self-hosted phone server, EDITH connect via SIP. Gratis, no per-call cost.

**edith.json config:**
```json
{
  "env": {
    "TWILIO_ACCOUNT_SID": "...",
    "TWILIO_AUTH_TOKEN": "..."
  },
  "channels": {
    "voice": {
      "enabled": false,
      "provider": "twilio",
      "webhookUrl": "https://your-edith-server/voice",
      "selfHosted": {
        "sip": {
          "enabled": false,
          "server": "sip.local:5060",
          "username": "edith",
          "password": ""
        }
      }
    }
  }
}
```

**File:** `EDITH-ts/src/channels/phone.ts` (NEW, ~200 lines)
**Dependency:** `pnpm add twilio` (optional, only if using Twilio)

---

### Phase 8E — Calendar Proactivity

Integrasikan dengan Phase 1E proactivity framework:

```mermaid
flowchart TD
    Daemon["⏰ Background Daemon\n(heartbeat every 1 min)"]
    Cal["Calendar Module\ngetNextMeeting()"]
    Daemon --> Cal

    Cal --> Check{Minutes until\nnext meeting?}

    Check -->|"60 min"| Prep["Medium tier:\nSend prep brief via chosen channel\n(Telegram/Discord/etc.)"]
    Check -->|"15 min"| Remind["High tier:\nVoice reminder TTS\n+ show agenda"]
    Check -->|"10 min"| Travel["Check travel time\n(if location known)\n→ 'Sir, you should leave in 5 min'"]
    Check -->|"2 min"| Join["Critical tier:\nVoice alert +\njoin link shortcut"]
```

---

## 3. File Changes Summary

| File | Action | Est. Lines |
|------|--------|-----------|
| `EDITH-ts/src/channels/email.ts` | NEW | +250 |
| `EDITH-ts/src/channels/calendar.ts` | NEW | +200 |
| `EDITH-ts/src/channels/sms.ts` | NEW | +150 |
| `EDITH-ts/src/channels/phone.ts` | NEW | +200 |
| `EDITH-ts/src/config/edith-config.ts` | Add email/calendar/sms/phone schema | +60 |
| `EDITH-ts/src/background/triggers.ts` | Calendar proactivity triggers | +80 |
| `EDITH-ts/src/channels/__tests__/email.test.ts` | NEW | +100 |
| **Total** | | **~1040 lines** |

**New deps (all optional):**
```bash
pnpm add googleapis                          # Gmail + Google Calendar
pnpm add @microsoft/microsoft-graph-client  # Outlook + Office 365
pnpm add twilio                             # Phone calls + SMS (optional)
```
