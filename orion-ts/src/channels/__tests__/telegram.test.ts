import { describe, expect, it } from "vitest"

import { __telegramTestUtils } from "../telegram.js"

describe("telegram channel helpers", () => {
  it("parses TELEGRAM_CHAT_ID allowlist from comma and newline separated values", () => {
    const ids = __telegramTestUtils.parseAllowedTelegramChatIds("123, 456\n789\n")

    expect(Array.from(ids)).toEqual(["123", "456", "789"])
  })

  it("normalizes commands and respects bot username mention", () => {
    expect(__telegramTestUtils.normalizeTelegramCommand("/start", "orion_bot")).toBe("start")
    expect(__telegramTestUtils.normalizeTelegramCommand("/help@orion_bot", "orion_bot")).toBe("help")
    expect(__telegramTestUtils.normalizeTelegramCommand("/help@other_bot", "orion_bot")).toBeNull()
    expect(__telegramTestUtils.normalizeTelegramCommand("hello", "orion_bot")).toBeNull()
  })

  it("extracts inbound text messages and ignores non-text updates", () => {
    expect(__telegramTestUtils.extractInboundTelegramText({
      update_id: 10,
      message: {
        chat: { id: 999, type: "private" },
        from: { id: 1, is_bot: false },
        text: "hi",
      },
    })).toMatchObject({
      updateId: 10,
      chatId: "999",
      chatType: "private",
      fromIsBot: false,
      text: "hi",
    })

    expect(__telegramTestUtils.extractInboundTelegramText({
      update_id: 11,
      message: {
        chat: { id: 999, type: "private" },
      },
    })).toBeNull()
  })

  it("maps Orion user ids to telegram chat ids and back", () => {
    const userId = __telegramTestUtils.toTelegramChannelUserId("12345")
    expect(userId).toBe("telegram:12345")
    expect(__telegramTestUtils.toTelegramChatId(userId)).toBe("12345")
    expect(__telegramTestUtils.toTelegramChatId("12345")).toBe("12345")
  })

  it("strips telegram html fallback tags safely", () => {
    expect(__telegramTestUtils.stripTelegramHtml("<b>bold</b> &lt;tag&gt; &amp; ok")).toBe("bold <tag> & ok")
  })
})
