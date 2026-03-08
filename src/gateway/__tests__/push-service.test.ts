/**
 * @file push-service.test.ts
 * @description Unit tests for PushService (server-side Expo push delivery)
 * and PushTokenStore (push token registry).
 *
 * ARCHITECTURE:
 *   - Mocks Prisma client to isolate DB calls.
 *   - Mocks global `fetch` to simulate Expo Push API responses.
 *   - Mutates mocked config object for dry-run / quiet-hours scenarios.
 *   - Uses unique `userId` per test to prevent rate-limit counter bleed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PushToken } from "@prisma/client"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

vi.mock("../../database/index.js", () => ({
  prisma: {
    pushToken: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("../../config.js", () => ({
  default: {
    PUSH_QUIET_HOURS_START: "23:00",
    PUSH_QUIET_HOURS_END: "07:00",
    PUSH_MAX_DAILY_LOW_PRIORITY: 3,
    PUSH_DRY_RUN: false,
    EXPO_PUSH_ACCESS_TOKEN: "",
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal Expo push success ticket array for `n` tokens. */
function successTickets(n: number): unknown {
  return { data: Array.from({ length: n }, () => ({ status: "ok", id: "ticket-1" })) }
}

/** Build an Expo response with one DeviceNotRegistered error ticket. */
function deviceNotRegisteredTickets(): unknown {
  return {
    data: [{ status: "error", details: { error: "DeviceNotRegistered" }, message: "stale" }],
  }
}

// ── PushService tests ─────────────────────────────────────────────────────────

describe("PushService", () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    const { prisma } = await import("../../database/index.js")
    const cfg = (await import("../../config.js")).default as Record<string, unknown>

    // Reset config to non-dry-run defaults
    cfg["PUSH_DRY_RUN"] = false
    cfg["PUSH_QUIET_HOURS_START"] = "23:00"
    cfg["PUSH_QUIET_HOURS_END"] = "07:00"

    // Default token set
    vi.mocked(prisma.pushToken.findMany).mockResolvedValue([
      { token: "ExponentPushToken[test-token-abc]" } as PushToken,
    ])
    vi.mocked(prisma.pushToken.upsert).mockResolvedValue({} as PushToken)
    vi.mocked(prisma.pushToken.delete).mockResolvedValue({} as PushToken)
    vi.mocked(prisma.pushToken.deleteMany).mockResolvedValue({ count: 1 })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => successTickets(1),
    }) as unknown as typeof fetch
  })

  it("sends notification to Expo when DRY_RUN=false and tokens exist", async () => {
    const { pushService } = await import("../push-service.js")

    await pushService.send({
      userId: "happy-user",
      title: "Hello",
      body: "World",
      priority: "normal",
      category: "chat_message",
    })

    expect(global.fetch).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(global.fetch).mock.calls[0]
    expect(callArgs?.[0]).toBe("https://exp.host/--/api/v2/push/send")
  })

  it("does not call Expo API when DRY_RUN=true", async () => {
    const cfg = (await import("../../config.js")).default as Record<string, unknown>
    cfg["PUSH_DRY_RUN"] = true

    const { pushService } = await import("../push-service.js")

    await pushService.send({
      userId: "dry-run-user",
      title: "Test",
      body: "Dry run body",
      priority: "normal",
      category: "chat_message",
    })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("returns early without fetch when user has no registered tokens", async () => {
    const { prisma } = await import("../../database/index.js")
    vi.mocked(prisma.pushToken.findMany).mockResolvedValueOnce([])

    const { pushService } = await import("../push-service.js")

    await pushService.send({
      userId: "no-token-user",
      title: "Test",
      body: "No tokens",
      priority: "normal",
      category: "chat_message",
    })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("deregisters token when Expo returns DeviceNotRegistered", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => deviceNotRegisteredTickets(),
    }) as unknown as typeof fetch

    const { pushService } = await import("../push-service.js")

    await pushService.send({
      userId: "stale-token-user",
      title: "Test",
      body: "Stale device",
      priority: "normal",
      category: "chat_message",
    })

    // deregister is fire-and-forget — wait for microtasks to drain
    const { prisma } = await import("../../database/index.js")
    await vi.waitFor(() => {
      expect(prisma.pushToken.delete).toHaveBeenCalledWith({
        where: { token: "ExponentPushToken[test-token-abc]" },
      })
    })
  })

  it("drops low-priority notification after daily limit is reached", async () => {
    // Use a user that has not been used in any prior test (unique userId)
    const userId = "rate-limit-user-" + Date.now()

    const { pushService } = await import("../push-service.js")

    // Call 4 times; limit is 3 (from mock config PUSH_MAX_DAILY_LOW_PRIORITY: 3)
    for (let i = 0; i < 4; i++) {
      await pushService.send({
        userId,
        title: `Suggestion ${i}`,
        body: "Proactive message",
        priority: "low",
        category: "proactive_suggestion",
      })
    }

    // Only 3 calls should reach Expo (4th is rate-limited)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it("suppresses non-critical notification during quiet hours", async () => {
    vi.useFakeTimers()
    // Set system time to 2:00 AM — well within 23:00–07:00 quiet window
    vi.setSystemTime(new Date("2024-01-15T02:00:00"))

    const { pushService } = await import("../push-service.js")

    await pushService.send({
      userId: "quiet-hours-user",
      title: "Suggestion",
      body: "Not now",
      priority: "normal",
      category: "proactive_suggestion",
    })

    expect(global.fetch).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("sends critical notification even during quiet hours", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-01-15T02:00:00"))

    const { pushService } = await import("../push-service.js")

    await pushService.send({
      userId: "critical-quiet-user",
      title: "ALERT",
      body: "Security alert!",
      priority: "critical",
      category: "security_alert",
    })

    expect(global.fetch).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it("logs error on non-OK Expo API response without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    }) as unknown as typeof fetch

    const { pushService } = await import("../push-service.js")

    // Must not throw
    await expect(
      pushService.send({
        userId: "error-response-user",
        title: "Test",
        body: "Error body",
        priority: "high",
        category: "chat_message",
      }),
    ).resolves.toBeUndefined()
  })
})

// ── PushTokenStore tests ──────────────────────────────────────────────────────

describe("PushTokenStore", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { prisma } = await import("../../database/index.js")
    vi.mocked(prisma.pushToken.upsert).mockResolvedValue({} as PushToken)
    vi.mocked(prisma.pushToken.delete).mockResolvedValue({} as PushToken)
    vi.mocked(prisma.pushToken.findMany).mockResolvedValue([])
  })

  it("accepts a valid Expo push token format", async () => {
    const { pushTokenStore } = await import("../push-tokens.js")
    const { prisma } = await import("../../database/index.js")

    await pushTokenStore.register("owner", "ExponentPushToken[validtoken123]", "ios")

    expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: "ExponentPushToken[validtoken123]" },
      }),
    )
  })

  it("throws on invalid push token format", async () => {
    const { pushTokenStore } = await import("../push-tokens.js")

    await expect(
      pushTokenStore.register("owner", "invalid-format-token", "android"),
    ).rejects.toThrow("Invalid Expo push token")
  })

  it("returns empty array for user with no tokens", async () => {
    const { pushTokenStore } = await import("../push-tokens.js")

    const tokens = await pushTokenStore.getTokens("unknown-user")

    expect(tokens).toEqual([])
  })

  it("deregister is idempotent / silent when token is missing", async () => {
    const { prisma } = await import("../../database/index.js")
    // Simulate "record not found" error (Prisma P2025)
    vi.mocked(prisma.pushToken.delete).mockRejectedValueOnce(
      Object.assign(new Error("Record to delete does not exist"), { code: "P2025" }),
    )

    const { pushTokenStore } = await import("../push-tokens.js")

    // Must not throw
    await expect(
      pushTokenStore.deregister("ExponentPushToken[nonexistent]"),
    ).resolves.toBeUndefined()
  })

  it("clearAll calls deleteMany with the given userId", async () => {
    const { pushTokenStore } = await import("../push-tokens.js")
    const { prisma } = await import("../../database/index.js")

    await pushTokenStore.clearAll("bye-user")

    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "bye-user" },
    })
  })
})

// ── isValidExpoPushToken tests ────────────────────────────────────────────────

describe("isValidExpoPushToken", () => {
  it("accepts standard Expo token", async () => {
    const { isValidExpoPushToken } = await import("../push-tokens.js")
    expect(isValidExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxxx]")).toBe(true)
  })

  it("accepts token with hyphens in the ID segment", async () => {
    const { isValidExpoPushToken } = await import("../push-tokens.js")
    expect(isValidExpoPushToken("ExponentPushToken[abc-def-123]")).toBe(true)
  })

  it("rejects token without brackets", async () => {
    const { isValidExpoPushToken } = await import("../push-tokens.js")
    expect(isValidExpoPushToken("ExponentPushToken:abc123")).toBe(false)
  })

  it("rejects completely invalid string", async () => {
    const { isValidExpoPushToken } = await import("../push-tokens.js")
    expect(isValidExpoPushToken("fcm:APA91bHPR...")).toBe(false)
  })
})
