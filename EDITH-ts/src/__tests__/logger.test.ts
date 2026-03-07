import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const originalCwd = process.cwd()
const originalEnv = { ...process.env }

function setupIsolatedWorkspace(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edith-logger-"))
  process.chdir(tempDir)
  fs.writeFileSync(path.join(tempDir, ".env"), "")
  return tempDir
}

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.chdir(originalCwd)
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe("logger formatting and rotation", () => {
  it("writes structured JSON logs when LOG_FORMAT=json", async () => {
    setupIsolatedWorkspace()
    process.env.LOG_LEVEL = "debug"
    process.env.LOG_FORMAT = "json"
    process.env.LOG_FILE_MAX_SIZE_MB = "10"
    process.env.LOG_FILE_MAX_FILES = "3"

    const stdoutWrites: string[] = []
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stdoutWrites.push(String(chunk))
      return true
    }) as typeof process.stdout.write)

    const loggerModule = await import("../logger.js")
    const logger = loggerModule.createLogger("logger.test")
    logger.info("json log", { run: 1 })

    expect(stdoutWrites.length).toBeGreaterThan(0)
    const parsed = JSON.parse(stdoutWrites[0].trim()) as {
      level: string
      scope: string
      message: string
      meta?: { run?: number }
    }

    expect(parsed.level).toBe("info")
    expect(parsed.scope).toBe("logger.test")
    expect(parsed.message).toBe("json log")
    expect(parsed.meta?.run).toBe(1)
  })

  it("rotates log files when configured size limit is reached", async () => {
    const tempDir = setupIsolatedWorkspace()
    process.env.LOG_LEVEL = "info"
    process.env.LOG_FORMAT = "text"
    process.env.LOG_FILE_MAX_SIZE_MB = "1"
    process.env.LOG_FILE_MAX_FILES = "2"

    vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write)

    const loggerModule = await import("../logger.js")
    const logger = loggerModule.createLogger("logger.rotate")
    logger.info("x".repeat(1_200_000))
    await new Promise((resolve) => setTimeout(resolve, 80))
    logger.info("rotate now")

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(fs.existsSync(path.join(tempDir, "logs", "edith.log.1"))).toBe(true)
  })
})
