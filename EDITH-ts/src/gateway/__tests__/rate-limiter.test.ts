import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { __gatewayTestUtils } from "../server.js"
import { createRateLimiter } from "../rate-limiter.js"

const { isRateLimited, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } = __gatewayTestUtils

describe("gateway/rate-limiter", () => {
  it("allows requests under the limit", () => {
    const ip = `test-under-${Date.now()}`
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(isRateLimited(ip)).toBe(false)
    }
  })

  it("blocks once count exceeds RATE_LIMIT_MAX", () => {
    const ip = `test-over-${Date.now()}`
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      isRateLimited(ip)
    }
    // The (RATE_LIMIT_MAX + 1)th request should be blocked
    expect(isRateLimited(ip)).toBe(true)
  })

  it("treats different IPs independently", () => {
    const ipA = `test-a-${Date.now()}`
    const ipB = `test-b-${Date.now()}`
    // Exhaust ipA
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      isRateLimited(ipA)
    }
    expect(isRateLimited(ipA)).toBe(true)
    // ipB should still be allowed
    expect(isRateLimited(ipB)).toBe(false)
  })

  it("exports expected constants", () => {
    expect(RATE_LIMIT_MAX).toBe(60)
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000)
  })

  it("shares counters across instances with file backend", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edith-rate-limit-"))
    const filePath = path.join(tempDir, "rate-limit.json")

    try {
      const limiterA = createRateLimiter({
        backend: "file",
        filePath,
        maxRequests: 3,
        windowMs: 60_000,
        lockTimeoutMs: 200,
      })
      const limiterB = createRateLimiter({
        backend: "file",
        filePath,
        maxRequests: 3,
        windowMs: 60_000,
        lockTimeoutMs: 200,
      })

      expect(limiterA.consume("203.0.113.10").limited).toBe(false)
      expect(limiterA.consume("203.0.113.10").limited).toBe(false)
      expect(limiterB.consume("203.0.113.10").limited).toBe(false)
      expect(limiterB.consume("203.0.113.10").limited).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
