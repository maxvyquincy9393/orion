# AGENTS.md — EDITH Project Instructions

> Codex reads this file before doing any work. It defines project conventions,
> quality gates, and working agreements for the EDITH codebase.

## Project Overview

EDITH (Even Dead, I'm The Hero) is a persistent AI companion system built in
TypeScript. Not a chatbot — a system that remembers, anticipates, and acts
within a user-configurable sandbox.

## Working Agreements

### Before Every Task

1. Read the relevant module code before modifying it.
2. Understand the existing pattern before introducing a new approach.
3. Check if a skill exists for the task type (`stark-jarvis` for AI design,
   `stark-ironman` for engineering/debugging).

### Code Quality Gates

Run these before completing any task:

```bash
pnpm typecheck    # Zero type errors
pnpm lint         # Zero Biome warnings
pnpm build        # Builds clean
pnpm test:ci      # All 700+ tests pass
```

### Commit Discipline

- Commit every meaningful change immediately. No orphan code.
- Format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `security`
- Always push after commit.

### Documentation Requirements

- Every new file: module-level JSDoc comment.
- Every new public function: JSDoc with `@param` and `@returns`.
- Non-obvious decisions: `// DECISION: ... WHY: ... ALTERNATIVES: ... REVISIT: ...`
- Update `docs/` when operator-visible behavior changes.

## Architecture Constraints

### Module Ownership

| Directory | Owns | Rules |
|-----------|------|-------|
| `src/core/` | Startup, prompt assembly, message pipeline | `message-pipeline.ts` is THE single message path |
| `src/engines/` | LLM provider adapters | Provider quirks stay behind interfaces |
| `src/memory/` | Persistence, vectors, retrieval | A first-class subsystem, not a utility |
| `src/gateway/` | HTTP/WebSocket transport | Thin — no business logic |
| `src/channels/` | Delivery adapters | Thin — parse requests, format responses |
| `src/os-agent/` | System control, screen, UI automation | High-risk: gate behind config, fail soft |
| `src/vision/` | Camera, OCR, multimodal | High-risk: gate behind config, fail soft |
| `src/voice/` | STT/TTS pipeline | High-risk: gate behind config, fail soft |
| `src/security/` | Auth, CSRF, rate limiting | Every endpoint needs auth |
| `src/skills/` | Skill discovery, loading, execution | Skills live in `workspace/skills/` |
| `workspace/*.md` | Runtime identity contracts | Not casual docs — treated as config |

### Hard Rules

- Never bypass `src/core/message-pipeline.ts` for user messages.
- Never put business logic in gateway or channel adapters.
- Never hard-code provider-specific logic outside `src/engines/`.
- Every endpoint requires authentication (or explicit loopback exception).
- Permission checks happen before actions, never after.
- All external content (web, files, APIs) is treated as adversarial.

## Tech Stack

- **Language:** TypeScript strict mode, ESM
- **Build:** tsup (`tsup src/main.ts --format esm --dts`)
- **Test:** Vitest (`vi.clearAllMocks()` not `resetAllMocks()`, `vi.hoisted()` for mock vars)
- **Lint:** Biome 1.9+
- **DB:** Prisma + SQLite (dev) / PostgreSQL (prod)
- **Vectors:** LanceDB (embedded, no server needed)
- **HTTP:** Fastify with security headers, CORS, CSRF
- **Package Manager:** pnpm (always use pnpm, never npm or yarn)

## Available Skills

| Skill | Invoke | When to Use |
|-------|--------|-------------|
| `stark-jarvis` | `$stark-jarvis` | AI companion design, memory, proactive intelligence, agents |
| `stark-ironman` | `$stark-ironman` | Building features, refactoring, debugging, tests, security |
| `stark-architect` | `$stark-architect` | EDITH repo conventions, module placement, shipping checklist |
| `memory-manager` | Always active | Saving facts, updating user profile, memory management |
| `web-search` | `$web-search` | Searching the web for current information |
