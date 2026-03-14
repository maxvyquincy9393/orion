/**
 * @file logger.ts
 * @description Structured logger with daily file rotation and configurable retention pruning.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Used throughout the entire codebase via `createLogger("module.name")`
 *   - `LogStream` singleton writes to `logs/edith-YYYY-MM-DD.log` and rotates at midnight
 *   - Pruning removes files older than `LOG_RETAIN_DAYS` days (default: 7)
 *   - `buildLogFilename` and `pruneOldLogs` are exported as pure functions for testability
 */
import fs from "node:fs"
import path from "node:path"

type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Read directly from env to avoid a logger ↔ config circular import.
const _rawLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel
const currentLevel = LOG_LEVELS[_rawLevel] ?? LOG_LEVELS.info
const LOG_RETAIN_DAYS = Math.max(1, parseInt(process.env.LOG_RETAIN_DAYS ?? "7", 10) || 7)

/**
 * Formats a Date into the log filename format `edith-YYYY-MM-DD.log`.
 * @param date - The date to format
 * @returns Filename string e.g. `edith-2026-03-09.log`
 */
export function buildLogFilename(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `edith-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`
}

/**
 * Deletes log files in `logsDir` that are older than `retainDays` days before `now`.
 * Only files matching the pattern `edith-YYYY-MM-DD.log` are considered.
 * Never throws — any errors are silently swallowed to protect the logger.
 * @param logsDir - Absolute path to the logs directory
 * @param now - Reference point for the cutoff calculation
 * @param retainDays - Number of days to retain (files older than this are deleted)
 */
export function pruneOldLogs(logsDir: string, now: Date, retainDays: number): void {
  try {
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - retainDays)
    const files = fs.readdirSync(logsDir)
      .filter((f) => /^edith-\d{4}-\d{2}-\d{2}\.log$/.test(f))
    for (const file of files) {
      const datePart = file.slice(6, 16) // "YYYY-MM-DD"
      if (new Date(datePart + "T00:00:00Z") < cutoff) {
        fs.unlinkSync(path.join(logsDir, file))
      }
    }
  } catch {
    // best-effort — never throw from logger
  }
}

/** Whether JSON structured logging is enabled (active when EDITH_ENV=production). */
const isJsonMode = (process.env.EDITH_ENV ?? "").toLowerCase() === "production"

function formatTimestamp(): string {
  return new Date().toISOString()
}

function formatMessage(level: LogLevel, scope: string, message: string, meta?: unknown): string {
  const timestamp = formatTimestamp()
  const levelStr = level.toUpperCase().padEnd(5)
  let formatted = `[${timestamp}] ${levelStr} [${scope}] ${message}`
  if (meta !== undefined) {
    formatted += ` ${JSON.stringify(meta)}`
  }
  return formatted
}

/**
 * Formats a log entry as a single-line JSON object for structured logging.
 * Used in production mode (EDITH_ENV=production) for machine-parseable output.
 *
 * When `meta` is a plain object its keys are spread into the top-level entry;
 * arrays and primitives are assigned to an explicit `meta` key instead.
 *
 * @param level   - Log severity level.
 * @param scope   - Module scope string (e.g. "core.pipeline").
 * @param message - Human-readable log message.
 * @param meta    - Optional structured metadata to include.
 * @returns Serialized JSON string (no trailing newline).
 */
function formatMessageJson(level: LogLevel, scope: string, message: string, meta?: unknown): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
  }
  if (meta !== undefined) {
    if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
      Object.assign(entry, meta)
    } else {
      entry.meta = meta
    }
  }
  return JSON.stringify(entry)
}

/** Singleton write stream with daily rotation and retention pruning. */
class LogStream {
  /** Singleton instance. */
  private static instance: LogStream | null = null
  /** The current active write stream. */
  private stream: fs.WriteStream | null = null
  /** Whether the stream was successfully initialized. */
  private initialized = false

  private constructor() {
    try {
      const logsDir = path.resolve(process.cwd(), "logs")
      fs.mkdirSync(logsDir, { recursive: true })
      this.stream = fs.createWriteStream(
        path.join(logsDir, buildLogFilename(new Date())),
        { flags: "a" },
      )
      this.initialized = true
      // Prune old logs on startup
      pruneOldLogs(logsDir, new Date(), LOG_RETAIN_DAYS)
      // Schedule the first midnight rotation
      this.scheduleMidnightRotation()
    } catch (error) {
      console.error(`[Logger] Failed to initialize log stream: ${error}`)
    }
  }

  /** Returns the singleton instance, creating it if needed. */
  static getInstance(): LogStream {
    if (!LogStream.instance) {
      LogStream.instance = new LogStream()
    }
    return LogStream.instance
  }

  /**
   * Closes the current stream and opens a new one for the current date.
   * Called automatically at midnight and can be triggered manually.
   */
  private rotate(): void {
    if (this.stream) {
      this.stream.end()
      this.stream = null
    }
    try {
      const logsDir = path.resolve(process.cwd(), "logs")
      const filename = buildLogFilename(new Date())
      this.stream = fs.createWriteStream(path.join(logsDir, filename), { flags: "a" })
      this.initialized = true
      pruneOldLogs(logsDir, new Date(), LOG_RETAIN_DAYS)
    } catch (error) {
      console.error(`[Logger] Failed to rotate log stream: ${error}`)
      this.initialized = false
    }
  }

  /**
   * Schedules a `setTimeout` that fires at the next local midnight, rotates the
   * log file, then reschedules itself for the following midnight.
   * The timer is `.unref()`-ed so it does not prevent process exit.
   */
  private scheduleMidnightRotation(): void {
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0) // next midnight in local time
    const msUntilMidnight = midnight.getTime() - now.getTime()

    const timer = setTimeout(() => {
      this.rotate()
      this.scheduleMidnightRotation() // reschedule for next midnight
    }, msUntilMidnight)

    // Don't prevent process exit
    if (timer.unref) timer.unref()
  }

  /** Writes a formatted log line to the file. */
  write(line: string): void {
    if (this.initialized && this.stream) {
      this.stream.write(`${line}\n`)
    }
  }

  /** Closes the underlying write stream and marks as uninitialized. */
  close(): void {
    if (this.stream) {
      this.stream.end()
      this.stream = null
      this.initialized = false
    }
  }
}

const logStream = LogStream.getInstance()

function log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LOG_LEVELS[level] < currentLevel) {
    return
  }

  const formatted = isJsonMode
    ? formatMessageJson(level, scope, message, meta)
    : formatMessage(level, scope, message, meta)

  switch (level) {
    case "debug":
    case "info":
      process.stdout.write(`${formatted}\n`)
      break
    case "warn":
    case "error":
      process.stderr.write(`${formatted}\n`)
      break
  }

  logStream.write(formatted)
}

/** Logger interface returned by `createLogger`. */
export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

/**
 * Creates a scoped logger instance.
 * @param scope - Module name shown in every log line e.g. `"memory.store"`
 * @returns Logger with debug/info/warn/error methods
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (message: string, meta?: unknown) => log("debug", scope, message, meta),
    info: (message: string, meta?: unknown) => log("info", scope, message, meta),
    warn: (message: string, meta?: unknown) => log("warn", scope, message, meta),
    error: (message: string, meta?: unknown) => log("error", scope, message, meta),
  }
}

export default createLogger
