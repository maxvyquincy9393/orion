import { describe, expect, it } from "vitest"

import { __onboardTestUtils } from "../onboard.js"

describe("onboard cli helpers", () => {
  it("parses quickstart args with channel/provider/write mode", () => {
    const parsed = __onboardTestUtils.parseOnboardArgs([
      "--channel=telegram",
      "--provider",
      "groq",
      "--whatsapp-mode=scan",
      "--print-only",
      "--non-interactive",
      "--wizard",
    ])

    expect(parsed).toMatchObject({
      flow: "quickstart",
      channel: "telegram",
      provider: "groq",
      whatsappMode: "scan",
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

  it("builds WhatsApp QR scan next steps (EDITH-style quick test)", () => {
    const steps = __onboardTestUtils.buildNextSteps({
      channel: "whatsapp",
      provider: "groq",
      updates: {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "baileys",
      },
    })

    const text = steps.join("\n")
    expect(text).toContain("QR code")
    expect(text).toContain("Linked Devices")
    expect(text).toContain("WHATSAPP_MODE=baileys")
  })

  it("uses global `edith` command hints when wrapper env is present", () => {
    const commands = __onboardTestUtils.defaultNextStepCommands({
      EDITH_ENV_FILE: "C:\\Users\\test\\.edith\\profiles\\default\\.env",
    } as any)

    const steps = __onboardTestUtils.buildNextSteps(
      {
        channel: "whatsapp",
        provider: "groq",
        updates: {
          WHATSAPP_ENABLED: "true",
          WHATSAPP_MODE: "baileys",
        },
      },
      commands,
    )

    const text = steps.join("\n")
    expect(text).toContain("`edith doctor`")
    expect(text).toContain("`edith all`")
    expect(text).not.toContain("`pnpm all`")
  })
})
