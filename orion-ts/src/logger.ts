import fs from "node:fs"
import path from "node:path"

import config from "./config.js"

type Level = "debug" | "info" | "warn" | "error"

const LEVEL_RANK: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function shouldLog(level: Level): boolean {
  const configuredLevel = config.LOG_LEVEL
  return LEVEL_RANK[level] >= LEVEL_RANK[configuredLevel]
}

export class Logger {
  constructor(private readonly module: string) {}

  private write(level: Level, msg: string, data?: unknown): void {
    if (!shouldLog(level)) {
      return
    }

    const timestamp = new Date().toISOString()
    const upperLevel = level.toUpperCase()
    const suffix =
      data === undefined
        ? ""
        : ` ${typeof data === "string" ? data : JSON.stringify(data)}`
    const line = `[${timestamp}] [${upperLevel}] [${this.module}] ${msg}${suffix}`

    const logsDir = path.resolve(process.cwd(), "logs")
    fs.mkdirSync(logsDir, { recursive: true })

    const filePath = path.join(logsDir, "orion.log")
    process.stdout.write(`${line}\n`)
    fs.appendFileSync(filePath, `${line}\n`, { encoding: "utf-8" })
  }

  debug(msg: string, data?: unknown): void {
    this.write("debug", msg, data)
  }

  info(msg: string, data?: unknown): void {
    this.write("info", msg, data)
  }

  warn(msg: string, data?: unknown): void {
    this.write("warn", msg, data)
  }

  error(msg: string, data?: unknown): void {
    this.write("error", msg, data)
  }
}

export const createLogger = (module: string): Logger => new Logger(module)
