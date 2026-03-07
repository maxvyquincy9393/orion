import { describe, expect, it } from "vitest"

import { sanitizeUserId, clamp, parseJsonSafe } from "../string.js"

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeUserId
// ─────────────────────────────────────────────────────────────────────────────

describe("sanitizeUserId", () => {
  it("returns valid user IDs unchanged", () => {
    expect(sanitizeUserId("user-123")).toBe("user-123")
    expect(sanitizeUserId("user_456")).toBe("user_456")
    expect(sanitizeUserId("ABC")).toBe("ABC")
    expect(sanitizeUserId("onlyletters")).toBe("onlyletters")
  })

  it("replaces spaces and special characters with underscores", () => {
    expect(sanitizeUserId("user name")).toBe("user_name")
    expect(sanitizeUserId("user@domain.com")).toBe("user_domain_com")
    expect(sanitizeUserId("user!@#$%")).toBe("user_____")
  })

  it("handles empty string", () => {
    // Empty string passes the regex test (no disallowed chars)
    expect(sanitizeUserId("")).toBe("")
  })

  it("replaces unicode characters", () => {
    expect(sanitizeUserId("用户")).toBe("__")
    expect(sanitizeUserId("café")).toBe("caf_")
  })

  it("preserves hyphens and underscores", () => {
    expect(sanitizeUserId("a-b_c")).toBe("a-b_c")
    expect(sanitizeUserId("--__--")).toBe("--__--")
  })

  it("handles SQL injection attempts", () => {
    expect(sanitizeUserId("user'; DROP TABLE --")).toBe("user___DROP_TABLE_--")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// clamp
// ─────────────────────────────────────────────────────────────────────────────

describe("clamp", () => {
  it("returns value when within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it("clamps below minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(-Infinity, 0, 10)).toBe(0)
  })

  it("clamps above maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(Infinity, 0, 10)).toBe(10)
  })

  it("returns min for NaN", () => {
    expect(clamp(NaN, 0, 10)).toBe(0)
    expect(clamp(NaN, 5, 10)).toBe(5)
  })

  it("works with negative ranges", () => {
    expect(clamp(-3, -10, -1)).toBe(-3)
    expect(clamp(0, -10, -1)).toBe(-1)
    expect(clamp(-20, -10, -1)).toBe(-10)
  })

  it("works with fractional values", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(1.5, 0, 1)).toBe(1)
    expect(clamp(-0.5, 0, 1)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonSafe
// ─────────────────────────────────────────────────────────────────────────────

describe("parseJsonSafe", () => {
  it("parses valid JSON objects", () => {
    expect(parseJsonSafe('{"key": "value"}')).toEqual({ key: "value" })
    expect(parseJsonSafe('{"a": 1, "b": true}')).toEqual({ a: 1, b: true })
  })

  it("returns empty object for invalid JSON", () => {
    expect(parseJsonSafe("not json")).toEqual({})
    expect(parseJsonSafe("{invalid}")).toEqual({})
    expect(parseJsonSafe("")).toEqual({})
  })

  it("returns empty object for non-object JSON values", () => {
    expect(parseJsonSafe('"string"')).toEqual({})
    expect(parseJsonSafe("42")).toEqual({})
    expect(parseJsonSafe("true")).toEqual({})
    expect(parseJsonSafe("null")).toEqual({})
  })

  it("returns empty object for JSON arrays", () => {
    // Arrays should be rejected since the return type is Record<string, unknown>
    expect(parseJsonSafe("[1, 2, 3]")).toEqual({})
    expect(parseJsonSafe("[]")).toEqual({})
  })

  it("parses nested objects", () => {
    const input = '{"nested": {"deep": "value"}, "list": [1, 2]}'
    const result = parseJsonSafe(input)
    expect(result).toEqual({ nested: { deep: "value" }, list: [1, 2] })
  })
})
