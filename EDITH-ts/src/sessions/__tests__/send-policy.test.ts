import { describe, expect, it, beforeEach } from "vitest"

import { SendPolicyManager } from "../send-policy.js"

describe("SendPolicyManager", () => {
  let policy: SendPolicyManager

  beforeEach(() => {
    policy = new SendPolicyManager()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Message length checks
  // ───────────────────────────────────────────────────────────────────────────

  describe("message length", () => {
    it("allows messages within length limit", async () => {
      const result = await policy.check("u1", "cli", "Hello!")
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it("rejects messages exceeding max length", async () => {
      const longMessage = "x".repeat(5000)
      const result = await policy.check("u1", "cli", longMessage)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("maximum length")
    })

    it("allows exactly the max length", async () => {
      // Max is 4000 characters
      const exactMax = "x".repeat(4000)
      const result = await policy.check("u1", "cli", exactMax)
      expect(result.allowed).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Rate limiting
  // ───────────────────────────────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("allows messages under rate limit", async () => {
      for (let i = 0; i < 10; i++) {
        const result = await policy.check("u1", "cli", "msg")
        expect(result.allowed).toBe(true)
      }
    })

    it("rejects messages exceeding rate limit", async () => {
      // Send 30 messages (the limit)
      for (let i = 0; i < 30; i++) {
        const result = await policy.check("u1", "cli", "msg")
        expect(result.allowed).toBe(true)
      }

      // 31st should be rejected
      const result = await policy.check("u1", "cli", "msg")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("Rate limit")
    })

    it("tracks rate limits per user-channel pair", async () => {
      // Fill up user1:cli
      for (let i = 0; i < 30; i++) {
        await policy.check("u1", "cli", "msg")
      }

      // user2:cli should still work
      const result1 = await policy.check("u2", "cli", "msg")
      expect(result1.allowed).toBe(true)

      // user1:webchat should still work
      const result2 = await policy.check("u1", "webchat", "msg")
      expect(result2.allowed).toBe(true)
    })
  })
})
