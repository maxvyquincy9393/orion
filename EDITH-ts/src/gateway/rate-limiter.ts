import fs from "node:fs"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("gateway.rate-limiter")

const LOCK_RETRY_SLEEP_MS = 2
const LOCK_SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4))

export interface RateLimiterOptions {
  maxRequests: number
  windowMs: number
  backend?: "memory" | "file"
  filePath?: string
  lockTimeoutMs?: number
}

export interface RateLimitDecision {
  limited: boolean
  remaining: number
  retryAfterMs: number
  count: number
  limit: number
}

export interface RateLimiter {
  readonly backend: "memory" | "file"
  consume(key: string, now?: number): RateLimitDecision
  getRemaining(key: string, now?: number): number
  cleanup(now?: number): void
}

interface RateLimitEntry {
  count: number
  windowStart: number
}

type RateLimitState = Record<string, RateLimitEntry>

function normalizeKey(key: string): string {
  return key.trim().toLowerCase()
}

function asRateLimitEntry(value: unknown): RateLimitEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const count = record.count
  const windowStart = record.windowStart
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null
  }
  if (typeof windowStart !== "number" || !Number.isFinite(windowStart) || windowStart < 0) {
    return null
  }

  return {
    count: Math.floor(count),
    windowStart,
  }
}

function readStateFile(filePath: string): RateLimitState {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const raw = fs.readFileSync(filePath, "utf-8")
  if (!raw.trim()) {
    return {}
  }

  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {}
  }

  const state: RateLimitState = {}
  for (const [rawKey, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeKey(rawKey)
    if (!key) {
      continue
    }

    const entry = asRateLimitEntry(rawEntry)
    if (entry) {
      state[key] = entry
    }
  }

  return state
}

function writeStateFile(filePath: string, state: RateLimitState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(state), "utf-8")
  fs.renameSync(tmpPath, filePath)
}

function shouldResetWindow(entry: RateLimitEntry | undefined, windowMs: number, now: number): boolean {
  if (!entry) {
    return true
  }

  return now - entry.windowStart >= windowMs
}

function consumeEntry(
  entry: RateLimitEntry | undefined,
  maxRequests: number,
  windowMs: number,
  now: number,
): { next: RateLimitEntry; decision: RateLimitDecision } {
  const next = shouldResetWindow(entry, windowMs, now)
    ? { count: 1, windowStart: now }
    : { count: entry!.count + 1, windowStart: entry!.windowStart }

  const limited = next.count > maxRequests
  const remaining = Math.max(0, maxRequests - next.count)
  const retryAfterMs = limited
    ? Math.max(0, windowMs - (now - next.windowStart))
    : 0

  return {
    next,
    decision: {
      limited,
      remaining,
      retryAfterMs,
      count: next.count,
      limit: maxRequests,
    },
  }
}

function getRemainingForEntry(
  entry: RateLimitEntry | undefined,
  maxRequests: number,
  windowMs: number,
  now: number,
): number {
  if (shouldResetWindow(entry, windowMs, now)) {
    return maxRequests
  }

  return Math.max(0, maxRequests - entry!.count)
}

function pruneStaleEntries(
  state: RateLimitState,
  windowMs: number,
  now: number,
  staleWindowMultiplier = 2,
): boolean {
  const staleCutoff = now - (windowMs * staleWindowMultiplier)
  let changed = false

  for (const [key, entry] of Object.entries(state)) {
    if (entry.windowStart < staleCutoff) {
      delete state[key]
      changed = true
    }
  }

  return changed
}

class MemoryRateLimiter implements RateLimiter {
  readonly backend = "memory" as const
  private readonly state: RateLimitState = {}

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = Date.now()): RateLimitDecision {
    const normalizedKey = normalizeKey(key)
    const existing = this.state[normalizedKey]
    const { next, decision } = consumeEntry(existing, this.maxRequests, this.windowMs, now)
    this.state[normalizedKey] = next
    return decision
  }

  getRemaining(key: string, now = Date.now()): number {
    const normalizedKey = normalizeKey(key)
    return getRemainingForEntry(this.state[normalizedKey], this.maxRequests, this.windowMs, now)
  }

  cleanup(now = Date.now()): void {
    pruneStaleEntries(this.state, this.windowMs, now)
  }
}

class FileRateLimiter implements RateLimiter {
  readonly backend = "file" as const
  private readonly lockPath: string
  private readonly fallback: MemoryRateLimiter

  constructor(
    private readonly filePath: string,
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly lockTimeoutMs: number,
  ) {
    this.lockPath = `${filePath}.lock`
    this.fallback = new MemoryRateLimiter(maxRequests, windowMs)
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    const normalizedKey = normalizeKey(key)
    if (!normalizedKey) {
      return this.fallback.consume(key, now)
    }

    return this.withState(now, true, (state) => {
      const existing = state[normalizedKey]
      const { next, decision } = consumeEntry(existing, this.maxRequests, this.windowMs, now)
      state[normalizedKey] = next
      return decision
    }, () => this.fallback.consume(normalizedKey, now))
  }

  getRemaining(key: string, now = Date.now()): number {
    const normalizedKey = normalizeKey(key)
    if (!normalizedKey) {
      return this.fallback.getRemaining(key, now)
    }

    return this.withState(now, false, (state) => {
      return getRemainingForEntry(state[normalizedKey], this.maxRequests, this.windowMs, now)
    }, () => this.fallback.getRemaining(normalizedKey, now))
  }

  cleanup(now = Date.now()): void {
    this.withState(now, true, (state) => {
      pruneStaleEntries(state, this.windowMs, now)
      return undefined
    }, () => {
      this.fallback.cleanup(now)
      return undefined
    })
  }

  private withState<T>(
    now: number,
    allowWrite: boolean,
    worker: (state: RateLimitState) => T,
    fallback: () => T,
  ): T {
    const lockFd = this.acquireLock()
    if (lockFd === null) {
      return fallback()
    }

    try {
      const state = readStateFile(this.filePath)
      const changedByCleanup = pruneStaleEntries(state, this.windowMs, now)
      const result = worker(state)

      if (allowWrite || changedByCleanup) {
        writeStateFile(this.filePath, state)
      }

      return result
    } catch (error) {
      log.warn("rate limiter state operation failed, using fallback", {
        backend: "file",
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      })
      return fallback()
    } finally {
      this.releaseLock(lockFd)
    }
  }

  private acquireLock(): number | null {
    const startedAt = Date.now()
    while (Date.now() - startedAt <= this.lockTimeoutMs) {
      try {
        return fs.openSync(this.lockPath, "wx")
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "EEXIST") {
          log.warn("rate limiter lock acquisition failed", {
            backend: "file",
            path: this.lockPath,
            code,
          })
          return null
        }
        Atomics.wait(LOCK_SLEEP_BUFFER, 0, 0, LOCK_RETRY_SLEEP_MS)
      }
    }

    log.warn("rate limiter lock timeout, using fallback backend", {
      backend: "file",
      lockPath: this.lockPath,
      timeoutMs: this.lockTimeoutMs,
    })
    return null
  }

  private releaseLock(lockFd: number): void {
    try {
      fs.closeSync(lockFd)
    } catch {
      // Best effort close.
    }

    try {
      fs.rmSync(this.lockPath, { force: true })
    } catch {
      // Best effort lock cleanup.
    }
  }
}

function resolveDefaultBackend(): "memory" | "file" {
  const fromEnv = process.env.GATEWAY_RATE_LIMIT_BACKEND?.trim().toLowerCase()
  if (fromEnv === "memory" || fromEnv === "file") {
    return fromEnv
  }

  return process.env.NODE_ENV === "test" ? "memory" : "file"
}

function resolveDefaultStatePath(): string {
  const stateDir = typeof process.env.EDITH_STATE_DIR === "string" && process.env.EDITH_STATE_DIR.trim().length > 0
    ? process.env.EDITH_STATE_DIR.trim()
    : ".edith"

  return path.resolve(stateDir, "gateway", "rate-limit.json")
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const backend = options.backend ?? resolveDefaultBackend()
  if (backend === "file") {
    return new FileRateLimiter(
      options.filePath ?? resolveDefaultStatePath(),
      options.maxRequests,
      options.windowMs,
      options.lockTimeoutMs ?? 50,
    )
  }

  return new MemoryRateLimiter(options.maxRequests, options.windowMs)
}
