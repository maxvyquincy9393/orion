# Phase 10 — Personalization & Adaptive Learning

**Prioritas:** 🟡 MEDIUM — Bikin EDITH benar-benar "milik kamu", bukan generic assistant
**Depends on:** Phase 1 (voice persona), Phase 6 (macro engine), Phase 9 (local LLM)
**Status Saat Ini:** MemRL Q-values ✅ | User preference learning ❌ | Habit model ❌ | Personality calibration ❌ | Voice profile per-user ❌

---

## 1. Tujuan

EDITH saat ini melayani semua user dengan cara sama. Phase ini membuatnya **belajar dari setiap interaksi** — seperti JARVIS yang setelah 6 bulan sudah tahu Tony Stark suka kopi jam 7 pagi, panik soal deadline, dan tidak suka diinterupsi saat coding.

```mermaid
timeline
    title EDITH Learning Over Time
    Day 1 : Generic responses\nDefault personality\nNo context retention
    Week 1 : Learns user name + preferences\nAdapts formality level\nBasic habit detection
    Month 1 : Knows daily routine\nProactive at right times\nPersonalized suggestions
    Month 6 : Full JARVIS mode\nAnticipates needs\nSeamless integration\nFelt like "mine"
```

---

## 2. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["10A\nUser Profile Engine\n(preferences, style)"]
    B["10B\nHabit Model\n(routine learning)"]
    C["10C\nFeedback Loop\n(explicit + implicit)"]
    D["10D\nPersonality Calibration\n(tone, verbosity, proactivity)"]
    E["10E\nVoice Profile\n(per-user voice ID)"]
    F["10F\nAdaptive Quiet Hours\n(learn do-not-disturb)"]

    A --> C
    B --> C
    C --> D & E & F
```

---

### Phase 10A — User Profile Engine

**Goal:** Buat persistent user preference store yang di-update dari setiap interaction.

```mermaid
erDiagram
    UserProfile {
        string userId PK
        string name
        string preferredLanguage
        string formalityLevel "formal|casual|mixed"
        int responseLength "1-5 (brief to verbose)"
        boolean useHumor
        string timezone
        json topicInterests
        json avoidTopics
        json customAliases "e.g., 'boss' = manager name"
        datetime createdAt
        datetime updatedAt
    }

    UserHabit {
        string id PK
        string userId FK
        string habitType "wakeTime|sleepTime|workHours|routineTask"
        json pattern "{ hour, dayOfWeek, frequency }"
        float confidence "0.0 - 1.0"
        int observationCount
    }

    UserFeedback {
        string id PK
        string userId FK
        string messageId FK
        int rating "-1 | 0 | 1"
        string feedbackType "too_long|too_formal|wrong|good|perfect"
        datetime createdAt
    }

    UserProfile ||--o{ UserHabit : has
    UserProfile ||--o{ UserFeedback : gives
```

**Auto-inference from conversation:**
```typescript
// After each interaction, LLM infers preferences
const inference = await llm.generate(`
  Based on this conversation, what can you infer about the user's:
  - Preferred response length
  - Formality level
  - Interests mentioned
  - Any corrections they gave

  Conversation: ${lastNMessages}
  Current profile: ${currentProfile}

  Return JSON diff of profile changes (only fields that changed).
`)
await userProfileStore.patch(userId, inference)
```

**File:** `EDITH-ts/src/memory/user-profile.ts` (NEW, ~200 lines)

---

### Phase 10B — Habit Model (Routine Learning)

**Goal:** EDITH deteksi pola kebiasaan user dan gunakan untuk proactivity yang tepat waktu.

```mermaid
flowchart TD
    Data["📊 Interaction timestamps\n+ system monitor data\n(SystemMonitor.getSnapshot())"]

    subgraph Detection["Habit Detection"]
        D1["Wake time detection\n(first interaction each day)"]
        D2["Work hours pattern\n(keyboard activity peaks)"]
        D3["Meeting routine\n(calendar + audio mute pattern)"]
        D4["Lunch break\n(idle time midday)"]
        D5["End-of-day trigger\n(cross-reference activity + time)"]
    end

    Data --> Detection

    subgraph Actions["Proactive Actions (when habit confirmed, confidence > 0.8)"]
        A1["7:05 AM: 'Good morning, Sir.\nYour schedule today: ...'"]
        A2["11:55 AM: 'Lunch in 5 min.\nAnything to wrap up?'"]
        A3["17:30 PM: 'End of work day.\nWant a summary of today?'"]
        A4["Friday 17:00: 'Weekly recap:\n3 tasks done, 2 pending.'"]
    end

    Detection -->|"confidence > 0.8\n→ store in UserHabit"| Actions
```

**Algorithm:** Simple frequency analysis with decay:
```typescript
// Each day at same time increases confidence
// Missing days decrease confidence (habit decay)
habit.confidence = (habit.observationCount / habit.expectedCount) * decayFactor
```

**File:** `EDITH-ts/src/background/habit-model.ts` (NEW, ~150 lines)

---

### Phase 10C — Feedback Loop (Explicit + Implicit)

**Goal:** EDITH belajar dari feedback user — baik yang diucapkan langsung maupun yang implisit dari behavior.

```mermaid
flowchart TD
    subgraph Explicit["🗣️ Explicit Feedback"]
        E1["'EDITH that was too long'\n→ responseLength -1"]
        E2["'Good answer'\n→ reinforce style"]
        E3["'Don't remind me about this'\n→ suppress trigger type"]
        E4["Voice tone change\n(frustration detected)"]
    end

    subgraph Implicit["👁️ Implicit Signals"]
        I1["User interrupts EDITH mid-speech\n→ response was too long OR wrong"]
        I2["User repeats question\n→ previous answer unclear"]
        I3["User dismisses notification\n→ that trigger type not valued"]
        I4["User edits EDITH's draft\n→ learn writing style diff"]
    end

    Explicit & Implicit --> RL["MemRL Q-value update\n(existing memrl.ts)\n+ UserProfile patch"]
    RL --> Better["Better future responses\nfor this user"]
```

**Implicit signal detection from voice (integrates with Phase 1E):**
- Barge-in during TTS → mark response as "too long" (implicit)
- "No, that's wrong" → negative feedback on previous memory retrieval
- Long silence after EDITH speaks → confusion signal

**File:** `EDITH-ts/src/memory/feedback-store.ts` (NEW, ~120 lines)
**Modify:** `EDITH-ts/src/core/message-pipeline.ts` — add feedback signal collection

---

### Phase 10D — Personality Calibration

**Goal:** User bisa tune EDITH personality via config atau conversation.

```mermaid
flowchart TD
    subgraph Sliders["🎛️ Personality Dimensions"]
        P1["Formality\n1=very casual ←→ 5=very formal"]
        P2["Verbosity\n1=one-liner ←→ 5=detailed"]
        P3["Humor\n0=none ←→ 3=frequent jokes"]
        P4["Proactivity\n1=only when asked ←→ 5=very proactive"]
        P5["Tone\nchoice: JARVIS | Clippy | Friendly | Professional"]
    end

    subgraph SystemPrompt["📝 Dynamic System Prompt Builder"]
        SP["Combines:\n- Base EDITH persona\n- UserProfile settings\n- Current context\n- Time of day\n(morning vs. late night)\n→ Injected at every LLM call"]
    end

    Sliders --> SystemPrompt
```

**edith.json personality config:**
```json
{
  "personality": {
    "name": "EDITH",
    "tone": "jarvis",
    "formality": 3,
    "verbosity": 2,
    "humor": 1,
    "proactivity": 3,
    "useTitle": true,
    "titleWord": "Sir",
    "language": "auto",
    "customTraits": [
      "Always acknowledge urgency directly",
      "Never apologize excessively",
      "Use metric units"
    ]
  }
}
```

**Preset tones:**
| Tone | Description | Example greeting |
|------|-------------|-----------------|
| `jarvis` | Professional, British, efficient | "Good morning, Sir. All systems operational." |
| `friday` | Warmer JARVIS, slightly playful | "Hey! Everything's looking good today." |
| `cortana` | Helpful, clear, gender-neutral | "Good morning. You have 3 things to review." |
| `hal` | Minimal, slightly eerie | "Good morning." |
| `edith-custom` | User-defined via traits | Per customTraits array |

**File:** `EDITH-ts/src/core/personality-engine.ts` (NEW, ~150 lines)

---

### Phase 10E — Voice Profile (Per-User Voice ID)

**Goal:** Ketika beberapa orang bisa trigger EDITH (family, team), EDITH kenali **siapa yang bicara** dan respond sesuai preferensi masing-masing.

```mermaid
sequenceDiagram
    participant Mic
    participant EDITH
    participant VID as Voice ID (speaker embedding)
    participant Profile as UserProfile store

    Mic->>EDITH: audio chunk

    EDITH->>VID: extract speaker embedding\n(pyannote-audio / resemblyzer)
    VID-->>EDITH: embedding vector

    EDITH->>Profile: nearest neighbor search\namong enrolled users
    Profile-->>EDITH: userId = "alice" (0.89 confidence)

    Note over EDITH: Load Alice's profile:\n- casual tone\n- Indonesian language\n- quiet hours 23:00-07:00

    EDITH->>EDITH: respond in Alice's preferred style
```

**Self-hosted speaker ID:**
- `resemblyzer` (Python) — speaker embeddings, ~5MB, MIT
- `pyannote-audio/speaker-embedding` (Python) — SOTA, 8MB model

**Enrollment:**
```bash
# User says "Hey EDITH, my name is Alice" 3 times
# EDITH captures voice samples, trains embedding
# Stored in UserProfile.voiceEmbedding (binary blob in SQLite)
```

**File:** `EDITH-ts/src/voice/speaker-id.ts` (NEW, ~100 lines)
Add to `python/delivery/streaming_voice.py`: speaker embedding extraction

---

### Phase 10F — Adaptive Quiet Hours

**Goal:** EDITH belajar kapan user tidak mau diganggu, TANPA harus manual set di config.

```mermaid
flowchart TD
    Obs["Observations over 2+ weeks"]

    subgraph Patterns["Learned patterns"]
        PA["User dismisses\nall notifications\n22:00-07:00"]
        PB["User turns off\nmonitor 23:30 avg"]
        PC["No keyboard activity\nSaturday morning"]
        PD["Explicit: 'Don't disturb me'\nphrases captured"]
    end

    Obs --> Patterns

    Patterns --> Model["AdaptiveQuietHours model\n(confidence-weighted)"]

    Model --> Config["Auto-update\nquietHours in edith.json\nwith user confirmation:\n'Sir, I noticed you prefer\nno alerts 23:00-07:30.\nShall I set that?'"]
```

**Fallback:** Jika tidak ada pattern (new user), use timezone-based defaults:
- Weekdays: quiet 23:00 - 07:00
- Weekends: quiet 00:00 - 09:00

**File:** `EDITH-ts/src/background/quiet-hours.ts` — extend existing QuietHours class

---

## 3. File Changes Summary

| File | Action | Est. Lines |
|------|--------|-----------|
| `EDITH-ts/src/memory/user-profile.ts` | NEW | +200 |
| `EDITH-ts/src/background/habit-model.ts` | NEW | +150 |
| `EDITH-ts/src/memory/feedback-store.ts` | NEW | +120 |
| `EDITH-ts/src/core/personality-engine.ts` | NEW | +150 |
| `EDITH-ts/src/voice/speaker-id.ts` | NEW | +100 |
| `EDITH-ts/src/background/quiet-hours.ts` | Extend adaptive learning | +60 |
| `EDITH-ts/src/core/message-pipeline.ts` | Inject personality + collect feedback | +50 |
| `EDITH-ts/src/config/edith-config.ts` | Add personality schema | +40 |
| `prisma/schema.prisma` | Add UserHabit, UserFeedback tables | +30 |
| `EDITH-ts/src/__tests__/personalization.test.ts` | NEW | +150 |
| **Total** | | **~1050 lines** |

**New deps:**
```bash
pip install resemblyzer   # speaker voice ID (Python sidecar)
```
