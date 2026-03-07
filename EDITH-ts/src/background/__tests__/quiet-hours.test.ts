import { describe, expect, it } from "vitest"

import { isWithinHardQuietHours } from "../quiet-hours.js"

describe("isWithinHardQuietHours", () => {
  it("returns true during quiet hours window", () => {
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 22, 0, 0))).toBe(true)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 23, 59, 0))).toBe(true)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 0, 0, 0))).toBe(true)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 6, 0, 0))).toBe(true)
  })

  it("returns false outside quiet hours window", () => {
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 7, 0, 0))).toBe(false)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 12, 30, 0))).toBe(false)
    expect(isWithinHardQuietHours(new Date(2026, 2, 5, 21, 59, 0))).toBe(false)
  })
})
