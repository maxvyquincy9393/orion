# EDITH — Claude Code Context

> **Baca file ini sebelum menyentuh kode apapun.**
> Ini adalah single source of truth untuk navigasi dan standar proyek.

---

## 🧠 Apa itu EDITH?

EDITH adalah **persistent AI companion** (bukan generic chatbot) — seperti JARVIS milik Tony Stark.
Dia berjalan lokal, multi-channel, multi-modal, dan belajar dari setiap interaksi.

- **Stack:** TypeScript (ESM) + Prisma (SQLite) + Python sidecar
- **Package manager:** `pnpm` (JANGAN pakai npm/yarn)
- **Branch aktif:** `main`
- **Test runner:** `vitest`

---

## 📁 Struktur Proyek (yang penting)

```
EDITH/
├── src/
│   ├── core/                  # Pipeline utama + system prompt
│   │   ├── message-pipeline.ts     ← ENTRY POINT semua pesan
│   │   ├── system-prompt-builder.ts ← assembles system prompt
│   │   ├── persona.ts              ← runtime context detection
│   │   ├── personality-engine.ts   ← [Phase 10] per-user tone presets
│   │   ├── startup.ts              ← inisialisasi semua service
│   │   └── bootstrap.ts            ← membaca SOUL.md, AGENTS.md, dll
│   │
│   ├── engines/               # LLM routing
│   │   ├── orchestrator.ts         ← ROUTING UTAMA (TaskType → provider)
│   │   ├── types.ts                ← TaskType: 'reasoning'|'code'|'fast'|'multimodal'|'local'
│   │   └── [anthropic|groq|gemini|ollama|openai|openrouter].ts
│   │
│   ├── memory/                # Semua sistem memori
│   │   ├── store.ts                ← LanceDB vector store (embed + retrieve)
│   │   ├── memrl.ts                ← MemRL Q-learning (IEU triplets, Bellman)
│   │   ├── profiler.ts             ← UserProfile (facts + opinions dari percakapan)
│   │   ├── user-preference.ts      ← [Phase 10] preference sliders (formality, verbosity)
│   │   ├── feedback-store.ts       ← [Phase 10] preference signal collection
│   │   ├── hybrid-retriever.ts     ← vector + FTS5 hybrid search
│   │   ├── causal-graph.ts         ← CausalNode/Edge graph
│   │   └── episodic.ts             ← episodic memory
│   │
│   ├── background/            # Daemon + scheduled tasks
│   │   ├── daemon.ts               ← background loop (proactive triggers)
│   │   ├── habit-model.ts          ← [Phase 10] routine detection
│   │   ├── quiet-hours.ts          ← quiet hours (hardcoded + adaptive)
│   │   └── triggers.ts             ← trigger definitions
│   │
│   ├── channels/              # Semua channel I/O
│   │   ├── manager.ts              ← ChannelManager (register + dispatch)
│   │   ├── telegram.ts / discord.ts / whatsapp.ts / webchat.ts
│   │   ├── email.ts / calendar.ts / sms.ts / phone.ts  ← [Phase 8]
│   │   └── base.ts                 ← BaseChannel interface
│   │
│   ├── voice/                 # Voice pipeline
│   │   ├── bridge.ts               ← VoiceBridge (STT/TTS orchestration)
│   │   └── speaker-id.ts           ← [Phase 10] multi-user speaker ID
│   │
│   ├── vision/                # Vision pipeline
│   ├── agents/                # Computer use (LATS planner)
│   ├── security/              # Prompt filter + output scanner + CaMeL guard
│   │   └── camel-guard.ts          ← taint tracking, capability tokens
│   ├── skills/                # Dynamic skills loader
│   ├── sessions/              # Session history store
│   ├── gateway/               # Fastify HTTP/WS gateway
│   ├── config.ts              ← SEMUA env vars (Zod schema) — tambah di sini
│   ├── logger.ts              ← createLogger("module.name")
│   └── main.ts                ← entry point CLI
│
├── python/                    # Python sidecars
│   ├── delivery/streaming_voice.py ← Kokoro TTS + Whisper STT
│   ├── vision/processor.py         ← vision processing
│   └── speaker_id.py               ← [Phase 10] Resemblyzer speaker ID
│
├── prisma/schema.prisma       ← database schema (SQLite)
├── workspace/                 ← EDITH's identity files (read-only at runtime)
│   ├── SOUL.md                     ← persona + hard limits
│   ├── AGENTS.md                   ← operating instructions
│   ├── USER.md                     ← user profile (auto-updated)
│   └── MEMORY.md                   ← pinned facts
├── docs/plans/                ← Phase implementation specs
│   ├── PHASE-[N]-[NAME].md         ← baca sebelum implement phase tsb
│   └── PHASES-SUGGESTED.md         ← roadmap overview
├── edith.json                 ← runtime config (personality, channels, etc)
└── .env                       ← secrets (JANGAN commit)
```

---

## ✅ Phase Status (Apa yang sudah ada)

| Phase | Nama | Status | File Utama |
|-------|------|--------|-----------|
| OC0-OC12 | OpenClaw Foundation | ✅ | bootstrap.ts, skills/, sessions/ |
| 1 | Voice Pipeline | ✅ | src/voice/bridge.ts |
| 2 | Tests | ✅ | vitest.config.ts, __tests__/ |
| 3 | Vision | ✅ | src/vision/, python/vision/ |
| 4 | IoT | ✅ | agents/tools/system.ts |
| 5 | Security/Bugfix | ✅ | src/security/ |
| 6 | Advanced (CaMeL, MemRL, daemon) | ✅ | camel-guard.ts, memrl.ts, daemon.ts |
| 7 | Computer Use (LATS) | ✅ | src/agents/lats-planner.ts |
| 8 | Channels (Email, Calendar, SMS, Phone) | 🔶 PARTIAL | src/channels/ |
| 9 | Offline/Self-Hosted | 🔶 PARTIAL | offline mode planning done |
| 10 | Personalization | 🔶 PLANNED | docs/plans/PHASE-10-PERSONALIZATION.md |
| 11+ | Multi-agent, Distribution, etc | 📋 PLANNED | docs/plans/PHASE-*.md |

---

## ⚠️ CODE STANDARDS (WAJIB, ZERO TOLERANCE)

### 1. Setiap file baru WAJIB punya file-level JSDoc
```typescript
/**
 * @file nama-file.ts
 * @description Satu kalimat jelas tentang apa yang dilakukan file ini.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Jelaskan hubungan dengan file lain di sini.
 *
 * PAPER BASIS (kalau ada):
 *   - Nama Paper: arXiv:XXXX.XXXXX — kontribusi ke implementasi ini
 */
```

### 2. Setiap class, method, dan constant WAJIB punya JSDoc
```typescript
/** Maksimal retry attempts sebelum circuit breaker aktif. */
private static readonly MAX_RETRIES = 3

/**
 * Builds the persona fragment for this user.
 * @param userId - User identifier
 * @param context - Optional context (hour of day, urgency)
 * @returns Persona fragment string untuk injection ke system prompt
 */
async buildPersonaFragment(userId: string, context?: Context): Promise<string>
```

### 3. TypeScript strict — NO `any`, NO untyped returns
```typescript
// ❌ SALAH
async function getData(id) { return fetch(...) }

// ✅ BENAR
async function getData(id: string): Promise<UserData | null> { ... }
```

### 4. Logger — SELALU pakai createLogger, JANGAN console.log
```typescript
import { createLogger } from "../logger.js"
const log = createLogger("module.submodule")  // ← nama konsisten

log.debug("detail info", { userId, data })
log.info("operation complete", { count })
log.warn("non-fatal issue", { error })
log.error("fatal error", { userId, error })
```

### 5. Error handling — JANGAN biarkan Promise floating
```typescript
// Fire-and-forget async side effects (HARUS pakai void + catch)
void someAsyncFn(userId)
  .catch(err => log.warn("operation failed", { userId, err }))

// Kalau perlu await
try {
  await someAsyncFn()
} catch (err) {
  log.error("critical failure", { err })
  throw err  // re-throw kalau critical
}
```

### 6. Imports — WAJIB pakai `.js` extension (ESM)
```typescript
import { createLogger } from "../logger.js"   // ✅
import { createLogger } from "../logger"       // ❌
```

### 7. Singleton pattern — untuk service classes
```typescript
class MyService { ... }
export const myService = new MyService()  // ← singleton di bottom of file
```

---

## 🔄 GIT WORKFLOW (WAJIB)

**Branch aktif:** `main`

Setiap file baru atau perubahan signifikan HARUS di-commit dengan Conventional Commits:

```bash
# Format: type(scope): description
git add src/memory/user-preference.ts
git commit -m "feat(memory): add UserPreferenceEngine with CIPHER preference inference"
git push origin main

# Types: feat | fix | docs | refactor | test | chore
# Scope: memory | core | voice | channels | background | engines | security
```

**JANGAN** commit `.env`, `node_modules/`, `*.db`, `logs/`, `coverage/`.

---

## 🧪 Testing

```bash
pnpm test                          # run all tests
pnpm vitest run src/memory/__tests__/  # run specific test dir
pnpm typecheck                     # TypeScript check (HARUS green sebelum commit)
```

Test file convention: `src/[module]/__tests__/[file].test.ts`

Minimal test structure:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
// vi.mock("../../database/index")  ← mock prisma kalau perlu

describe('MyService', () => {
  it('does the thing correctly', async () => {
    // arrange → act → assert
  })
})
```

---

## 🛠️ Common Commands

```bash
pnpm dev              # run EDITH (tsx watch)
pnpm test             # run tests
pnpm typecheck        # TypeScript check
pnpm run doctor       # health check
pnpm run onboard      # setup wizard
prisma migrate dev    # run DB migration (setelah ubah schema.prisma)
prisma generate       # regenerate client (setelah ubah schema.prisma)
```

---

## 🏗️ Cara Implement Phase Baru

1. **Baca plan-nya DULU:** `docs/plans/PHASE-[N]-[NAME].md`
2. **Pahami dependencies:** Phase N butuh apa dari Phase sebelumnya?
3. **Cek file yang sudah ada:** EXTEND don't replace — gunakan `cat` atau `Read` dulu
4. **Implement per Atom** (urutan yang ada di dokumen plan)
5. **Commit setiap Atom:** 1 atom = 1 commit
6. **Tests:** Tulis test sebelum atau bersamaan (bukan setelah)
7. **Typecheck:** `pnpm typecheck` HARUS pass sebelum push

---

## 🔑 Key Patterns

### Menambah env variable baru
```typescript
// Di src/config.ts, tambah di ConfigSchema:
MY_NEW_VAR: z.string().default(""),
```

### Menambah model Prisma baru
```prisma
// Di prisma/schema.prisma
model MyModel {
  id        String   @id @default(cuid())
  userId    String
  // ...
  createdAt DateTime @default(now())
  @@index([userId])
}
```
Lalu jalankan: `prisma migrate dev --name add-my-model`

### Menambah channel baru
Implement `BaseChannel` interface dari `src/channels/base.ts`, lalu register di `src/channels/manager.ts`.

### Menambah LLM engine baru
Implement `Engine` interface dari `src/engines/types.ts`, lalu tambah ke `DEFAULT_ENGINE_CANDIDATES` dan `PRIORITY_MAP` di `orchestrator.ts`.

### Memanggil LLM dari dalam module
```typescript
import { orchestrator } from "../engines/orchestrator.js"
const result = await orchestrator.generate('fast', { prompt: "..." })
// TaskType: 'reasoning' | 'code' | 'fast' | 'multimodal' | 'local'
```

### Menyimpan ke memori
```typescript
import { memory } from "../memory/store.js"
await memory.save(userId, content, metadata)
const context = await memory.buildContext(userId, query)
```

### Fire-and-forget dari pipeline (JANGAN block response)
```typescript
// Di launchAsyncSideEffects() di message-pipeline.ts:
void myService.processAsync(userId, data)
  .catch(err => log.warn("service async failed", { userId, err }))
```

---

## 📌 File yang JANGAN Diubah Tanpa Alasan Kuat

| File | Alasan |
|------|--------|
| `workspace/SOUL.md` | Core persona — security-sensitive |
| `workspace/AGENTS.md` | Operating instructions |
| `src/security/prompt-filter.ts` | Security layer |
| `src/security/output-scanner.ts` | Security layer |
| `src/security/camel-guard.ts` | CaMeL taint tracking |
| `prisma/schema.prisma` | Harus migrate setelah ubah |
| `.env` | JANGAN pernah commit |

---

## 🧩 Phase 10 Context (Saat ini dikerjakan)

**Goal:** EDITH belajar preferensi user dari interaksi — formality, verbosity, language, habits.

**Files yang akan dibuat (dalam urutan):**
1. `src/memory/user-preference.ts` — preference sliders + CIPHER inference
2. `src/core/personality-engine.ts` — tone presets (jarvis/friday/cortana/hal) + persona fragment
3. `src/memory/feedback-store.ts` — signal collection (explicit + barge-in + edit)
4. `src/background/habit-model.ts` — routine detection dari timestamps
5. `src/background/quiet-hours.ts` — extend dengan AdaptiveQuietHours
6. `src/voice/speaker-id.ts` + `python/speaker_id.py` — Resemblyzer speaker ID (optional)
7. Wire ke `src/core/system-prompt-builder.ts` + `src/core/message-pipeline.ts`

**Baca:** `docs/plans/PHASE-10-PERSONALIZATION.md` untuk kontrak implementasi lengkap.

**Prisma model yang perlu ditambah:**
```prisma
model UserPreference {
  userId              String   @id
  formality           Float    @default(3)
  verbosity           Float    @default(2)
  humor               Float    @default(1)
  proactivity         Float    @default(3)
  language            String   @default("auto")
  titleWord           String   @default("Sir")
  tonePreset          String   @default("jarvis")
  customTraits        Json     @default("[]")
  inferenceConfidence Float    @default(0)
  preferenceHistory   Json     @default("{}")
  pendingSignals      Json     @default("[]")
  lastInferredAt      DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

---

## 💡 Tips Hemat Context

- Kalau perlu lihat isi file: baca hanya bagian yang relevan (pakai `head`/`tail`)
- Kalau perlu tahu interface/type: cek `src/engines/types.ts`, `src/channels/base.ts`, dll
- Kalau butuh contoh pola yang sudah ada: baca `src/memory/profiler.ts` (clean example)
- Kalau ragu tentang phase: baca BAGIAN 0 (First Principles) di plan docs-nya
- `pnpm typecheck` adalah source of truth — kalau merah, fix dulu
