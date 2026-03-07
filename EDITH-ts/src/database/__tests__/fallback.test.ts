import { describe, expect, it } from "vitest"

import { isFallback } from "../index.js"

describe("database/isFallback", () => {
  it("returns true for objects with __fallback: true", () => {
    const result = { id: "fake", __fallback: true as const }
    expect(isFallback(result)).toBe(true)
  })

  it("returns false for normal objects without __fallback", () => {
    const result = { id: "real", content: "hello" }
    expect(isFallback(result)).toBe(false)
  })

  it("returns false for objects with __fallback: false", () => {
    const result = { id: "x", __fallback: false }
    expect(isFallback(result)).toBe(false)
  })

  it("returns false for null", () => {
    expect(isFallback(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isFallback(undefined)).toBe(false)
  })

  it("returns false for primitives", () => {
    expect(isFallback(42)).toBe(false)
    expect(isFallback("hello")).toBe(false)
    expect(isFallback(true)).toBe(false)
  })
})
