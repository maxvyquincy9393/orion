import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { SecretVault } from "../vault"

describe("SecretVault", () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      SECRET_VAULT_PROVIDER: process.env.SECRET_VAULT_PROVIDER,
      TEST_SECRET_KEY: process.env.TEST_SECRET_KEY,
    }
    // Default to env provider for tests
    process.env.SECRET_VAULT_PROVIDER = "env"
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe("EnvSecretProvider (via SecretVault)", () => {
    it("should resolve an env var that exists", async () => {
      process.env.TEST_SECRET_KEY = "my-secret-value"
      const vault = new SecretVault()
      const result = await vault.resolve("TEST_SECRET_KEY")
      expect(result).toBe("my-secret-value")
    })

    it("should return undefined for a missing env var", async () => {
      delete process.env.TEST_SECRET_KEY
      const vault = new SecretVault()
      const result = await vault.resolve("TEST_SECRET_KEY")
      expect(result).toBeUndefined()
    })

    it("should return undefined for an empty string env var", async () => {
      process.env.TEST_SECRET_KEY = "  "
      const vault = new SecretVault()
      const result = await vault.resolve("TEST_SECRET_KEY")
      expect(result).toBeUndefined()
    })
  })

  describe("listProviders", () => {
    it("should list env provider for default config", () => {
      process.env.SECRET_VAULT_PROVIDER = "env"
      const vault = new SecretVault()
      expect(vault.listProviders()).toEqual(["env"])
    })
  })

  describe("listAvailableProviders", () => {
    it("should include env provider (always available)", async () => {
      const vault = new SecretVault()
      const available = await vault.listAvailableProviders()
      expect(available).toContain("env")
    })
  })
})
