import { describe, expect, it } from "vitest"

import { __onboardTestUtils } from "../onboard.js"

describe("onboard cli helpers", () => {
  it("parses quickstart args with channel/provider/write mode", () => {
    const parsed = __onboardTestUtils.parseOnboardArgs([
      "--channel=telegram",
      "--provider",
      "groq",
      "--print-only",
      "--yes",
    ])

    expect(parsed).toMatchObject({
      flow: "quickstart",
      channel: "telegram",
      provider: "groq",
      writeMode: "print",
      yes: true,
    })
  })

  it("merges env content while preserving comments and appending missing keys", () => {
    const merged = __onboardTestUtils.mergeEnvContent(
      [
        "# comment",
        "GROQ_API_KEY=",
        "TELEGRAM_BOT_TOKEN=old",
        "",
      ].join("\n"),
      {
        GROQ_API_KEY: "gsk_test_123",
        TELEGRAM_CHAT_ID: "123456",
      },
    )

    expect(merged).toContain("# comment")
    expect(merged).toContain("GROQ_API_KEY=gsk_test_123")
    expect(merged).toContain("TELEGRAM_BOT_TOKEN=old")
    expect(merged).toContain("TELEGRAM_CHAT_ID=123456")
    expect(merged).toContain("# Added by `pnpm onboard` quickstart wizard")
  })

  it("builds provider-specific next steps for Telegram", () => {
    const steps = __onboardTestUtils.buildNextSteps({
      channel: "telegram",
      provider: "groq",
      updates: { TELEGRAM_BOT_TOKEN: "abc" },
    })

    expect(steps.join("\n")).toContain("/start")
    expect(steps.join("\n")).toContain("docs/channels/telegram.md")
    expect(steps.join("\n")).toContain("docs/platform/onboarding.md")
  })

  it("builds WhatsApp Cloud API next steps and docs reference", () => {
    const steps = __onboardTestUtils.buildNextSteps({
      channel: "whatsapp",
      provider: "openrouter",
      updates: {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "cloud",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "verify",
      },
    })

    expect(steps.join("\n")).toContain("/webhooks/whatsapp")
    expect(steps.join("\n")).toContain("WHATSAPP_CLOUD_VERIFY_TOKEN")
    expect(steps.join("\n")).toContain("docs/channels/whatsapp.md")
  })
})
