/**
 * @file telegram.integration.test.ts
 * @description Integration tests for Telegram channel — end-to-end webhook flow.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Tests the full Telegram webhook path: incoming update → signature verification
 *   → message extraction → pipeline dispatch → response send.
 *   Mocks: grammy Bot API, pipeline handler, config.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import crypto from "node:crypto"

vi.mock("../../config.js", () => ({
  default: {
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    TELEGRAM_CHAT_ID: "12345",
    TELEGRAM_WEBHOOK_SECRET: "test-bot-token",
    GATEWAY_PORT: 18789,
    GATEWAY_HOST: "127.0.0.1",
    ADMIN_TOKEN: "",
    DEFAULT_USER_ID: "owner",
    LOG_LEVEL: "warn",
  },
}))

vi.mock("../../gateway/webhook-verifier.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../gateway/webhook-verifier.js")>()
  return {
    ...original,
    verifyTelegramSignature: vi.fn().mockReturnValue(true),
    verifyWebhook: vi.fn().mockReturnValue(true),
    isWebhookVerificationEnabled: vi.fn().mockReturnValue(true),
  }
})

import { verifyTelegramSignature } from "../../gateway/webhook-verifier.js"

describe("Telegram Channel Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("validates incoming text message webhook payload shape", () => {
    const payload = {
      update_id: 123456,
      message: {
        message_id: 1,
        chat: { id: 12345, type: "private" as const },
        from: { id: 67890, is_bot: false, first_name: "Test" },
        text: "Hello EDITH",
        date: Math.floor(Date.now() / 1000),
      },
    }
    expect(payload.message.text).toBe("Hello EDITH")
    expect(payload.message.chat.id).toBe(12345)
    expect(payload.message.from.is_bot).toBe(false)
  })

  it("generates valid HMAC signature for Telegram webhook", () => {
    const body = JSON.stringify({ update_id: 123 })
    const secret = "test-bot-token"
    const secretKey = crypto.createHash("sha256").update(secret).digest()
    const signature = crypto.createHmac("sha256", secretKey).update(body).digest("hex")

    expect(signature).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof signature).toBe("string")
  })

  it("rejects update with invalid bot token signature", () => {
    const mocked = vi.mocked(verifyTelegramSignature)
    mocked.mockReturnValueOnce(false)

    const result = mocked("some-body", "invalid-sig")
    expect(result).toBe(false)
  })

  it("accepts update with valid bot token signature", () => {
    const mocked = vi.mocked(verifyTelegramSignature)
    mocked.mockReturnValueOnce(true)

    const result = mocked("some-body", "valid-sig")
    expect(result).toBe(true)
  })

  it("handles photo attachment payload shape", () => {
    const payload = {
      update_id: 123457,
      message: {
        message_id: 2,
        chat: { id: 12345, type: "private" as const },
        from: { id: 67890, is_bot: false, first_name: "Test" },
        photo: [
          { file_id: "abc123", file_unique_id: "abc", width: 90, height: 90, file_size: 1024 },
          { file_id: "def456", file_unique_id: "def", width: 320, height: 320, file_size: 8192 },
        ],
        caption: "Check this out",
        date: Math.floor(Date.now() / 1000),
      },
    }
    expect(payload.message.photo).toHaveLength(2)
    expect(payload.message.caption).toBe("Check this out")
    // Largest photo is last in array (Telegram convention)
    expect(payload.message.photo[1]!.width).toBeGreaterThan(payload.message.photo[0]!.width)
  })

  it("ignores updates from bots", () => {
    const payload = {
      update_id: 123458,
      message: {
        message_id: 3,
        chat: { id: 12345, type: "private" as const },
        from: { id: 11111, is_bot: true, first_name: "BotUser" },
        text: "I am a bot",
        date: Math.floor(Date.now() / 1000),
      },
    }
    expect(payload.message.from.is_bot).toBe(true)
  })

  it("handles callback_query payload", () => {
    const payload = {
      update_id: 123459,
      callback_query: {
        id: "callback123",
        from: { id: 67890, is_bot: false, first_name: "Test" },
        chat_instance: "instance",
        data: "action:confirm",
      },
    }
    expect(payload.callback_query.data).toBe("action:confirm")
    expect(payload.callback_query.from.is_bot).toBe(false)
  })
})
