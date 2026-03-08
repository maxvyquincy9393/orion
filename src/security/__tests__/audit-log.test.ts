/**
 * @file audit-log.test.ts
 * @description Unit tests for AuditLog HMAC chain integrity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"

function tmpLogPath(): string {
  return join(tmpdir(), `edith-test-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
}

describe("AuditLog", () => {
  let logPath: string

  beforeEach(() => {
    logPath = tmpLogPath()
    vi.doMock("../../config.js", () => ({
      default: {
        VAULT_AUDIT_LOG_PATH: logPath,
      },
    }))
  })

  afterEach(() => {
    if (existsSync(logPath)) rmSync(logPath, { force: true })
    vi.resetModules()
  })

  it("appends entries and verifies a clean chain", async () => {
    const { AuditLog } = await import("../audit-log.js")
    const hmacKey = randomBytes(32).toString("hex")
    const log = new AuditLog(hmacKey)

    await log.append({
      tool: "tool.a",
      argsHash: "aaa",
      userId: "user1",
      result: "allowed",
      durationMs: 10,
    })
    await log.append({
      tool: "tool.b",
      argsHash: "bbb",
      userId: "user1",
      result: "allowed",
      durationMs: 20,
    })

    const result = await log.verify()
    expect(result.valid).toBe(true)
  })

  it("readAll returns all entries", async () => {
    const { AuditLog } = await import("../audit-log.js")
    const log = new AuditLog(randomBytes(32).toString("hex"))

    for (let i = 0; i < 5; i++) {
      await log.append({ tool: `tool.${i}`, argsHash: "", userId: "user1", result: "allowed", durationMs: i })
    }

    const entries = await log.readAll()
    expect(entries).toHaveLength(5)
  })

  it("readRecent returns last N entries", async () => {
    const { AuditLog } = await import("../audit-log.js")
    const log = new AuditLog(randomBytes(32).toString("hex"))

    for (let i = 0; i < 8; i++) {
      await log.append({ tool: `tool.${i}`, argsHash: "", userId: "user1", result: "allowed", durationMs: i })
    }

    const recent = await log.readRecent(3)
    expect(recent).toHaveLength(3)
    expect(recent[2].tool).toBe("tool.7")
  })

  it("verify returns valid true on empty log", async () => {
    const { AuditLog } = await import("../audit-log.js")
    const log = new AuditLog(randomBytes(32).toString("hex"))
    const result = await log.verify()
    expect(result.valid).toBe(true)
  })

  it("first entry has empty prevHash", async () => {
    const { AuditLog } = await import("../audit-log.js")
    const log = new AuditLog(randomBytes(32).toString("hex"))
    await log.append({ tool: "first", argsHash: "", userId: "u", result: "allowed", durationMs: 0 })
    const entries = await log.readAll()
    expect(entries[0].prevHash).toBe("")
  })

  it("second entry prevHash matches first entry hash", async () => {
    const { AuditLog } = await import("../audit-log.js")
    const log = new AuditLog(randomBytes(32).toString("hex"))
    await log.append({ tool: "first", argsHash: "", userId: "u", result: "allowed", durationMs: 0 })
    await log.append({ tool: "second", argsHash: "", userId: "u", result: "allowed", durationMs: 0 })
    const entries = await log.readAll()
    expect(entries[1].prevHash).toBe(entries[0].hash)
  })
})
