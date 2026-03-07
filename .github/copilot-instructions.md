# EDITH — Copilot Custom Instructions

> These instructions are loaded automatically by GitHub Copilot for every
> interaction in this repository. They define coding standards, project
> conventions, and quality expectations.

## Project Identity

EDITH (Even Dead, I'm The Hero) is a **persistent AI companion system** — not a
chatbot. It runs in the background, remembers everything, acts proactively, and
can see, browse, and control the user's system within a configurable sandbox.

## Tech Stack

- **Language:** TypeScript (strict mode, ESM)
- **Runtime:** Node.js
- **Build:** tsup (ESM output)
- **Test:** Vitest
- **Lint:** Biome
- **Database:** Prisma + SQLite (dev), PostgreSQL (prod)
- **Vectors:** LanceDB (embedded)
- **HTTP:** Fastify
- **Package Manager:** pnpm

## Coding Standards

### Style

- Use TypeScript strict mode. No `any` unless absolutely unavoidable.
- Prefer `const` over `let`. Never use `var`.
- Use ESM imports (`import`/`export`), never CommonJS.
- File extensions in imports: always `.js` (TypeScript ESM convention).

### Documentation

- Every new file: module-level JSDoc comment explaining purpose.
- Every new public function: JSDoc with `@param`, `@returns`, one-sentence desc.
- Non-obvious decisions: `// DECISION: ... WHY: ... ALTERNATIVES: ... REVISIT: ...`
- No orphan code — every change is committed immediately.

### Testing (Vitest)

- Use `vi.clearAllMocks()` in `beforeEach`, never `vi.resetAllMocks()` with ESM.
- Use `vi.hoisted()` for mock factory variables.
- Test names are behavior specs: `"returns fallback when provider fails"`.
- Cover happy path + at least one failure mode.

### Commits

- Format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `security`
- Commit after every meaningful change. Push immediately.

## Architecture Rules

- `src/core/message-pipeline.ts` is the ONE canonical message path. Never bypass.
- `src/gateway/` and `src/channels/` are transport edges — no logic.
- `src/engines/` hides provider quirks behind stable interfaces.
- `src/memory/` is a first-class subsystem — retrieval must stay coherent.
- `workspace/*.md` are runtime identity contracts, not casual docs.
- Every endpoint requires auth (or explicit loopback-only exception).
- Permission checks happen before actions, never after.

## Verification

Before shipping any change:

```bash
pnpm typecheck    # Zero type errors
pnpm lint         # Zero Biome warnings
pnpm build        # Successful build
pnpm test:ci      # All tests pass
```

## Available Skills

Use `$stark-jarvis` when designing AI companion behavior, memory, proactive
intelligence, or agent orchestration.

Use `$stark-ironman` when building features, refactoring, debugging, writing
tests, or hardening security.

Use `$stark-architect` for EDITH-specific repo conventions and module ownership.
