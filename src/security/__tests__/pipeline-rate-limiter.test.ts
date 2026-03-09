/**
 * @file pipeline-rate-limiter.test.ts
 * @description Tests for PipelineRateLimiter — token-bucket rate limiting at the pipeline level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../config.js", () => ({
  default: {
    PIPELINE_RATE_LIMIT_PER_MIN: 20,
  },
}))

import { PipelineRateLimiter } from "../pipeline-rate-limiter.js"

describe("PipelineRateLimiter", () => {
  let limiter: PipelineRateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = new PipelineRateLimiter()
  })

  afterEach(() => {
    limiter.destroy()
    vi.useRealTimers()
  })

  it("allows messages under the 20/min limit", () => {
    for (let i = 0; i < 20; i++) {
      expect(limiter.check("user1")).toBe(true)
    }
  })

  it("blocks the 21st message within 60s window", () => {
    for (let i = 0; i < 20; i++) {
      expect(limiter.check("user1")).toBe(true)
    }
    // 21st should be blocked
    expect(limiter.check("user1")).toBe(false)
  })

  it("different users have independent rate buckets", () => {
    // Use up user1's tokens
    for (let i = 0; i < 20; i++) {
      limiter.check("user1")
    }
    expect(limiter.check("user1")).toBe(false)
    // user2 should still have tokens
    expect(limiter.check("user2")).toBe(true)
  })

  it("window resets after 60s allowing new messages", () => {
    // Exhaust tokens
    for (let i = 0; i < 20; i++) {
      limiter.check("user1")
    }
    expect(limiter.check("user1")).toBe(false)

    // Advance 60 seconds — tokens should fully refill
    vi.advanceTimersByTime(60_000)
    expect(limiter.check("user1")).toBe(true)
  })

  it("partial refill allows some messages after partial wait", () => {
    // Exhaust tokens
    for (let i = 0; i < 20; i++) {
      limiter.check("user1")
    }
    expect(limiter.check("user1")).toBe(false)

    // Advance 3 seconds — should refill 1 token (20/60 = 0.33/s, 3s = 1 token)
    vi.advanceTimersByTime(3_000)
    expect(limiter.check("user1")).toBe(true)
    // But not a second one
    expect(limiter.check("user1")).toBe(false)
  })

  it("destroy() clears the eviction timer", () => {
    const clearSpy = vi.spyOn(global, "clearInterval")
    limiter.destroy()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
