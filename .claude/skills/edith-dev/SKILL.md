---
name: edith-dev
description: >
  Context skill for developing EDITH — a persistent AI companion (TypeScript/ESM, pnpm,
  Prisma/SQLite, Python sidecars, Fastify gateway). Load this skill when working on any
  EDITH source file, implementing a new phase, adding a feature, writing tests, modifying
  the pipeline, schema, channels, memory system, or LLM engine. Also load when the user
  asks about project structure, code conventions, git workflow, or what phase to work on next.
  This skill dramatically reduces context waste by giving Claude the full map upfront.
license: MIT
allowed-tools:
  - read
  - edit
  - bash
  - write
metadata:
  category: development
  complexity: advanced
  compatibility: Claude Code 1.0+
---

# EDITH — Developer Context Skill

EDITH is a **persistent AI companion** — not a generic chatbot. Think JARVIS.
Stack: TypeScript (ESM) · pnpm monorepo · Prisma/SQLite · Python sidecars · Fastify gateway.
Active branch: `design`. Test runner: `vitest`.

---

## Navigation Map

Before touching any file, orient yourself here. Read only what you need.

```
src/
  core/
    message-pipeline.ts      ← ENTRY POINT — 9-stage pipeline, all messages pass here
    system-prompt-builder.ts ← assembles final system prompt (inject persona here)
    persona.ts               ← runtime mood/expertise/topic detection
    personality-engine.ts    ← [Phase 10] per-user tone presets (jarvis/friday/hal)
    bootstrap.ts             ← reads SOUL.md, AGENTS.md, USER.md at startup
    startup.ts               ← initializes all services in order

  engines/
    orchestrator.ts          ← LLM routing: TaskType → provider with fallback
    types.ts                 ← TaskType = 'reasoning'|'code'|'fast'|'multimodal'|'local'
    [provider].ts            ← anthropic / groq / gemini / openai / openrouter / ollama

  memory/
    store.ts                 ← LanceDB vector store (embed + retrieve)
    memrl.ts                 ← MemRL Q-learning, IEU triplets, Bellman updates
    profiler.ts              ← UserProfile (facts + opinions extracted from messages)
    user-preference.ts       ← [Phase 10] preference sliders (formality, verbosity, humor)
    feedback-store.ts        ← [Phase 10] signal collection (explicit + barge-in + edit)
    hybrid-retriever.ts      ← vector + FTS5 lexical hybrid search
    causal-graph.ts          ← CausalNode/Edge knowledge graph

  background/
    daemon.ts                ← background loop, proactive trigger firing
    habit-model.ts           ← [Phase 10] routine detection from message timestamps
    quiet-hours.ts           ← quiet hours guard (hardcoded + adaptive extension)
    triggers.ts              ← proactive trigger definitions

  channels/
    manager.ts               ← ChannelManager: register + dispatch all channels
    base.ts                  ← BaseChannel interface (implement this for new channels)
    telegram.ts / discord.ts / whatsapp.ts / webchat.ts

  voice/
    bridge.ts                ← VoiceBridge: STT/TTS orchestration
    speaker-id.ts            ← [Phase 10] Resemblyzer multi-user speaker ID

  security/
    camel-guard.ts           ← CaMeL taint tracking + capability tokens
    prompt-filter.ts         ← input sanitisation
    output-scanner.ts        ← output safety scanner

  config.ts                  ← ALL env vars as Zod schema — add new vars here
  logger.ts                  ← createLogger("module.submodule")

python/
  delivery/streaming_voice.py  ← Kokoro TTS + Whisper STT sidecar
  vision/processor.py          ← vision processing sidecar
  speaker_id.py                ← [Phase 10] Resemblyzer FastAPI sidecar

prisma/schema.prisma           ← SQLite schema — migrate after every change
workspace/                     ← EDITH's identity (read-only at runtime)
  SOUL.md                      ← persona + hard limits
  AGENTS.md                    ← operating instructions
docs/plans/PHASE-[N]-*.md      ← implementation spec per phase — READ BEFORE IMPLEMENTING
```

---

## Phase Status

| Phase | Status | Key Files |
|-------|--------|-----------|
| OC0–OC12 (Foundation) | ✅ Done | bootstrap.ts, skills/, sessions/, security/ |
| 1 Voice | ✅ Done | src/voice/bridge.ts |
| 2 Tests | ✅ Done | vitest.config.ts |
| 3 Vision | ✅ Done | src/vision/, python/vision/ |
| 4 IoT | ✅ Done | src/agents/tools/system.ts |
| 5 Security/Bugfix | ✅ Done | src/security/ |
| 6 Advanced (CaMeL, MemRL, daemon) | ✅ Done | camel-guard.ts, memrl.ts, daemon.ts |
| 7 Computer Use (LATS) | ✅ Done | src/agents/lats-planner.ts |
| 8 Channels | 🔶 Partial | src/channels/ |
| 9 Offline/Local LLM | 🔶 Partial | engines/ollama.ts |
| **10 Personalization** | 📋 **In Progress** | docs/plans/PHASE-10-PERSONALIZATION.md |
| 11+ Multi-agent, Distribution… | 📋 Planned | docs/plans/PHASE-*.md |

**Currently working on Phase 10.** Read `docs/plans/PHASE-10-PERSONALIZATION.md` for the full spec.

---

## Code Standards (Non-Negotiable)

These standards are enforced across the entire codebase. Follow them exactly.

### File-level JSDoc (every new file)
```typescript
/**
 * @file filename.ts
 * @description One clear sentence about what this module does.
 *
 * ARCHITECTURE:
 *   Describe relationships with other modules here.
 *
 * PAPER BASIS (if research-backed):
 *   - Paper Name: arXiv:XXXX.XXXXX — what it contributes
 */
```

### Types: strict, no `any`, explicit return types
```typescript
// ✅
async function getUser(id: string): Promise<UserProfile | null> { ... }
// ❌ never do this
async function getUser(id) { ... }
```

### Logger: always `createLogger`, never `console.log`
```typescript
import { createLogger } from "../logger.js"
const log = createLogger("memory.user-preference")  // dot-separated path

log.debug("inference cycle", { userId, signals: signals.length })
log.info("preference updated", { userId, dimension, newValue })
log.warn("low confidence", { userId, confidence })
log.error("write failed", { userId, err })
```

### Async side-effects: never block the pipeline
```typescript
// Fire-and-forget from Stage 9 of message-pipeline.ts:
void myService.processAsync(userId, data)
  .catch(err => log.warn("async failed", { userId, err }))
```

### Imports: always `.js` extension (ESM requirement)
```typescript
import { createLogger } from "../logger.js"   // ✅
import { createLogger } from "../logger"       // ❌
```

### Singleton export pattern
```typescript
class MyService { ... }
export const myService = new MyService()  // at bottom of file
```

---

## Key Patterns (copy-paste ready)

### Call the LLM
```typescript
import { orchestrator } from "../engines/orchestrator.js"
const result = await orchestrator.generate('fast', { prompt: "..." })
// TaskTypes: 'reasoning' | 'code' | 'fast' | 'multimodal' | 'local'
```

### Save to / retrieve from memory
```typescript
import { memory } from "../memory/store.js"
await memory.save(userId, content, { category: "preference" })
const context = await memory.buildContext(userId, query)
```

### Add a new env variable
In `src/config.ts`, add to the `ConfigSchema` Zod object:
```typescript
MY_NEW_VAR: z.string().default(""),
```

### Add a new Prisma model
In `prisma/schema.prisma`, add the model, then run:
```bash
prisma migrate dev --name add-my-model
```

### Add a new channel
Implement `BaseChannel` from `src/channels/base.ts`, register in `src/channels/manager.ts`.

### Add a new LLM engine
Implement `Engine` from `src/engines/types.ts`, add to `DEFAULT_ENGINE_CANDIDATES` and `PRIORITY_MAP` in `orchestrator.ts`.

---

## Git Workflow

Branch: `design`. Use Conventional Commits — one commit per implementation atom.

```bash
git add src/memory/user-preference.ts
git commit -m "feat(memory): add UserPreferenceEngine with CIPHER inference"
git push origin design

# Types: feat | fix | docs | refactor | test | chore
# Scopes: memory | core | voice | channels | background | engines | security
```

---

## Common Commands

```bash
pnpm dev              # run EDITH (tsx)
pnpm test             # vitest
pnpm typecheck        # tsc --noEmit  ← must be green before push
pnpm run doctor       # health check
prisma migrate dev    # run DB migration
prisma generate       # regenerate Prisma client
```

---

## Phase 10 — What Needs to Be Built

Read the full spec: `docs/plans/PHASE-10-PERSONALIZATION.md`

Files to create (in order — 1 atom = 1 commit):

| Atom | File | What |
|------|------|------|
| 0 | `src/memory/user-preference.ts` | Preference sliders + CIPHER inference + temporal decay |
| 1 | `src/core/personality-engine.ts` | Tone presets (jarvis/friday/cortana/hal) + buildPersonaFragment() |
| 2 | `src/memory/feedback-store.ts` | Explicit + barge-in + edit signal collection |
| 3 | `src/background/habit-model.ts` | Routine detection from timestamps |
| 4 | `src/background/quiet-hours.ts` | Extend with AdaptiveQuietHours class |
| 5 | `src/voice/speaker-id.ts` + `python/speaker_id.py` | Resemblyzer speaker ID (optional) |
| 6 | Tests | 40 tests across 4 files |
| 7 | Wire-up | system-prompt-builder.ts + message-pipeline.ts Stage 9 |

Prisma model needed (add to `prisma/schema.prisma`):
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

## Files to Never Modify Without Good Reason

| File | Why |
|------|-----|
| `workspace/SOUL.md` | Core persona — security-sensitive runtime config |
| `workspace/AGENTS.md` | Operating instructions — security-sensitive |
| `src/security/prompt-filter.ts` | Breaks security layer |
| `src/security/camel-guard.ts` | CaMeL taint tracking |
| `prisma/schema.prisma` | Needs migration — coordinate changes |
| `.env` | Never commit — secrets |

---

## Context-Saving Tips

- Read only the part of a file you need (`head`/`tail` / specific line range)
- Check `src/engines/types.ts` and `src/channels/base.ts` for interface contracts before implementing
- `src/memory/profiler.ts` is the cleanest example of the expected code style
- `pnpm typecheck` is the source of truth — red = fix before pushing
- For any phase: read the plan doc FIRST, implement SECOND
