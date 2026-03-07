import { describe, expect, it } from "vitest"

import { ConfigValidationError, validateRequired } from "../../config.js"

describe("config/validateRequired", () => {
  it("does not throw when keys have non-empty string values", () => {
    // DATABASE_URL always has a default ("file:./edith.db")
    expect(() => validateRequired(["DATABASE_URL"])).not.toThrow()
  })

  it("throws ConfigValidationError for empty required keys", () => {
    // ADMIN_TOKEN defaults to "" which counts as empty
    expect(() => validateRequired(["ADMIN_TOKEN"])).toThrow(ConfigValidationError)
  })

  it("includes missing key names in the error", () => {
    try {
      validateRequired(["ADMIN_TOKEN", "DISCORD_BOT_TOKEN"])
      // should not reach here
      expect.unreachable("validateRequired should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError)
      const cve = err as ConfigValidationError
      expect(cve.missingKeys).toContain("ADMIN_TOKEN")
      expect(cve.missingKeys).toContain("DISCORD_BOT_TOKEN")
    }
  })

  it("only reports actually-empty keys", () => {
    try {
      // DATABASE_URL has a default value, ADMIN_TOKEN is empty
      validateRequired(["DATABASE_URL", "ADMIN_TOKEN"])
      expect.unreachable("should throw")
    } catch (err) {
      const cve = err as ConfigValidationError
      expect(cve.missingKeys).toContain("ADMIN_TOKEN")
      expect(cve.missingKeys).not.toContain("DATABASE_URL")
    }
  })

  it("error message contains 'Missing required variables'", () => {
    try {
      validateRequired(["ADMIN_TOKEN"])
      expect.unreachable("should throw")
    } catch (err) {
      expect((err as Error).message).toContain("Missing required variables")
    }
  })
})
