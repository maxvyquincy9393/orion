/**
 * @file permission-manager.test.ts
 * @description Unit tests for PermissionManager and wildcard matching.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync, existsSync } from "node:fs"

function tmpGrantsPath(): string {
  return join(tmpdir(), `edith-grants-${Date.now()}.json`)
}

// Mock audit-interceptor so permission checks don't try to write to a log
vi.mock("../audit-interceptor.js", () => ({
  auditDenied: vi.fn().mockResolvedValue(undefined),
}))

describe("PermissionManager", () => {
  let grantsPath: string

  beforeEach(() => {
    grantsPath = tmpGrantsPath()
    vi.resetModules()
  })

  afterEach(() => {
    if (existsSync(grantsPath)) rmSync(grantsPath, { force: true })
  })

  it("denies when no grants exist", async () => {
    const { PermissionManager } = await import("../permission-manager.js")
    const pm = new PermissionManager()
    const result = await pm.check("calendar.read", "user1")
    expect(result.allowed).toBe(false)
  })

  it("allows after explicit grant", async () => {
    const { PermissionManager } = await import("../permission-manager.js")
    const pm = new PermissionManager()
    await pm.grant("calendar.read", "user1")
    const result = await pm.check("calendar.read", "user1")
    expect(result.allowed).toBe(true)
  })

  it("wildcard grant allows all sub-tools", async () => {
    const { PermissionManager } = await import("../permission-manager.js")
    const pm = new PermissionManager()
    await pm.grant("calendar.*", "user1")

    expect((await pm.check("calendar.read", "user1")).allowed).toBe(true)
    expect((await pm.check("calendar.createEvent", "user1")).allowed).toBe(true)
    expect((await pm.check("email.send", "user1")).allowed).toBe(false)
  })

  it("global wildcard grants everything", async () => {
    const { PermissionManager } = await import("../permission-manager.js")
    const pm = new PermissionManager()
    await pm.grant("*", "user1")
    expect((await pm.check("anything.at.all", "user1")).allowed).toBe(true)
  })

  it("revoke removes a grant", async () => {
    const { PermissionManager } = await import("../permission-manager.js")
    const pm = new PermissionManager()
    await pm.grant("tool.x", "user1")
    await pm.revoke("tool.x", "user1")
    expect((await pm.check("tool.x", "user1")).allowed).toBe(false)
  })

  it("expired grant is denied", async () => {
    const { PermissionManager } = await import("../permission-manager.js")
    const pm = new PermissionManager()
    // Grant that expired 1 ms ago
    await pm.grant("tool.y", "user1", { ttlMs: -1 })
    const result = await pm.check("tool.y", "user1")
    expect(result.allowed).toBe(false)
  })

  it("listActive excludes expired grants", async () => {
    const { PermissionManager } = await import("../permission-manager.js")
    const pm = new PermissionManager()
    await pm.grant("active.tool", "user1", { ttlMs: 60_000 })
    await pm.grant("expired.tool", "user1", { ttlMs: -1 })
    const active = await pm.listActive("user1")
    expect(active.some(g => g.key === "active.tool")).toBe(true)
    expect(active.some(g => g.key === "expired.tool")).toBe(false)
  })
})
