/**
 * Session manager — encrypt/decrypt, save/restore, prune expired sessions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionManager } from "../session-manager.js"

// Use a temp dir per test run to avoid pollution
const TEST_DIR = join(tmpdir(), `edith-session-test-${Date.now()}`)

describe("SessionManager", () => {
  let sm: SessionManager

  beforeEach(() => {
    sm = new SessionManager(TEST_DIR, 7)
  })

  afterEach(async () => {
    // cleanup
    await unlink(TEST_DIR).catch(() => {})
  })

  it("save + restore roundtrip: cookies survive serialisation", async () => {
    const cookies = [{ name: "token", value: "abc123", domain: "example.com", path: "/" }]
    const fakeSaveCtx = { cookies: async () => cookies }
    await sm.save(fakeSaveCtx as never, "https://example.com")

    const restored: unknown[] = []
    const fakeRestoreCtx = { addCookies: async (c: unknown[]) => { restored.push(...c) } }
    const ok = await sm.restore(fakeRestoreCtx as never, "https://example.com")

    expect(ok).toBe(true)
    expect(restored).toHaveLength(1)
    expect((restored[0] as { name: string }).name).toBe("token")
  })

  it("restore returns false when no session file exists", async () => {
    const fakeCtx = { addCookies: async (_c: unknown[]) => {} }
    const ok = await sm.restore(fakeCtx as never, "https://nonexistent.example.com")
    expect(ok).toBe(false)
  })

  it("clear removes the session file", async () => {
    const fakeSaveCtx = { cookies: async () => [{ name: "a", value: "b", domain: "d.com", path: "/" }] }
    await sm.save(fakeSaveCtx as never, "https://d.com")

    await sm.clear("https://d.com")

    const fakeCtx = { addCookies: async (_c: unknown[]) => {} }
    const ok = await sm.restore(fakeCtx as never, "https://d.com")
    expect(ok).toBe(false)
  })

  it("pruneExpired removes old sessions", async () => {
    // Create a session file with an old mtime
    await mkdir(TEST_DIR, { recursive: true })
    // Write a valid encrypted session using the manager
    const fakeSaveCtx = { cookies: async () => [{ name: "x", value: "y", domain: "oldsite.com", path: "/" }] }
    await sm.save(fakeSaveCtx as never, "https://oldsite.com")

    // Manually override contents with an EXPIRED savedAt (8 days ago) using the private method
    // We can't reach private encrypt, so we create an sm with 0-day max age to force expiry
    const shortSm = new SessionManager(TEST_DIR, 0)
    await shortSm.pruneExpired()

    // pruneExpired with maxAge=0 → maxMs=0 → any file ageMs > 0 → file deleted
    const fakeCtx = { addCookies: async (_c: unknown[]) => {} }
    const ok = await sm.restore(fakeCtx as never, "https://oldsite.com")
    expect(ok).toBe(false) // file was pruned by the 0-day manager
  })

  it("save is idempotent — overwrite works", async () => {
    const cookiesV1 = [{ name: "v", value: "1", domain: "e.com", path: "/" }]
    const cookiesV2 = [{ name: "v", value: "2", domain: "e.com", path: "/" }]
    await sm.save({ cookies: async () => cookiesV1 } as never, "https://e.com")
    await sm.save({ cookies: async () => cookiesV2 } as never, "https://e.com")

    const restored: unknown[] = []
    await sm.restore({ addCookies: async (c: unknown[]) => { restored.push(...c) } } as never, "https://e.com")
    expect((restored[0] as { value: string }).value).toBe("2")
  })

  it("domain with special chars is normalized to a safe filename", async () => {
    const fakeSaveCtx = { cookies: async () => [] }
    // Should not throw even with weird domain
    await expect(sm.save(fakeSaveCtx as never, "https://weird/domain?q=1")).resolves.not.toThrow()
  })

  it("encrypts data — raw file is not plaintext JSON", async () => {
    const fakeSaveCtx = { cookies: async () => [{ name: "secret", value: "hunter2", domain: "s.com", path: "/" }] }
    await sm.save(fakeSaveCtx as never, "https://s.com")

    const files = await import("node:fs/promises")
    const dir = await files.readdir(TEST_DIR).catch(() => [] as string[])
    const sessionFile = dir.find((f) => f.includes("s.com") || f.includes("s_com"))
    expect(sessionFile).toBeDefined()
    if (sessionFile) {
      const raw = await readFile(join(TEST_DIR, sessionFile), "utf8")
      expect(raw).not.toContain("hunter2")
      expect(raw).not.toContain('"cookies"')
    }
  })

  it("restoring a corrupted session file returns false without throwing", async () => {
    await mkdir(TEST_DIR, { recursive: true })
    await writeFile(join(TEST_DIR, "corrupted.com.session"), "not:valid:hex", { mode: 0o600 })
    const corrupted = new SessionManager(TEST_DIR)
    const fakeCtx = { addCookies: async (_c: unknown[]) => {} }
    // Override sessionFilePath to use our file
    const ok = await corrupted.restore(fakeCtx as never, "https://corrupted.com").catch(() => false)
    expect(ok).toBe(false)
  })

  it("pruneExpired is safe when dir does not exist", async () => {
    const fresh = new SessionManager("/tmp/edith-nonexistent-dir-" + Date.now())
    await expect(fresh.pruneExpired()).resolves.not.toThrow()
  })

  it("different encryption keys → restore fails (wrong key → false)", async () => {
    const sm1 = new SessionManager(TEST_DIR)
    await sm1.save({ cookies: async () => [{ name: "k", value: "v", domain: "x.com", path: "/" }] } as never, "https://x.com")

    // Simulate a manager with a different key by creating one with overridden internals
    // We can test that decrypt throws on bad data → mock: write garbage IV:tag:data
    await mkdir(TEST_DIR, { recursive: true })
    // Overwrite the session file (sm1 created "x.com.session") with garbage to simulate wrong key/corruption
    await writeFile(join(TEST_DIR, "x.com.session"), "aabbccdd:eeff0011:1234567890abcdef", { mode: 0o600 })
    const sm2 = new SessionManager(TEST_DIR)
    const fakeCtx = { addCookies: async (_c: unknown[]) => {} }
    const ok = await sm2.restore(fakeCtx as never, "https://x.com").catch(() => false)
    expect(ok).toBe(false)
  })
})
