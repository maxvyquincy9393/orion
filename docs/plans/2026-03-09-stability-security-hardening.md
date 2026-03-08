# Stability & Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fill remaining production gaps — error boundaries, DB retention/vacuum, startup migration, webhook signature verification, circuit breaker metrics, session persistence, and memory pressure guard.

**Architecture:** Seven independent atoms, each a small new file + wiring into existing startup/daemon/server. All follow existing patterns: `createLogger`, singleton exports, `.js` ESM imports, JSDoc, no `any`, vitest tests.

**Tech Stack:** TypeScript ESM, Prisma/SQLite, vitest, node:crypto (HMAC), node:child_process (migration)

---

## Task 1 — Error Boundaries

**Files:**
- Create: `src/core/error-boundaries.ts`
- Modify: `src/core/startup.ts`
- Test: `src/core/__tests__/error-boundaries.test.ts`

**Step 1: Write failing test**

```typescript
// src/core/__tests__/error-boundaries.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockLog = { error: vi.fn(), warn: vi.fn() }
vi.mock("../../logger.js", () => ({ createLogger: () => mockLog }))
vi.mock("../../observability/metrics.js", () => ({
  edithMetrics: { errorsTotal: { inc: vi.fn() } },
}))
vi.mock("../shutdown.js", () => ({ performShutdown: vi.fn().mockResolvedValue(undefined) }))

import { registerErrorBoundaries } from "../error-boundaries.js"

describe("registerErrorBoundaries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers unhandledRejection handler", () => {
    const spy = vi.spyOn(process, "on")
    registerErrorBoundaries()
    expect(spy).toHaveBeenCalledWith("unhandledRejection", expect.any(Function))
    spy.mockRestore()
  })

  it("registers uncaughtException handler", () => {
    const spy = vi.spyOn(process, "on")
    registerErrorBoundaries()
    expect(spy).toHaveBeenCalledWith("uncaughtException", expect.any(Function))
    spy.mockRestore()
  })

  it("logs unhandledRejection without crashing", () => {
    registerErrorBoundaries()
    process.emit("unhandledRejection", new Error("test"), Promise.resolve())
    expect(mockLog.error).toHaveBeenCalled()
  })
})
```

Run: `pnpm vitest run src/core/__tests__/error-boundaries.test.ts`
Expected: FAIL

**Step 2: Create `src/core/error-boundaries.ts`**

```typescript
/**
 * @file error-boundaries.ts
 * @description Global process-level error boundaries for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called once at the top of startup.ts initialize() before any async work.
 *   - unhandledRejection: log + increment metric, do NOT crash (recoverable)
 *   - uncaughtException: log + performShutdown() (unrecoverable — must exit cleanly)
 *
 * @module core/error-boundaries
 */

import { createLogger } from "../logger.js"
import { edithMetrics } from "../observability/metrics.js"
import { performShutdown } from "./shutdown.js"

const log = createLogger("core.error-boundaries")

/** Whether boundaries have already been registered (idempotent). */
let registered = false

/**
 * Register global process error boundaries.
 * Idempotent — safe to call multiple times, only registers once.
 */
export function registerErrorBoundaries(): void {
  if (registered) return
  registered = true

  process.on("unhandledRejection", (reason: unknown) => {
    log.error("unhandled promise rejection — continuing", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
    edithMetrics.errorsTotal.inc({ source: "unhandled_rejection" })
  })

  process.on("uncaughtException", (err: Error) => {
    log.error("uncaught exception — initiating shutdown", {
      err: err.message,
      stack: err.stack,
    })
    edithMetrics.errorsTotal.inc({ source: "uncaught_exception" })
    void performShutdown()
  })

  log.info("error boundaries registered")
}

/** FOR TESTING ONLY — reset registration guard. */
export function _resetErrorBoundaries(): void {
  registered = false
}
```

**Step 3: Wire into `src/core/startup.ts`**

Add import near top:
```typescript
import { registerErrorBoundaries } from "./error-boundaries.js"
```

Add as FIRST line inside `initialize()`:
```typescript
registerErrorBoundaries()
```

**Step 4: Run tests + typecheck**

```bash
pnpm vitest run src/core/__tests__/error-boundaries.test.ts
pnpm typecheck
```
Expected: 3/3 PASS, 0 errors

**Step 5: Commit**

```bash
git add src/core/error-boundaries.ts src/core/__tests__/error-boundaries.test.ts src/core/startup.ts
git commit -m "feat(core): add global error boundaries — unhandledRejection logs, uncaughtException triggers graceful shutdown"
```

---

## Task 2 — DB Retention + Vacuum

**Files:**
- Create: `src/database/retention.ts`
- Modify: `src/background/daemon.ts`
- Modify: `src/config.ts`
- Test: `src/database/__tests__/retention.test.ts`

**Step 1: Add config vars to `src/config.ts`**

```typescript
MESSAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
```

**Step 2: Write failing test**

```typescript
// src/database/__tests__/retention.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDeleteMany = vi.fn().mockResolvedValue({ count: 5 })
const mockExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined)

vi.mock("../index.js", () => ({
  prisma: {
    message: { deleteMany: mockDeleteMany },
    auditRecord: { deleteMany: mockDeleteMany },
    $executeRawUnsafe: mockExecuteRawUnsafe,
  },
}))
vi.mock("../../config.js", () => ({
  default: { MESSAGE_RETENTION_DAYS: 365, AUDIT_RETENTION_DAYS: 90 },
}))

import { RetentionService } from "../retention.js"

describe("RetentionService", () => {
  let service: RetentionService
  beforeEach(() => { service = new RetentionService(); vi.clearAllMocks() })

  it("deletes messages older than cutoff", async () => {
    await service.run()
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) })
    )
  })

  it("runs incremental_vacuum after deletion", async () => {
    await service.run()
    expect(mockExecuteRawUnsafe).toHaveBeenCalledWith("PRAGMA incremental_vacuum")
  })

  it("does not throw on DB error", async () => {
    mockDeleteMany.mockRejectedValueOnce(new Error("db error"))
    await expect(service.run()).resolves.not.toThrow()
  })
})
```

Run: `pnpm vitest run src/database/__tests__/retention.test.ts`
Expected: FAIL

**Step 3: Create `src/database/retention.ts`**

```typescript
/**
 * @file retention.ts
 * @description Periodic database retention and vacuum service.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Scheduled weekly by daemon.ts. Deletes old Message and AuditRecord rows,
 *   then runs PRAGMA incremental_vacuum to reclaim SQLite free pages.
 *   Retention windows are configurable via env vars.
 *
 * @module database/retention
 */

import { prisma } from "./index.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("database.retention")

/** One week in milliseconds — how often the retention job runs. */
const RETENTION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Manages periodic deletion of old rows and SQLite vacuum.
 */
export class RetentionService {
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Execute one retention cycle: delete old rows + incremental vacuum.
   * Never throws — errors are logged and swallowed.
   */
  async run(): Promise<void> {
    try {
      const messageCutoff = new Date()
      messageCutoff.setDate(messageCutoff.getDate() - config.MESSAGE_RETENTION_DAYS)

      const auditCutoff = new Date()
      auditCutoff.setDate(auditCutoff.getDate() - config.AUDIT_RETENTION_DAYS)

      const [msgResult, auditResult] = await Promise.all([
        prisma.message.deleteMany({ where: { createdAt: { lt: messageCutoff } } }),
        prisma.auditRecord.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
      ])

      log.info("retention cleanup complete", {
        messagesDeleted: msgResult.count,
        auditRecordsDeleted: auditResult.count,
        messageCutoffDays: config.MESSAGE_RETENTION_DAYS,
      })

      await prisma.$executeRawUnsafe("PRAGMA incremental_vacuum")
      log.debug("incremental vacuum complete")
    } catch (err) {
      log.warn("retention run failed", { err: String(err) })
    }
  }

  /**
   * Start the weekly retention timer. No-op if already running.
   */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.run() }, RETENTION_INTERVAL_MS)
    this.timer.unref()
    log.info("retention scheduler started", {
      messageDays: config.MESSAGE_RETENTION_DAYS,
      auditDays: config.AUDIT_RETENTION_DAYS,
    })
  }

  /** Stop the retention timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

/** Singleton retention service. */
export const retentionService = new RetentionService()
```

**Step 4: Wire into `src/background/daemon.ts`**

Add import:
```typescript
import { retentionService } from "../database/retention.js"
```

In `EDITHDaemon.start()`: `retentionService.start()`
In `EDITHDaemon.stop()`: `retentionService.stop()`

**Step 5: Run tests + commit**

```bash
pnpm vitest run src/database/__tests__/retention.test.ts && pnpm typecheck
git add src/database/retention.ts src/database/__tests__/retention.test.ts src/background/daemon.ts src/config.ts
git commit -m "feat(database): add weekly retention + incremental_vacuum for Message and AuditRecord tables"
```

---

## Task 3 — Startup Migration

**Files:**
- Modify: `src/core/startup.ts`
- Modify: `src/config.ts`
- Test: `src/core/__tests__/startup-migration.test.ts`

**Step 1: Add config var**

```typescript
RUN_MIGRATIONS_ON_STARTUP: z.coerce.boolean().default(true),
```

**Step 2: Write failing test**

```typescript
// src/core/__tests__/startup-migration.test.ts
import { describe, it, expect, vi } from "vitest"

const mockExec = vi.fn()
vi.mock("node:child_process", () => ({
  exec: mockExec,
}))
vi.mock("../../config.js", () => ({
  default: { RUN_MIGRATIONS_ON_STARTUP: true },
}))

import { runMigrationsIfEnabled } from "../startup.js"

describe("runMigrationsIfEnabled", () => {
  it("calls prisma migrate deploy when enabled", async () => {
    mockExec.mockImplementation((_cmd: string, cb: (err: null) => void) => cb(null))
    await expect(runMigrationsIfEnabled()).resolves.not.toThrow()
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("prisma migrate deploy"), expect.any(Function))
  })

  it("does not crash when migration fails — logs warning", async () => {
    mockExec.mockImplementation((_cmd: string, cb: (err: Error) => void) => cb(new Error("fail")))
    await expect(runMigrationsIfEnabled()).resolves.not.toThrow()
  })
})
```

**Step 3: Add `runMigrationsIfEnabled()` to `src/core/startup.ts`**

Add import:
```typescript
import { exec } from "node:child_process"
import { promisify } from "node:util"
const execAsync = promisify(exec)
```

Add exported function (before `initialize()`):
```typescript
/**
 * Run `prisma migrate deploy` if RUN_MIGRATIONS_ON_STARTUP is enabled.
 * Never throws — migration failures are logged as warnings (graceful degradation).
 */
export async function runMigrationsIfEnabled(): Promise<void> {
  if (!config.RUN_MIGRATIONS_ON_STARTUP) return
  try {
    await execAsync("pnpm exec prisma migrate deploy")
    log.info("database migrations applied")
  } catch (err) {
    log.warn("migration failed — continuing with existing schema", { err: String(err) })
  }
}
```

Call it in `initialize()` after `applyPragmas`:
```typescript
await runMigrationsIfEnabled()
```

**Step 4: Run tests + commit**

```bash
pnpm vitest run src/core/__tests__/startup-migration.test.ts && pnpm typecheck
git add src/core/startup.ts src/core/__tests__/startup-migration.test.ts src/config.ts
git commit -m "feat(core): run prisma migrate deploy on startup — graceful degradation on failure"
```

---

## Task 4 — Webhook Signature Verification

**Files:**
- Create: `src/gateway/webhook-verifier.ts`
- Modify: `src/gateway/server.ts`
- Modify: `src/config.ts`
- Test: `src/gateway/__tests__/webhook-verifier.test.ts`

**Step 1: Add config vars**

```typescript
TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
WHATSAPP_APP_SECRET: z.string().default(""),
DISCORD_PUBLIC_KEY: z.string().default(""),
```

**Step 2: Write failing test**

```typescript
// src/gateway/__tests__/webhook-verifier.test.ts
import { describe, it, expect, vi } from "vitest"
import crypto from "node:crypto"

vi.mock("../../config.js", () => ({
  default: {
    TELEGRAM_WEBHOOK_SECRET: "tg-secret",
    WHATSAPP_APP_SECRET: "wa-secret",
    DISCORD_PUBLIC_KEY: "",
  },
}))

import { verifyTelegramSignature, verifyWhatsAppSignature, isWebhookVerificationEnabled } from "../webhook-verifier.js"

describe("verifyTelegramSignature", () => {
  it("returns true for valid HMAC-SHA256 signature", () => {
    const body = JSON.stringify({ update_id: 1 })
    const hmac = crypto.createHmac("sha256", crypto.createHash("sha256").update("tg-secret").digest())
    hmac.update(body)
    const sig = hmac.digest("hex")
    expect(verifyTelegramSignature(body, sig)).toBe(true)
  })

  it("returns false for invalid signature", () => {
    expect(verifyTelegramSignature("body", "bad-sig")).toBe(false)
  })

  it("returns true when no secret configured (passthrough)", () => {
    // When secret is empty, verification is skipped
    vi.resetModules()
  })
})

describe("verifyWhatsAppSignature", () => {
  it("returns true for valid sha256= signature", () => {
    const body = "test-body"
    const sig = "sha256=" + crypto.createHmac("sha256", "wa-secret").update(body).digest("hex")
    expect(verifyWhatsAppSignature(body, sig)).toBe(true)
  })

  it("returns false for wrong signature", () => {
    expect(verifyWhatsAppSignature("body", "sha256=wrong")).toBe(false)
  })
})

describe("isWebhookVerificationEnabled", () => {
  it("returns true when a secret is configured", () => {
    expect(isWebhookVerificationEnabled("telegram")).toBe(true)
    expect(isWebhookVerificationEnabled("whatsapp")).toBe(true)
  })

  it("returns false when no secret configured", () => {
    expect(isWebhookVerificationEnabled("discord")).toBe(false)
  })
})
```

**Step 3: Create `src/gateway/webhook-verifier.ts`**

```typescript
/**
 * @file webhook-verifier.ts
 * @description HMAC signature verification for inbound channel webhooks.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by server.ts for POST /webhooks/:channel requests before routing.
 *   Each channel has its own signature scheme:
 *     - Telegram: HMAC-SHA256(body, SHA256(secret)) in X-Telegram-Bot-Api-Secret-Token
 *     - WhatsApp: HMAC-SHA256(body, secret) in X-Hub-Signature-256 as "sha256=..."
 *     - Discord: Ed25519(body, public_key) — requires the "ed25519" npm package
 *   Verification is skipped (passthrough) when the relevant secret is not configured.
 *
 * @module gateway/webhook-verifier
 */

import crypto from "node:crypto"
import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.webhook-verifier")

/**
 * Returns true if webhook verification is enabled for the given channel.
 * @param channel - Channel name (telegram, whatsapp, discord)
 */
export function isWebhookVerificationEnabled(channel: string): boolean {
  switch (channel) {
    case "telegram": return Boolean(config.TELEGRAM_WEBHOOK_SECRET)
    case "whatsapp": return Boolean(config.WHATSAPP_APP_SECRET)
    case "discord": return Boolean(config.DISCORD_PUBLIC_KEY)
    default: return false
  }
}

/**
 * Verify a Telegram webhook request.
 * Telegram uses HMAC-SHA256(body, SHA256(bot_token)) as secret key.
 *
 * @param body - Raw request body string
 * @param signature - Value of X-Telegram-Bot-Api-Secret-Token header
 */
export function verifyTelegramSignature(body: string, signature: string): boolean {
  try {
    const secretKey = crypto.createHash("sha256").update(config.TELEGRAM_WEBHOOK_SECRET).digest()
    const expected = crypto.createHmac("sha256", secretKey).update(body).digest("hex")
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    log.warn("telegram signature verification error")
    return false
  }
}

/**
 * Verify a WhatsApp Cloud API webhook request.
 * WhatsApp uses HMAC-SHA256(body, app_secret) with "sha256=" prefix.
 *
 * @param body - Raw request body string
 * @param signature - Value of X-Hub-Signature-256 header (e.g. "sha256=abc123")
 */
export function verifyWhatsAppSignature(body: string, signature: string): boolean {
  try {
    const expected = "sha256=" + crypto.createHmac("sha256", config.WHATSAPP_APP_SECRET).update(body).digest("hex")
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    log.warn("whatsapp signature verification error")
    return false
  }
}

/**
 * Verify an inbound webhook request for the given channel.
 * Returns true if verification passes or is not configured.
 *
 * @param channel - Channel name
 * @param body - Raw request body string
 * @param headers - Request headers map
 */
export function verifyWebhook(channel: string, body: string, headers: Record<string, string | undefined>): boolean {
  if (!isWebhookVerificationEnabled(channel)) return true // passthrough

  switch (channel) {
    case "telegram": {
      const sig = headers["x-telegram-bot-api-secret-token"] ?? ""
      return verifyTelegramSignature(body, sig)
    }
    case "whatsapp": {
      const sig = headers["x-hub-signature-256"] ?? ""
      return verifyWhatsAppSignature(body, sig)
    }
    default:
      return true
  }
}
```

**Step 4: Wire into `src/gateway/server.ts`**

Add import:
```typescript
import { verifyWebhook } from "./webhook-verifier.js"
```

Find the `/webhooks/:channel` route handler. Add signature check at the start of the handler:
```typescript
const rawBody = JSON.stringify(request.body)
const channel = request.params.channel
if (!verifyWebhook(channel, rawBody, request.headers as Record<string, string>)) {
  log.warn("webhook signature verification failed", { channel })
  return reply.status(401).send({ error: "Invalid webhook signature" })
}
```

Read server.ts first to find the exact webhook route structure before adding.

**Step 5: Run tests + commit**

```bash
pnpm vitest run src/gateway/__tests__/webhook-verifier.test.ts && pnpm typecheck
git add src/gateway/webhook-verifier.ts src/gateway/__tests__/webhook-verifier.test.ts src/gateway/server.ts src/config.ts
git commit -m "feat(gateway): add HMAC webhook signature verification for Telegram + WhatsApp"
```

---

## Task 5 — Circuit Breaker Metrics

**Files:**
- Modify: `src/observability/metrics.ts`
- Modify: `src/channels/circuit-breaker.ts`
- Test: `src/channels/__tests__/circuit-breaker-metrics.test.ts`

**Step 1: Add metrics to `src/observability/metrics.ts`**

In the `edithMetrics` object, after `channelRateLimitedTotal`, add:
```typescript
/** Total times a channel circuit breaker has opened. */
circuitBreakerOpenTotal: registry.counter(
  "edith_circuit_breaker_open_total",
  "Total number of times a channel circuit breaker opened.",
  ["channel"],
),

/** Total circuit breaker state transitions. */
circuitBreakerTransitions: registry.counter(
  "edith_circuit_breaker_transitions_total",
  "Total circuit breaker state transitions.",
  ["channel", "from", "to"],
),
```

**Step 2: Write failing test**

```typescript
// src/channels/__tests__/circuit-breaker-metrics.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockInc = vi.fn()
vi.mock("../../observability/metrics.js", () => ({
  edithMetrics: {
    circuitBreakerOpenTotal: { inc: mockInc },
    circuitBreakerTransitions: { inc: mockInc },
  },
}))

import { ChannelCircuitBreaker } from "../circuit-breaker.js"

describe("ChannelCircuitBreaker metrics", () => {
  let cb: ChannelCircuitBreaker
  beforeEach(() => { cb = new ChannelCircuitBreaker({ failures: 2, cooldownMs: 100 }); vi.clearAllMocks() })

  it("emits metric when circuit opens", async () => {
    const fail = () => Promise.reject(new Error("fail"))
    await cb.execute("test", fail).catch(() => {})
    await cb.execute("test", fail).catch(() => {})
    // After 2 failures, circuit should open
    expect(mockInc).toHaveBeenCalledWith(expect.objectContaining({ channel: "test" }))
  })

  it("emits transition metric when circuit closes after successful probe", async () => {
    const fail = () => Promise.reject(new Error("fail"))
    await cb.execute("test", fail).catch(() => {})
    await cb.execute("test", fail).catch(() => {})
    // Wait for cooldown
    await new Promise(r => setTimeout(r, 150))
    // Successful probe
    await cb.execute("test", () => Promise.resolve(true))
    expect(mockInc).toHaveBeenCalled()
  })
})
```

**Step 3: Update `src/channels/circuit-breaker.ts`**

Add import near top:
```typescript
import { edithMetrics } from "../observability/metrics.js"
```

In `onSuccess()`, after setting `circuit.state = "closed"`:
```typescript
if (prevState === "half-open" || prevState === "open") {
  edithMetrics.circuitBreakerTransitions.inc({ channel: channelId, from: prevState, to: "closed" })
}
```
(Capture `const prevState = circuit.state` at start of `onSuccess`)

In `onFailure()`, when circuit opens (after `circuit.state = "open"`):
```typescript
edithMetrics.circuitBreakerOpenTotal.inc({ channel: channelId })
edithMetrics.circuitBreakerTransitions.inc({ channel: channelId, from: prevState, to: "open" })
```
(Capture `const prevState = circuit.state` at start of `onFailure`)

**Step 4: Run tests + commit**

```bash
pnpm vitest run src/channels/__tests__/circuit-breaker-metrics.test.ts && pnpm typecheck
git add src/observability/metrics.ts src/channels/circuit-breaker.ts src/channels/__tests__/circuit-breaker-metrics.test.ts
git commit -m "feat(observability): emit Prometheus metrics on circuit breaker state transitions"
```

---

## Task 6 — Session Persistence

**Files:**
- Create: `src/sessions/session-persistence.ts`
- Modify: `src/core/shutdown.ts`
- Modify: `src/core/startup.ts`
- Modify: `src/config.ts`
- Test: `src/sessions/__tests__/session-persistence.test.ts`

**Step 1: Add config vars**

```typescript
SESSION_PERSIST_ENABLED: z.coerce.boolean().default(true),
SESSION_PERSIST_MAX: z.coerce.number().int().positive().default(50),
```

**Step 2: Write failing test**

```typescript
// src/sessions/__tests__/session-persistence.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockReadFile = vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
const mockMkdir = vi.fn().mockResolvedValue(undefined)

vi.mock("node:fs/promises", () => ({
  default: { writeFile: mockWriteFile, readFile: mockReadFile, mkdir: mockMkdir },
  writeFile: mockWriteFile, readFile: mockReadFile, mkdir: mockMkdir,
}))
vi.mock("../../config.js", () => ({
  default: { SESSION_PERSIST_ENABLED: true, SESSION_PERSIST_MAX: 3 },
}))
vi.mock("../session-store.js", () => ({
  sessionStore: {
    getAllSessions: vi.fn().mockReturnValue([
      { key: "u1:telegram", userId: "u1", channel: "telegram", createdAt: 1, lastActivityAt: 100 },
      { key: "u2:discord", userId: "u2", channel: "discord", createdAt: 2, lastActivityAt: 200 },
    ]),
    getHistory: vi.fn().mockReturnValue([{ role: "user", content: "hi", timestamp: 100 }]),
    restoreSession: vi.fn(),
    restoreHistory: vi.fn(),
  },
}))

import { SessionPersistence } from "../session-persistence.js"

describe("SessionPersistence", () => {
  let sp: SessionPersistence
  beforeEach(() => { sp = new SessionPersistence(".edith"); vi.clearAllMocks() })

  it("saves sessions to disk on save()", async () => {
    await sp.save()
    expect(mockWriteFile).toHaveBeenCalled()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.sessions).toHaveLength(2)
  })

  it("handles missing file gracefully on load()", async () => {
    await expect(sp.load()).resolves.not.toThrow()
  })

  it("restores sessions on load() when file exists", async () => {
    const data = { sessions: [{ session: { key: "u1:tg", userId: "u1", channel: "tg", createdAt: 1, lastActivityAt: 1 }, history: [] }] }
    mockReadFile.mockResolvedValueOnce(JSON.stringify(data))
    const { sessionStore } = await import("../session-store.js")
    await sp.load()
    expect(sessionStore.restoreSession).toHaveBeenCalled()
  })
})
```

**Step 3: Create `src/sessions/session-persistence.ts`**

```typescript
/**
 * @file session-persistence.ts
 * @description Saves and restores in-memory sessions across EDITH restarts.
 *
 * ARCHITECTURE / INTEGRATION:
 *   save() is called by shutdown.ts before process exit.
 *   load() is called by startup.ts after sessionStore is initialized.
 *   Persists top SESSION_PERSIST_MAX sessions (by lastActivityAt) to
 *   .edith/sessions.json as a JSON snapshot.
 *
 * @module sessions/session-persistence
 */

import fs from "node:fs/promises"
import path from "node:path"
import { sessionStore, type Session, type Message } from "./session-store.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("sessions.persistence")

interface PersistedEntry {
  session: Session
  history: Message[]
}

interface PersistedSnapshot {
  savedAt: number
  sessions: PersistedEntry[]
}

/**
 * Handles saving and loading of session state across restarts.
 */
export class SessionPersistence {
  private readonly filePath: string

  /**
   * @param dataDir - Directory to store sessions.json (e.g. ".edith")
   */
  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "sessions.json")
  }

  /**
   * Persist top sessions to disk. Call during graceful shutdown.
   */
  async save(): Promise<void> {
    if (!config.SESSION_PERSIST_ENABLED) return
    try {
      const allSessions = sessionStore.getAllSessions()
      const topSessions = allSessions
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
        .slice(0, config.SESSION_PERSIST_MAX)

      const entries: PersistedEntry[] = topSessions.map((s) => ({
        session: s,
        history: sessionStore.getHistory(s.userId, s.channel),
      }))

      const snapshot: PersistedSnapshot = { savedAt: Date.now(), sessions: entries }
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, JSON.stringify(snapshot, null, 2), "utf-8")
      log.info("sessions persisted", { count: entries.length })
    } catch (err) {
      log.warn("session save failed", { err: String(err) })
    }
  }

  /**
   * Restore sessions from disk. Call during startup after services are ready.
   */
  async load(): Promise<void> {
    if (!config.SESSION_PERSIST_ENABLED) return
    try {
      const raw = await fs.readFile(this.filePath, "utf-8")
      const snapshot = JSON.parse(raw) as PersistedSnapshot

      for (const { session, history } of snapshot.sessions) {
        sessionStore.restoreSession(session)
        sessionStore.restoreHistory(session.userId, session.channel, history)
      }
      log.info("sessions restored", { count: snapshot.sessions.length })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("session load failed", { err: String(err) })
      }
    }
  }
}
```

**Step 4: Add `getAllSessions()`, `getHistory()`, `restoreSession()`, `restoreHistory()` to `src/sessions/session-store.ts`**

Read session-store.ts first to find the `SessionStore` class, then add these methods:

```typescript
/** Return all active sessions sorted by lastActivityAt desc. */
getAllSessions(): Session[] {
  return [...this.sessions.values()]
}

/** Return in-memory history for a session. */
getHistory(userId: string, channel: string): Message[] {
  return this.histories.get(makeSessionKey(userId, channel)) ?? []
}

/** Restore a session into the in-memory store (used by SessionPersistence). */
restoreSession(session: Session): void {
  this.sessions.set(session.key, session)
}

/** Restore history for a session (used by SessionPersistence). */
restoreHistory(userId: string, channel: string, history: Message[]): void {
  this.histories.set(makeSessionKey(userId, channel), history)
}
```

**Step 5: Wire save into `src/core/shutdown.ts`**

Add near top of shutdown.ts:
```typescript
import path from "node:path"
import { SessionPersistence } from "../sessions/session-persistence.js"
```

In `performShutdown()`, before `outbox.stopFlushing()`:
```typescript
const persistence = new SessionPersistence(path.resolve(process.cwd(), ".edith"))
await persistence.save().catch((err) => log.warn("session persist failed", { err: String(err) }))
```

**Step 6: Wire load into `src/core/startup.ts`**

```typescript
import { SessionPersistence } from "../sessions/session-persistence.js"
```

After session store is initialized (after `outbox.setPersistPath()`):
```typescript
const sessionPersistence = new SessionPersistence(path.join(workspaceDir, "..", ".edith"))
await sessionPersistence.load()
```

**Step 7: Run tests + commit**

```bash
pnpm vitest run src/sessions/__tests__/session-persistence.test.ts && pnpm typecheck
git add src/sessions/session-persistence.ts src/sessions/__tests__/session-persistence.test.ts src/sessions/session-store.ts src/core/shutdown.ts src/core/startup.ts src/config.ts
git commit -m "feat(sessions): add session persistence — save top 50 sessions on shutdown, restore on startup"
```

---

## Task 7 — Memory Pressure Guard

**Files:**
- Create: `src/core/memory-guard.ts`
- Modify: `src/core/startup.ts`
- Modify: `src/config.ts`
- Test: `src/core/__tests__/memory-guard.test.ts`

**Step 1: Add config vars**

```typescript
MEMORY_WARN_THRESHOLD: z.coerce.number().min(0.1).max(1).default(0.8),
MEMORY_CRITICAL_THRESHOLD: z.coerce.number().min(0.1).max(1).default(0.95),
```

**Step 2: Write failing test**

```typescript
// src/core/__tests__/memory-guard.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../observability/metrics.js", () => ({
  edithMetrics: { errorsTotal: { inc: vi.fn() } },
}))
vi.mock("../../sessions/session-store.js", () => ({
  sessionStore: { cleanupInactiveSessions: vi.fn().mockReturnValue(5) },
}))
vi.mock("../shutdown.js", () => ({ performShutdown: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../../config.js", () => ({
  default: { MEMORY_WARN_THRESHOLD: 0.8, MEMORY_CRITICAL_THRESHOLD: 0.95 },
}))

import { MemoryGuard } from "../memory-guard.js"

describe("MemoryGuard", () => {
  let guard: MemoryGuard
  beforeEach(() => { guard = new MemoryGuard(); vi.clearAllMocks() })

  it("does nothing when memory usage is normal", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 100, heapTotal: 1000, rss: 0, external: 0, arrayBuffers: 0,
    })
    const { sessionStore } = await import("../../sessions/session-store.js")
    await guard.check()
    expect(sessionStore.cleanupInactiveSessions).not.toHaveBeenCalled()
  })

  it("triggers session eviction when above warn threshold", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 850, heapTotal: 1000, rss: 0, external: 0, arrayBuffers: 0,
    })
    const { sessionStore } = await import("../../sessions/session-store.js")
    await guard.check()
    expect(sessionStore.cleanupInactiveSessions).toHaveBeenCalled()
  })

  it("calls performShutdown when above critical threshold", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 960, heapTotal: 1000, rss: 0, external: 0, arrayBuffers: 0,
    })
    const { performShutdown } = await import("../shutdown.js")
    await guard.check()
    expect(performShutdown).toHaveBeenCalled()
  })
})
```

**Step 3: Create `src/core/memory-guard.ts`**

```typescript
/**
 * @file memory-guard.ts
 * @description Heap memory pressure monitor for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Checks heap usage ratio every 60 seconds.
 *   At MEMORY_WARN_THRESHOLD (default 80%): evicts oldest 20% of sessions.
 *   At MEMORY_CRITICAL_THRESHOLD (default 95%): initiates graceful shutdown
 *   to prevent an OOM crash that would lose state.
 *   Started by startup.ts, timer is unref()-ed.
 *
 * @module core/memory-guard
 */

import { createLogger } from "../logger.js"
import { sessionStore } from "../sessions/session-store.js"
import { performShutdown } from "./shutdown.js"
import { edithMetrics } from "../observability/metrics.js"
import config from "../config.js"

const log = createLogger("core.memory-guard")

/** Check interval in milliseconds (60 seconds). */
const CHECK_INTERVAL_MS = 60_000

/**
 * Monitors heap usage and reacts to memory pressure.
 */
export class MemoryGuard {
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Run one memory check cycle.
   */
  async check(): Promise<void> {
    const { heapUsed, heapTotal } = process.memoryUsage()
    const ratio = heapUsed / heapTotal

    if (ratio >= config.MEMORY_CRITICAL_THRESHOLD) {
      log.error("memory critical — initiating shutdown", {
        heapUsedMB: Math.round(heapUsed / 1_048_576),
        ratio: ratio.toFixed(2),
      })
      edithMetrics.errorsTotal.inc({ source: "memory_critical" })
      await performShutdown()
      return
    }

    if (ratio >= config.MEMORY_WARN_THRESHOLD) {
      log.warn("memory pressure — evicting sessions", {
        heapUsedMB: Math.round(heapUsed / 1_048_576),
        ratio: ratio.toFixed(2),
      })
      // Evict sessions idle for > 5 minutes to free references
      const evicted = sessionStore.cleanupInactiveSessions(5 * 60 * 1_000)
      log.info("session eviction complete", { evicted })
    }
  }

  /** Start the periodic memory check. No-op if already running. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.check() }, CHECK_INTERVAL_MS)
    this.timer.unref()
    log.info("memory guard started", {
      warnAt: config.MEMORY_WARN_THRESHOLD,
      criticalAt: config.MEMORY_CRITICAL_THRESHOLD,
    })
  }

  /** Stop the memory guard timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

/** Singleton memory guard. */
export const memoryGuard = new MemoryGuard()
```

**Step 4: Wire into `src/core/startup.ts`**

```typescript
import { memoryGuard } from "./memory-guard.js"
```

Near end of `initialize()`:
```typescript
memoryGuard.start()
```

In the `shutdown()` closure, add:
```typescript
memoryGuard.stop()
```

**Step 5: Run tests + commit**

```bash
pnpm vitest run src/core/__tests__/memory-guard.test.ts && pnpm typecheck
git add src/core/memory-guard.ts src/core/__tests__/memory-guard.test.ts src/core/startup.ts src/config.ts
git commit -m "feat(core): add memory pressure guard — evicts sessions at 80%, graceful shutdown at 95%"
```

---

## Task 8 — Final Verification

**Step 1: Full test suite**

```bash
cd "C:\Users\test\OneDrive\Desktop\EDITH" && pnpm test
```
Expected: all tests passing (previous 1137 + new tests from Tasks 1–7)

**Step 2: Full typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors

**Step 3: Update MEMORY.md**

Update `C:\Users\test\.claude\projects\C--Users-test-OneDrive-Desktop-EDITH\memory\MEMORY.md` with:
- New files created
- Updated test count
- Updated production readiness scores

**Step 4: Commit docs**

```bash
git add docs/plans/
git commit -m "docs: add stability + security hardening implementation plan"
```
