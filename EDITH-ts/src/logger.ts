import fs from "node:fs"
import path from "node:path"

import config from "./config.js"

type LogLevel = "debug" | "info" | "warn" | "error"
type LogFormat = "text" | "json"

interface LogEntry {
  timestamp: string
  level: LogLevel
  scope: string
  message: string
  meta?: unknown
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LOG_FILE_NAME = "edith.log"
const currentLevel = LOG_LEVELS[config.LOG_LEVEL] ?? LOG_LEVELS.info
const currentFormat: LogFormat = config.LOG_FORMAT === "json" ? "json" : "text"
const maxLogFileSizeBytes = Math.max(0, config.LOG_FILE_MAX_SIZE_MB) * 1_048_576
const maxLogFiles = Math.max(1, config.LOG_FILE_MAX_FILES)

function formatTimestamp(): string {
  return new Date().toISOString()
}

function formatTextEntry(entry: LogEntry): string {
  const level = entry.level.toUpperCase().padEnd(5)
  let line = `[${entry.timestamp}] ${level} [${entry.scope}] ${entry.message}`
  if (entry.meta !== undefined) {
    line += ` ${JSON.stringify(entry.meta)}`
  }
  return line
}

function formatJsonEntry(entry: LogEntry): string {
  return JSON.stringify({
    timestamp: entry.timestamp,
    level: entry.level,
    scope: entry.scope,
    message: entry.message,
    ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
  })
}

function formatMessage(entry: LogEntry): string {
  if (currentFormat === "json") {
    return formatJsonEntry(entry)
  }
  return formatTextEntry(entry)
}

class LogStream {
  private static instance: LogStream | null = null
  private stream: fs.WriteStream | null = null
  private initialized = false
  private readonly logsDir: string
  private readonly filePath: string

  private constructor() {
    this.logsDir = path.resolve(process.cwd(), "logs")
    this.filePath = path.join(this.logsDir, LOG_FILE_NAME)

    try {
      fs.mkdirSync(this.logsDir, { recursive: true })
      this.stream = fs.createWriteStream(this.filePath, { flags: "a" })
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

  private rotateIfNeeded(): void {
    if (!this.initialized || !this.stream) {
      return
    }

    try {
      const size = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0
      if (maxLogFileSizeBytes > 0 && size < maxLogFileSizeBytes) {
        return
      }
      this.rotateFiles()
    } catch (error) {
      console.error(`[Logger] Rotation check failed: ${error}`)
    }
  }

  private rotateFiles(): void {
    this.stream?.end()
    this.stream = null

    for (let index = maxLogFiles; index >= 1; index -= 1) {
      const source = `${this.filePath}.${index}`
      if (!fs.existsSync(source)) {
        continue
      }

      if (index === maxLogFiles) {
        fs.rmSync(source, { force: true })
        continue
      }

      const target = `${this.filePath}.${index + 1}`
      fs.renameSync(source, target)
    }

    if (fs.existsSync(this.filePath)) {
      fs.renameSync(this.filePath, `${this.filePath}.1`)
    }

    this.stream = fs.createWriteStream(this.filePath, { flags: "a" })
    this.initialized = true
  }

  write(line: string): void {
    if (!this.initialized || !this.stream) {
      return
    }

    this.rotateIfNeeded()
    this.stream?.write(`${line}\n`)
  }

  close(): void {
    this.stream?.end()
    this.stream = null
    this.initialized = false
  }
}

const logStream = LogStream.getInstance()

function log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LOG_LEVELS[level] < currentLevel) {
    return
  }

  const formatted = formatMessage({
    timestamp: formatTimestamp(),
    level,
    scope,
    message,
    meta,
  })

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

