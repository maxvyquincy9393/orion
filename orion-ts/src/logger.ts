import fs from "node:fs"
import path from "node:path"

import config from "./config.js"

type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel = LOG_LEVELS[config.LOG_LEVEL] ?? LOG_LEVELS.info

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

class LogStream {
  private static instance: LogStream | null = null
  private stream: fs.WriteStream | null = null
  private initialized = false

  private constructor() {
    try {
      const logsDir = path.resolve(process.cwd(), "logs")
      fs.mkdirSync(logsDir, { recursive: true })
      this.stream = fs.createWriteStream(path.join(logsDir, "orion.log"), { flags: "a" })
      this.initialized = true
    } catch (error) {
      console.error(`[Logger] Failed to initialize log stream: ${error}`)
    }
  }

  static getInstance(): LogStream {
    if (!LogStream.instance) {
      LogStream.instance = new LogStream()
    }
    return LogStream.instance
  }

  write(line: string): void {
    if (this.initialized && this.stream) {
      this.stream.write(`${line}\n`)
    }
  }

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

  const formatted = formatMessage(level, scope, message, meta)

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

export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message: string, meta?: unknown) => log("debug", scope, message, meta),
    info: (message: string, meta?: unknown) => log("info", scope, message, meta),
    warn: (message: string, meta?: unknown) => log("warn", scope, message, meta),
    error: (message: string, meta?: unknown) => log("error", scope, message, meta),
  }
}

export default createLogger
