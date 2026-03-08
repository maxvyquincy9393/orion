# Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all P0 (blocking) and P1 (important) issues identified in the production-readiness audit so EDITH's core pipeline is verified, TypeScript is clean, and the process is stable.

**Architecture:** Fix-first (no new features): patch mocks → fix config gaps → add startup guard → add Python sidecar supervisor → audit stub channels.

**Tech Stack:** TypeScript ESM, vitest, Zod (config), Node.js child_process, Prisma/SQLite

---

## Task 1 — Fix TypeScript: add missing config vars

**Files:**
- Modify: `src/config.ts`

Root cause: `src/security/pipeline-rate-limiter.ts` references `PIPELINE_RATE_LIMIT_PER_MIN`
and `src/vision/providers.ts` references `VISION_GEMINI_MODEL`, `VISION_OPENAI_MODEL`,
`VISION_CLAUDE_MODEL`, `VISION_OLLAMA_MODEL` — none are in ConfigSchema.

**Step 1: Read the current ConfigSchema**

Read `src/config.ts` lines 1-120 to find where to insert.

**Step 2: Add the missing vars to ConfigSchema**

In the `ConfigSchema` object, find the existing `VISION_ENGINE` entry and add after it:

```typescript
  VISION_GEMINI_MODEL:  z.string().default("gemini-1.5-flash"),
  VISION_OPENAI_MODEL:  z.string().default("gpt-4o"),
  VISION_CLAUDE_MODEL:  z.string().default("claude-opus-4-5"),
  VISION_OLLAMA_MODEL:  z.string().default("llava"),
```

Find the `SECURITY_` block (or any nearby area) and add:

```typescript
  PIPELINE_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
```

**Step 3: Verify**

Run: `pnpm typecheck`
Expected: 0 errors (or only unrelated errors)

**Step 4: Commit**

```bash
git add src/config.ts
git commit -m "fix(config): add VISION model vars and PIPELINE_RATE_LIMIT_PER_MIN to ConfigSchema"
```

---

## Task 2 — Fix message-pipeline.test.ts: add missing orchestrator mock method

**Files:**
- Modify: `src/core/__tests__/message-pipeline.test.ts`

Root cause: `message-pipeline.ts` calls `orchestrator.getLastUsedEngine()` at Stage 5
to record metrics, but the test mock for `orchestrator` only has `generate`.
This causes a `TypeError` that crashes every single test (62/65 failing).

**Step 1: Read the current mock**

Read `src/core/__tests__/message-pipeline.test.ts` lines 129-136.

**Step 2: Add `getLastUsedEngine` to the mock**

Find:
```typescript
vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn().mockResolvedValue("mocked assistant reply"),
  },
}))
```

Replace with:
```typescript
vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn().mockResolvedValue("mocked assistant reply"),
    getLastUsedEngine: vi.fn().mockReturnValue({ name: "groq" }),
  },
}))
```

**Step 3: Run tests**

Run: `pnpm vitest run src/core/__tests__/message-pipeline.test.ts`
Expected: 65/65 passing (previously 3/65)

**Step 4: Commit**

```bash
git add src/core/__tests__/message-pipeline.test.ts
git commit -m "fix(test): add getLastUsedEngine to orchestrator mock in pipeline tests"
```

---

## Task 3 — Fix push-service.test.ts: quiet-hours time pollution

**Files:**
- Modify: `src/gateway/__tests__/push-service.test.ts`

Root cause: `isInQuietHours()` calls `new Date()` at test-run time. Tests run at ~23:11
which IS inside the 23:00–07:00 quiet window, so all "normal"/"low" priority send calls
return early before reaching `fetch`. Fix: use `vi.useFakeTimers()` in `beforeEach`
set to noon (outside quiet window), then restore in `afterEach`.

**Step 1: Read the current beforeEach**

Read `src/gateway/__tests__/push-service.test.ts` lines 55-80.

**Step 2: Add fake timer setup to beforeEach**

After `vi.clearAllMocks()` but BEFORE any other setup, add:
```typescript
vi.useFakeTimers()
vi.setSystemTime(new Date("2024-06-15T12:00:00"))   // noon — outside all quiet windows
```

**Step 3: Add afterEach to restore real timers**

After the `beforeEach` block, add:
```typescript
afterEach(() => {
  vi.useRealTimers()
})
```

**Step 4: Remove duplicate vi.useFakeTimers/useRealTimers from individual tests**

Find both tests that currently call `vi.useFakeTimers()` and `vi.useRealTimers()`:
- "suppresses non-critical notification during quiet hours"
- "sends critical notification even during quiet hours"

In each test, REMOVE the `vi.useFakeTimers()` and `vi.useRealTimers()` lines.
Keep the `vi.setSystemTime(...)` calls (they still need to override to 02:00).

**Step 5: Run tests**

Run: `pnpm vitest run src/gateway/__tests__/push-service.test.ts`
Expected: 17/17 passing (previously 13/17)

**Step 6: Commit**

```bash
git add src/gateway/__tests__/push-service.test.ts
git commit -m "fix(test): use fake timers at noon in push-service beforeEach to avoid quiet-hours pollution"
```

---

## Task 4 — Fix metrics test (if still failing)

**Files:**
- Modify: `src/observability/__tests__/metrics.test.ts`

**Step 1: Run the test and read the error**

Run: `pnpm vitest run src/observability/__tests__/metrics.test.ts`
Read the actual error message carefully.

**Step 2: Apply targeted fix**

If the failure is a stale import/mock issue, add `vi.resetModules()` in `beforeEach`.
If it's a type mismatch, fix the assertion.

**Step 3: Run test again**

Expected: 19/19 passing

**Step 4: Commit**

```bash
git add src/observability/__tests__/metrics.test.ts
git commit -m "fix(test): fix metrics test failure"
```

---

## Task 5 — Full test suite green check

**Step 1: Run all tests**

Run: `pnpm test`
Expected: 1022/1022 passing (0 failures across all 75 files)

If any test is still failing, read the error and fix it before proceeding to Task 6.

---

## Task 6 — Startup env validation guard

**Files:**
- Modify: `src/core/startup.ts`

Goal: Crash fast with a clear message if a required env var is missing.
Currently EDITH starts silently even with no API keys, then crashes later with obscure errors.

**Step 1: Read startup.ts**

Read `src/core/startup.ts` lines 1-50 to understand the init sequence.

**Step 2: Add a `validateRequiredEnv()` function at the top of startup.ts**

Add this function BEFORE `initializeServices()`:

```typescript
/**
 * Validates that at least one LLM API key is configured.
 * Crashes with an actionable error message rather than a confusing runtime failure.
 *
 * Called once at the top of initializeServices().
 */
function validateRequiredEnv(): void {
  const llmKeys = [
    { key: "ANTHROPIC_API_KEY",  value: config.ANTHROPIC_API_KEY  },
    { key: "OPENAI_API_KEY",     value: config.OPENAI_API_KEY     },
    { key: "GEMINI_API_KEY",     value: config.GEMINI_API_KEY     },
    { key: "GROQ_API_KEY",       value: config.GROQ_API_KEY       },
    { key: "OPENROUTER_API_KEY", value: config.OPENROUTER_API_KEY },
  ]

  const hasLLM = llmKeys.some(({ value }) => value && value.trim().length > 0)
  if (!hasLLM) {
    log.error("STARTUP FAILED: no LLM API key configured", {
      required: "Set at least one of: " + llmKeys.map(k => k.key).join(", "),
      hint: "Copy .env.example to .env and fill in at least one API key",
    })
    process.exit(1)
  }

  if (!config.DATABASE_URL) {
    log.error("STARTUP FAILED: DATABASE_URL is not set", {
      hint: "Set DATABASE_URL in your .env file (e.g. DATABASE_URL=file:./edith.db)",
    })
    process.exit(1)
  }

  log.info("env validation passed")
}
```

**Step 3: Call it at the very start of initializeServices()**

Find `export async function initializeServices(` and add as first line of the function body:
```typescript
validateRequiredEnv()
```

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 5: Commit**

```bash
git add src/core/startup.ts
git commit -m "feat(core): add startup env validation — crash fast with actionable error"
```

---

## Task 7 — Python sidecar process supervisor

**Files:**
- Create: `src/core/sidecar-manager.ts`
- Modify: `src/core/startup.ts`

Goal: When `bridge.ts` spawns Python sidecars via `execa`, there's no restart on crash.
Add a `SidecarManager` that tracks child processes and restarts them with backoff.

**Step 1: Create `src/core/sidecar-manager.ts`**

```typescript
/**
 * @file sidecar-manager.ts
 * @description Manages Python sidecar process lifecycle with auto-restart.
 *
 * ARCHITECTURE:
 *   VoiceBridge and VisionBridge spawn Python subprocesses on demand.
 *   SidecarManager tracks long-running sidecars and restarts them if they
 *   exit unexpectedly, using exponential backoff to avoid tight restart loops.
 *   Sidecars are registered by name (e.g. "voice", "vision") and can be
 *   queried for health status.
 *
 * PAPER BASIS:
 *   Exponential backoff: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */

import { spawn, type ChildProcess } from "node:child_process"
import { createLogger } from "../logger.js"

const log = createLogger("core.sidecar-manager")

/** Configuration for a managed sidecar process. */
export interface SidecarConfig {
  /** Unique name for this sidecar (e.g. "voice", "vision"). */
  name: string
  /** The command to run (e.g. "python"). */
  command: string
  /** Arguments to pass (e.g. ["-m", "delivery.streaming_voice"]). */
  args: string[]
  /** Working directory for the process. */
  cwd: string
  /** Whether to auto-restart on crash (default: true). */
  autoRestart?: boolean
  /** Maximum restart attempts before giving up (default: 5). */
  maxRestarts?: number
}

/** Runtime state of a tracked sidecar. */
interface SidecarState {
  config: SidecarConfig
  process: ChildProcess | null
  restartCount: number
  healthy: boolean
  startedAt: Date | null
}

/**
 * SidecarManager — tracks and supervises long-running Python child processes.
 *
 * Usage:
 *   sidecarManager.register({ name: "voice", command: "python", args: [...], cwd: "..." })
 *   sidecarManager.start("voice")
 */
export class SidecarManager {
  /** Registry of all known sidecars. */
  private readonly sidecars = new Map<string, SidecarState>()

  /** Maximum backoff delay in ms (caps at 30 seconds). */
  private static readonly MAX_BACKOFF_MS = 30_000

  /**
   * Register a sidecar configuration. Does not start the process.
   *
   * @param config - Sidecar configuration
   */
  register(config: SidecarConfig): void {
    this.sidecars.set(config.name, {
      config,
      process: null,
      restartCount: 0,
      healthy: false,
      startedAt: null,
    })
    log.debug("sidecar registered", { name: config.name })
  }

  /**
   * Start a registered sidecar.
   *
   * @param name - Sidecar name (must be registered first)
   */
  start(name: string): void {
    const state = this.sidecars.get(name)
    if (!state) {
      log.warn("sidecar not registered", { name })
      return
    }
    this._spawn(state)
  }

  /**
   * Stop a sidecar and disable auto-restart.
   *
   * @param name - Sidecar name
   */
  stop(name: string): void {
    const state = this.sidecars.get(name)
    if (!state) return
    state.config.autoRestart = false
    state.process?.kill("SIGTERM")
    state.healthy = false
    log.info("sidecar stopped", { name })
  }

  /**
   * Stop all managed sidecars (call on process shutdown).
   */
  stopAll(): void {
    for (const name of this.sidecars.keys()) {
      this.stop(name)
    }
  }

  /**
   * Returns health status of all registered sidecars.
   */
  getStatus(): Record<string, { healthy: boolean; restarts: number; pid: number | undefined }> {
    const result: Record<string, { healthy: boolean; restarts: number; pid: number | undefined }> = {}
    for (const [name, state] of this.sidecars) {
      result[name] = {
        healthy: state.healthy,
        restarts: state.restartCount,
        pid: state.process?.pid,
      }
    }
    return result
  }

  /**
   * Spawn a sidecar and attach exit/error handlers for auto-restart.
   *
   * @param state - Mutable sidecar state to update
   */
  private _spawn(state: SidecarState): void {
    const { config } = state
    log.info("starting sidecar", { name: config.name, command: config.command, args: config.args })

    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })

    state.process = child
    state.healthy = true
    state.startedAt = new Date()

    child.stdout?.on("data", (data: Buffer) => {
      log.debug(`[${config.name}] ${data.toString().trim()}`)
    })

    child.stderr?.on("data", (data: Buffer) => {
      log.warn(`[${config.name}] stderr: ${data.toString().trim()}`)
    })

    child.on("error", (err) => {
      state.healthy = false
      log.error("sidecar process error", { name: config.name, err })
    })

    child.on("exit", (code, signal) => {
      state.healthy = false
      state.process = null

      if (code === 0 || signal === "SIGTERM") {
        log.info("sidecar exited cleanly", { name: config.name, code, signal })
        return
      }

      log.warn("sidecar crashed", { name: config.name, code, signal, restarts: state.restartCount })

      if (config.autoRestart === false) return

      const maxRestarts = config.maxRestarts ?? 5
      if (state.restartCount >= maxRestarts) {
        log.error("sidecar exceeded max restarts, giving up", {
          name: config.name,
          maxRestarts,
        })
        return
      }

      state.restartCount++
      const backoffMs = Math.min(1_000 * 2 ** (state.restartCount - 1), SidecarManager.MAX_BACKOFF_MS)
      log.info("sidecar restart scheduled", { name: config.name, backoffMs, attempt: state.restartCount })

      setTimeout(() => this._spawn(state), backoffMs)
    })
  }
}

/** Singleton instance used across the application. */
export const sidecarManager = new SidecarManager()
```

**Step 2: Register sidecars in startup.ts**

Read `src/core/startup.ts` to find the end of `initializeServices()`.

After the existing service initialization (before the `return` statement), add:

```typescript
// Register Python sidecars for supervised restart
import { sidecarManager } from "./sidecar-manager.js"  // ← add to imports at top
import path from "node:path"                             // ← if not already imported
import { fileURLToPath } from "node:url"                // ← if not already imported

// Near end of initializeServices():
const pythonCwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python")
const py = config.PYTHON_PATH ?? "python"

if (config.VOICE_ENABLED) {
  sidecarManager.register({
    name: "voice",
    command: py,
    args: ["-m", "delivery.streaming_voice"],
    cwd: pythonCwd,
  })
  sidecarManager.start("voice")
}

if (config.VISION_ENABLED) {
  sidecarManager.register({
    name: "vision",
    command: py,
    args: ["-m", "vision.processor"],
    cwd: pythonCwd,
  })
  sidecarManager.start("vision")
}

// Register graceful shutdown
process.on("SIGTERM", () => sidecarManager.stopAll())
process.on("SIGINT",  () => sidecarManager.stopAll())
```

**Note:** Only add the `import` lines at the TOP of `startup.ts` (with other imports), not inside the function.

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 4: Run tests**

Run: `pnpm test`
Expected: all passing (new file has no tests needed — it's a supervisor, not business logic)

**Step 5: Commit**

```bash
git add src/core/sidecar-manager.ts src/core/startup.ts
git commit -m "feat(core): add SidecarManager with exponential-backoff restart for Python sidecars"
```

---

## Task 8 — Channel stubs audit and cleanup

**Files:**
- Modify: `src/channels/line.ts`, `src/channels/matrix.ts`, `src/channels/signal.ts`,
  `src/channels/teams.ts`, `src/channels/imessage.ts`

Goal: Each stub channel that is not truly implemented should:
1. Not be registered with `ChannelManager` by default
2. Have a clear `NOT_IMPLEMENTED` log at construction time so operators know
3. Not silently drop messages

**Step 1: Read each stub file**

Read each of these files to see their actual implementation state.

**Step 2: For each stub, add a "not implemented" guard**

If a channel class's `send()` method is essentially empty or throws, wrap its constructor with:

```typescript
constructor() {
  super()
  log.warn("channel not implemented — messages will be dropped", { channel: "line" })
}
```

And ensure `isConnected()` returns `false`.

**Step 3: Read channel manager registration**

Read `src/channels/manager.ts` to see which channels are auto-registered.
Remove any stub channels that aren't truly implemented from the auto-registration list.
Add a comment: `// TODO: implement before enabling`.

**Step 4: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: still clean

**Step 5: Commit**

```bash
git add src/channels/
git commit -m "fix(channels): mark unimplemented stub channels, remove from auto-registration"
```

---

## Task 9 — Final verification

**Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 2: Full test suite**

Run: `pnpm test`
Expected: 1022/1022 passing (or higher — the channel audit may add new stubs)

**Step 3: Smoke test startup**

Run: `pnpm dev` (with a valid `.env`)
Expected: EDITH starts, logs show "env validation passed", no crash

**Step 4: Update MEMORY.md**

Update `C:\Users\test\.claude\projects\C--Users-test-OneDrive-Desktop-EDITH\memory\MEMORY.md`
with the new status:
- Test count: updated number
- TypeScript: clean
- Production readiness: describe what was fixed

**Step 5: Final commit**

```bash
git add docs/plans/
git commit -m "docs: add production readiness implementation plan"
```

---

## Summary

| Task | Fix | Effort |
|------|-----|--------|
| 1 | 5 missing config vars in ConfigSchema | 5 min |
| 2 | Add `getLastUsedEngine` to orchestrator mock | 5 min |
| 3 | Fix quiet-hours time pollution in push-service test | 15 min |
| 4 | Fix metrics test (if still failing) | 15 min |
| 5 | Verify full test suite green | 5 min |
| 6 | Startup env validation guard | 20 min |
| 7 | Python sidecar supervisor with backoff | 30 min |
| 8 | Channel stubs audit + cleanup | 20 min |
| 9 | Final verification + memory update | 10 min |
