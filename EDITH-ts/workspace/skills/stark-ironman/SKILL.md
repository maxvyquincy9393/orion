---
name: stark-ironman
description: "Stark-style iterative engineering — rapid prototyping, modular architecture, test-driven hardening."
version: 1.0.0
metadata:
  edith:
    alwaysActive: false
    emoji: "⚙️"
    invokeKey: ironman
    os: [windows, linux, macos]
---

# Stark Iron Man — Iterative Engineering & Rapid Prototyping

> "Sometimes you gotta run before you can walk."
> — Tony Stark built Mark I in a cave. With a box of scraps.

Build, test, break, fix, ship. Each iteration solves exactly one class of
problems. No design docs that never become code.

---

## The Iron Man Engineering Method

### Mark I — Make It Work

- Smallest runnable prototype. Demo in 5 minutes or scope is too big.
- Hard-code what you must. Config comes in Mark II.
- Write one test proving core behavior. Ship it.

### Mark II — Make It Right

- Extract config (Zod schemas). Define typed interfaces.
- Add error handling: fallback chains, structured logging, retries.
- Expand test coverage: happy path + edge cases + failure modes.

### Mark III — Make It Hard to Break

- Security audit every input boundary and action.
- Observability: structured logs, metrics, health checks.
- Chaos testing: LLM down, memory full, malformed input.

---

## Component Ownership

```
src/core/     → Message pipeline (THE spine)
src/engines/  → LLM providers behind interfaces
src/memory/   → Persistence, retrieval, vectors
src/gateway/  → HTTP/WS transport (thin)
src/channels/ → Delivery adapters (thin)
src/os-agent/ → System control, screen, UI
src/security/ → Auth, CSRF, rate limits
```

Rules: each module owns its domain. Extend before creating. Interfaces at boundaries.

---

## Testing Rules

- Every behavior gets a test. `vi.clearAllMocks()` in beforeEach.
- `vi.hoisted()` for mock factory variables. Behavior specs, not "test X".
- Test failure modes: timeouts, missing files, empty results.

## Debugging Sequence

1. Reproduce (failing test) → 2. Isolate (module boundary) → 3. Read logs →
4. Fix at source → 5. Verify (test passes) → 6. Document (decision comment)

## Security — Defense in Depth

```
Input → Validation → Auth → Permission → Action → Logging
```

Every change: validate input, check permissions, timeout externals, auth endpoints.

## Code Standards

- File headers, JSDoc, decision comments.
- Commits: immediate, `type(scope): description`, always push.
- Run `pnpm typecheck && pnpm lint && pnpm test` before shipping.
