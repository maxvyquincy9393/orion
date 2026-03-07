import { describe, expect, it } from "vitest"

import { __whatsAppTestUtils } from "../whatsapp.js"

describe("whatsapp channel helpers", () => {
  it("parses and normalizes WhatsApp allowlist ids", () => {
    const ids = __whatsAppTestUtils.parseAllowedWhatsAppIds(" +62 8123 , whatsapp:628456\n628789@s.whatsapp.net ")

    expect(Array.from(ids)).toEqual(["628123", "628456", "628789"])
  })

  it("parses cloud webhook verification query", () => {
    const parsed = __whatsAppTestUtils.parseWhatsAppWebhookVerifyQuery({
      "hub.mode": "subscribe",
      "hub.verify_token": "secret",
      "hub.challenge": "12345",
    })

    expect(parsed).toEqual({
      mode: "subscribe",
      verifyToken: "secret",
      challenge: "12345",
    })
  })

  it("extracts inbound cloud messages and ignores unsupported payloads", () => {
    const messages = __whatsAppTestUtils.extractInboundWhatsAppCloudMessages({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.1",
                    from: "628111",
                    type: "text",
                    text: { body: "hello" },
                  },
                  {
                    id: "wamid.2",
                    from: "628111",
                    type: "interactive",
                    interactive: {
                      button_reply: { title: "Yes" },
                    },
                  },
                ],
                statuses: [{ id: "ignored" }],
              },
            },
          ],
        },
      ],
    })

    expect(messages).toEqual([
      { messageId: "wamid.1", waId: "628111", text: "hello" },
      { messageId: "wamid.2", waId: "628111", text: "Yes" },
    ])
  })

  it("normalizes recipient ids and slash/bang commands", () => {
    expect(__whatsAppTestUtils.toWhatsAppCloudRecipient("whatsapp:+62 811")).toBe("62811")
    expect(__whatsAppTestUtils.toBaileysJid("whatsapp:62811")).toBe("62811@s.whatsapp.net")
    expect(__whatsAppTestUtils.normalizeWhatsAppCommand("/help")).toBe("help")
    expect(__whatsAppTestUtils.normalizeWhatsAppCommand("!ping")).toBe("ping")
    expect(__whatsAppTestUtils.normalizeWhatsAppCommand("hello")).toBeNull()
  })

  it("builds Baileys socket config preview with raw auth state (not nested wrapper)", () => {
    const state = { creds: { me: null }, keys: {} }
    const preview = __whatsAppTestUtils.buildBaileysSocketConfigPreview(state)

    expect(preview.auth).toBe(state)
    expect(preview).toMatchObject({ printQRInTerminal: false })
    expect(preview).not.toHaveProperty("auth.state")
  })
})
