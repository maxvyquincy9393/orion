---
name: stark-ironman
description: >-
  Think like Tony Stark building and iterating the Iron Man suit — rapid prototyping,
  modular architecture, test-driven hardening, and defense-in-depth engineering.
  Use when building new features, refactoring systems, debugging complex issues,
  writing tests, or hardening security. Do NOT use for pure AI/ML design or
  conversational AI architecture (use stark-jarvis instead).
license: MIT
compatibility: Designed for VS Code Copilot, OpenAI Codex, and EDITH internal loader
metadata:
  author: edith-project
  version: "1.0.0"
  edith-emoji: "⚙️"
  edith-always-active: "false"
  edith-invoke-key: "ironman"
---

# Stark Iron Man — Iterative Engineering & Rapid Prototyping

> "Sometimes you gotta run before you can walk."
> — Tony Stark built Mark I in a cave. With a box of scraps.

Operate as if you're Stark in the garage: Mark I is ugly but it flies. Mark II
is faster. Mark III has weapons. Each iteration solves exactly one class of
problems and ships. No design docs that never become code. No perfect
architectures that never run. Build, test, break, fix, ship.

---

## The Iron Man Engineering Method

### Phase 1: Mark I — Make It Work

The first version does one thing and proves the concept. Nothing more.

- **Start with the smallest runnable prototype.** If you can't demo it in 5
  minutes, the scope is too big.
- **Hard-code what you must.** Config comes in Mark II.
- **Skip optimization.** Correct behavior first, performance second.
- **Write at least one test** that proves the core behavior works.
- Ship it. Get feedback. Move to Mark II.

```typescript
// Mark I: hard-coded, minimal, proves the concept
// DECISION: Hard-code provider to OpenAI for initial prototype
// WHY: Fastest path to working demo, engine abstraction is Mark II
// REVISIT: When adding second provider support
```

### Phase 2: Mark II — Make It Right

The second version introduces structure, config, and proper interfaces.

- **Extract hard-coded values into config.** Prefer Zod-backed schemas.
- **Define interfaces** between modules. Each module owns one concern.
- **Add proper error handling.** Fallback chains, structured logging, retry logic.
- **Expand test coverage.** Happy path + edge cases + failure modes.
- **Document the interfaces.** Other modules will depend on them.

```typescript
// Mark II: configurable, typed, interface-driven
/**
 * Engine interface — all LLM providers implement this contract.
 * Provider-specific quirks (rate limits, token formats) stay
 * inside the adapter. Business logic sees only this surface.
 */
interface EngineAdapter {
  generate(prompt: string, options: GenerateOptions): Promise<EngineResponse>
  estimateTokens(text: string): number
  readonly providerId: string
}
```

### Phase 3: Mark III — Make It Hard to Break

The third version hardens, optimizes, and prepares for production.

- **Security audit.** Every input boundary gets validation. Every action gets
  permission checks. Every external interaction gets sanitized.
- **Performance profiling.** Identify bottlenecks with real data, not guesses.
- **Observability.** Structured logs, metrics, health checks.
- **Chaos testing.** What happens when the LLM is down? When memory is full?
  When the user sends malformed input?
- **Documentation for operators.** Not just code comments — runbooks.

```typescript
// Mark III: hardened, observable, production-ready
/**
 * Validate and sanitize user input before processing.
 *
 * Applies length limits, strips control characters, and checks
 * for prompt injection patterns. Logs suspicious inputs for
 * security monitoring without blocking legitimate requests.
 *
 * @param raw - The raw user input string
 * @param limits - Configurable validation limits
 * @returns Sanitized input or validation error with reason
 */
function validateInput(raw: string, limits: InputLimits): Result<string, ValidationError> {
```

---

## Modular Architecture — The Suit is Components

Tony's suit isn't monolithic. Each piece (repulsors, arc reactor, HUD, flight
system) is a module with a clean interface. EDITH follows the same principle.

### Component Ownership Map

```
src/core/          → Startup, prompt assembly, message pipeline (THE spine)
src/engines/       → LLM providers behind stable interfaces
src/memory/        → Persistence, retrieval, vector search, feedback loops
src/gateway/       → HTTP/WebSocket transport (no business logic here)
src/channels/      → Delivery adapters: Telegram, Discord, etc.
src/os-agent/      → System control, screen capture, UI automation
src/vision/        → Camera, OCR, multimodal understanding
src/voice/         → STT/TTS pipeline
src/agents/        → LangGraph task agents
src/skills/        → Skill discovery, loading, execution
src/security/      → Auth, CSRF, rate limiting, permission enforcement
```

### Rules of Engagement

1. **Each module owns its domain.** Gateway doesn't do memory. Memory doesn't do
   transport. Agents don't do auth.
2. **Extend before creating.** If a module exists for the concern, extend it.
   Don't create a parallel path.
3. **Interfaces at boundaries.** Modules communicate through typed contracts,
   never by reaching into each other's internals.
4. **Config over code branching.** Feature flags and Zod-backed config, not
   `if (provider === "openai")` scattered everywhere.
5. **Transport edges are thin.** Gateway and channel adapters parse requests and
   format responses. All logic lives in core/engines/memory.

---

## Testing Strategy — Stark Never Flew Untested

### Test Pyramid

```
      ╱ E2E ╲           Few, slow, high confidence
     ╱───────╲
    ╱ Integration╲       Module boundaries, real I/O mocked
   ╱─────────────╲
  ╱   Unit Tests   ╲    Fast, isolated, every behavior
```

### Testing Rules

- **Every new behavior gets a test.** No exceptions.
- **Unit tests are fast and isolated.** Mock external dependencies, not internal
  logic. Use `vi.mock()` for module boundaries only.
- **Use `vi.clearAllMocks()` in `beforeEach`.** Never `vi.resetAllMocks()` with
  ESM mocks — it destroys mock implementations.
- **Use `vi.hoisted()` for mock factory variables** to avoid temporal dead zone
  issues with `vi.mock()` hoisting.
- **Test failure modes.** What happens when the LLM times out? When the file
  doesn't exist? When memory search returns nothing?
- **Name tests as behavior specs:** `"returns fallback when primary engine fails"`,
  not `"test error handling"`.

```typescript
// Good: behavior spec with clear assertion
it("returns Tesseract fallback when cloud OCR rate-limited", async () => {
  mockCloudOCR.mockRejectedValueOnce(new Error("429 rate limited"));
  const result = await cortex.recognizeText(testImage);
  expect(result.source).toBe("tesseract");
  expect(result.text).toContain("extracted content");
});
```

### Verification Commands

```bash
pnpm test -- <target>     # Run targeted tests near your change
pnpm typecheck             # Zero type errors, always
pnpm lint                  # Clean code, no warnings
pnpm build                 # Builds successfully
pnpm test:ci               # Full suite passes before shipping
```

---

## Debugging — Stark's Diagnostic Mode

When something breaks, follow this sequence:

1. **Reproduce.** Write a failing test that captures the exact bug.
2. **Isolate.** Narrow down which module owns the failure. Check module
   boundaries first.
3. **Read the logs.** Structured logs exist for a reason. Check operation,
   input, error, and fallback fields.
4. **Fix at the source.** Don't patch symptoms. If the rate limiter recurses
   infinitely, fix the rate limiter — don't add a try/catch around it.
5. **Verify.** The failing test now passes. No other tests break.
6. **Document.** If the fix reveals a non-obvious pattern, add a decision
   comment explaining why.

```typescript
// DECISION: Replace recursive waitForRateLimit with iterative sleep
// WHY: Recursive call with no base case caused RangeError: Maximum call stack
// ALTERNATIVES: Adding recursion depth limit (brittle), setTimeout chain (complex)
// REVISIT: If rate limiting strategy changes to token bucket
```

---

## Security — Defense in Depth

Tony's suits have redundant systems. If one fails, others compensate.

### Layer Model

```
[User Input] → Validation → Auth → Permission → Action → Logging
                   │          │         │           │        │
                Sanitize   Token     Sandbox    Execute   Audit
                + Limits   + CSRF   + Config   + Timeout  Trail
```

### Security Checklist for Every Change

- [ ] Does this accept user input? → Validate and sanitize.
- [ ] Does this perform an action? → Check permissions first.
- [ ] Does this call an external service? → Timeout, retry limit, error handling.
- [ ] Does this expose an endpoint? → Auth required (or explicit loopback-only exception).
- [ ] Does this store data? → Check retention policy and encryption needs.
- [ ] Does this log data? → Ensure no secrets or PII in logs.

---

## Code Standards — Workshop Discipline

### Every File: Module Header

```typescript
/**
 * rate-limiter.ts
 *
 * Token-bucket rate limiter for outbound LLM and API calls.
 * Enforces per-provider limits from config and provides
 * observable wait metrics for monitoring.
 *
 * Part of EDITH — Persistent AI Companion System.
 */
```

### Every Function: JSDoc

```typescript
/**
 * Wait until the rate limit window allows the next call.
 *
 * Calculates time since last call and sleeps if the minimum
 * interval hasn't elapsed. Non-recursive — uses a single
 * setTimeout to avoid stack growth.
 *
 * @param providerKey - Which provider's rate limit to check
 * @returns Promise that resolves when the call is allowed
 */
```

### Every Non-Obvious Decision: Inline Comment

```typescript
// DECISION: [what]
// WHY: [reason]
// ALTERNATIVES: [rejected options]
// REVISIT: [trigger condition]
```

### Every Change: Commit Immediately

```bash
git add .
git commit -m "fix(vision): replace recursive rate-limit with iterative sleep"
git push origin main
```

Format: `type(scope): description`
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `security`

---

## Anti-Patterns — What Iron Man Would Never Do

- Ship Mark III code quality with Mark I test coverage.
- Create a "utils" folder that becomes a dumping ground.
- Add a feature without updating the module that owns the concern.
- Bypass permission checks with `// TODO: add auth later`.
- Use `any` type when a proper interface exists.
- Add error handling that swallows errors silently.
- Create a new abstraction for a one-time operation.
- Push code without running `pnpm typecheck && pnpm lint && pnpm test`.
- Leave `console.log` debugging in production code.
- Hard-code secrets, paths, or provider URLs outside of config.

---

## Shipping Checklist

Before marking any task complete:

1. [ ] Code lives in the correct module (not a random helper file).
2. [ ] Types are correct — `pnpm typecheck` passes.
3. [ ] Linter is clean — `pnpm lint` passes.
4. [ ] Tests cover the change — at least happy path + one failure mode.
5. [ ] `pnpm build` succeeds.
6. [ ] Comments explain non-obvious decisions.
7. [ ] File headers and function JSDoc are present on new code.
8. [ ] Committed with conventional format and pushed.
9. [ ] Security checklist reviewed if touching input/auth/endpoints.
10. [ ] Docs updated if operator-visible behavior changed.
