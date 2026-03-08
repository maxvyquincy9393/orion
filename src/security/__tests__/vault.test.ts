/**
 * @file vault.test.ts
 * @description Unit tests for SecureVault and vault-crypto helpers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync, existsSync } from "node:fs"

// ── Helpers ────────────────────────────────────────────────────────────────────

function tmpVaultPath(): string {
  return join(tmpdir(), `edith-test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

// ── vault-crypto unit tests ────────────────────────────────────────────────────

describe("vault-crypto", () => {
  it("encrypt/decrypt round-trips a string", async () => {
    const { deriveKey, generateSalt, encrypt, decrypt } = await import("../vault-crypto.js")

    const salt = generateSalt()
    const key = await deriveKey("test-passphrase", salt)
    const blob = encrypt("my-secret-value", key)

    expect(blob.iv).toHaveLength(24) // 12 bytes = 24 hex chars
    expect(blob.tag).toHaveLength(32) // 16 bytes = 32 hex chars

    const result = decrypt(blob, key)
    expect(result).toBe("my-secret-value")
  })

  it("decrypt throws on wrong key", async () => {
    const { deriveKey, generateSalt, encrypt, decrypt } = await import("../vault-crypto.js")

    const salt = generateSalt()
    const key1 = await deriveKey("correct-passphrase", salt)
    const key2 = await deriveKey("wrong-passphrase", salt)

    const blob = encrypt("secret", key1)
    expect(() => decrypt(blob, key2)).toThrow("Decryption failed")
  })

  it("each encryption produces a different IV", async () => {
    const { deriveKey, generateSalt, encrypt } = await import("../vault-crypto.js")

    const salt = generateSalt()
    const key = await deriveKey("passphrase", salt)
    const blob1 = encrypt("same-value", key)
    const blob2 = encrypt("same-value", key)

    expect(blob1.iv).not.toBe(blob2.iv)
  })

  it("hmacSha256 produces consistent output", async () => {
    const { hmacSha256 } = await import("../vault-crypto.js")

    const secret = "a".repeat(64)
    const h1 = hmacSha256("data", secret)
    const h2 = hmacSha256("data", secret)
    const h3 = hmacSha256("different-data", secret)

    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
  })
})

// ── SecureVault unit tests ────────────────────────────────────────────────────

describe("SecureVault", () => {
  let vaultPath: string

  beforeEach(() => {
    vaultPath = tmpVaultPath()
    // Override the config module so vault uses our temp path
    vi.doMock("../../config.js", () => ({
      default: {
        VAULT_PATH: vaultPath,
        VAULT_AUTO_LOCK_MS: 0, // no auto-lock in tests
      },
    }))
  })

  afterEach(() => {
    // clean up temp files
    if (existsSync(vaultPath)) rmSync(vaultPath, { force: true })
    if (existsSync(`${vaultPath}.meta`)) rmSync(`${vaultPath}.meta`, { force: true })
    vi.resetModules()
  })

  it("unlocks and creates a new vault", async () => {
    const { SecureVault } = await import("../vault.js")
    const v = new SecureVault()
    await v.unlock("test-pass")
    expect(v.isUnlocked()).toBe(true)
    expect(existsSync(vaultPath)).toBe(true)
    expect(existsSync(`${vaultPath}.meta`)).toBe(true)
    v.lock()
  })

  it("set/get round-trips a secret", async () => {
    const { SecureVault } = await import("../vault.js")
    const v = new SecureVault()
    await v.unlock("test-pass")

    await v.set("MY_KEY", "my-secret")
    const val = await v.get("MY_KEY")
    expect(val).toBe("my-secret")
    v.lock()
  })

  it("get returns undefined for missing key", async () => {
    const { SecureVault } = await import("../vault.js")
    const v = new SecureVault()
    await v.unlock("test-pass")
    expect(await v.get("NOPE")).toBeUndefined()
    v.lock()
  })

  it("persists secrets across re-unlock", async () => {
    const { SecureVault } = await import("../vault.js")
    const v1 = new SecureVault()
    await v1.unlock("test-pass")
    await v1.set("TOKEN", "abc123")
    v1.lock()

    const v2 = new SecureVault()
    await v2.unlock("test-pass")
    expect(await v2.get("TOKEN")).toBe("abc123")
    v2.lock()
  })

  it("throws when accessing secret on locked vault", async () => {
    const { SecureVault } = await import("../vault.js")
    const v = new SecureVault()
    await expect(v.get("ANYTHING")).rejects.toThrow("locked")
  })

  it("delete removes a secret", async () => {
    const { SecureVault } = await import("../vault.js")
    const v = new SecureVault()
    await v.unlock("test-pass")
    await v.set("DEL_KEY", "value")
    const removed = await v.delete("DEL_KEY")
    expect(removed).toBe(true)
    expect(await v.get("DEL_KEY")).toBeUndefined()
    v.lock()
  })

  it("list returns only keys", async () => {
    const { SecureVault } = await import("../vault.js")
    const v = new SecureVault()
    await v.unlock("test-pass")
    await v.set("A", "1")
    await v.set("B", "2")
    const keys = await v.list()
    expect(keys).toContain("A")
    expect(keys).toContain("B")
    expect(keys).toHaveLength(2)
    v.lock()
  })

  it("fails to unlock with wrong passphrase", async () => {
    const { SecureVault } = await import("../vault.js")
    const v1 = new SecureVault()
    await v1.unlock("correct-pass")
    await v1.set("X", "y")
    v1.lock()

    const v2 = new SecureVault()
    await expect(v2.unlock("wrong-pass")).rejects.toThrow()
  })
})
