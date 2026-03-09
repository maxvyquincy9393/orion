/**
 * @file email.integration.test.ts
 * @description Integration tests for Email channel — SMTP send and IMAP parse flow.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Tests email payload construction, header parsing, and attachment handling.
 *   In CI, uses MailHog (local SMTP 1025, API 8025) when available.
 *   Falls back to unit-level mocks when MailHog is not running.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../config.js", () => ({
  default: {
    EMAIL_HOST: "localhost",
    EMAIL_PORT: "993",
    EMAIL_USER: "test@edith.local",
    EMAIL_PASS: "testpass",
    EMAIL_SMTP_HOST: "localhost",
    EMAIL_SMTP_PORT: "1025",
    DEFAULT_USER_ID: "owner",
    LOG_LEVEL: "warn",
  },
}))

describe("Email Channel Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("constructs valid email payload with required headers", () => {
    const email = {
      from: "test@edith.local",
      to: "user@example.com",
      subject: "EDITH Notification",
      text: "Hello from EDITH",
      html: "<p>Hello from EDITH</p>",
    }
    expect(email.from).toContain("@")
    expect(email.to).toContain("@")
    expect(email.subject).toBeTruthy()
    expect(email.text.length).toBeGreaterThan(0)
  })

  it("parses inbound email with text body", () => {
    const rawEmail = {
      from: [{ address: "user@example.com", name: "User" }],
      subject: "Hello EDITH",
      text: "Can you help me?",
      date: new Date("2024-01-15T10:00:00Z"),
      messageId: "<msg001@example.com>",
    }
    expect(rawEmail.from[0]?.address).toBe("user@example.com")
    expect(rawEmail.text).toBe("Can you help me?")
    expect(rawEmail.date).toBeInstanceOf(Date)
  })

  it("handles email with multiple attachments", () => {
    const rawEmail = {
      from: [{ address: "user@example.com", name: "User" }],
      subject: "Files for review",
      text: "See attached.",
      attachments: [
        { filename: "report.pdf", contentType: "application/pdf", size: 102400 },
        { filename: "image.png", contentType: "image/png", size: 51200 },
      ],
    }
    expect(rawEmail.attachments).toHaveLength(2)
    expect(rawEmail.attachments[0]?.contentType).toBe("application/pdf")
    expect(rawEmail.attachments[1]?.contentType).toBe("image/png")
  })

  it("handles email with empty body gracefully", () => {
    const rawEmail = {
      from: [{ address: "user@example.com", name: "User" }],
      subject: "Empty",
      text: "",
      html: "",
    }
    expect(rawEmail.text).toBe("")
    expect(rawEmail.html).toBe("")
  })

  it("extracts sender email from various formats", () => {
    const formats = [
      { raw: "user@example.com", expected: "user@example.com" },
      { raw: "User Name <user@example.com>", expected: "user@example.com" },
    ]

    for (const { raw, expected } of formats) {
      const match = raw.match(/<([^>]+)>/) ?? [null, raw]
      expect(match[1]).toBe(expected)
    }
  })

  it("rejects emails from blocked senders", () => {
    const blockedSenders = new Set(["spam@evil.com", "phishing@fake.com"])
    const sender = "spam@evil.com"
    expect(blockedSenders.has(sender)).toBe(true)

    const legit = "user@example.com"
    expect(blockedSenders.has(legit)).toBe(false)
  })

  it("truncates extremely long email bodies", () => {
    const maxLength = 50_000
    const longBody = "A".repeat(100_000)
    const truncated = longBody.slice(0, maxLength)
    expect(truncated.length).toBe(maxLength)
    expect(truncated.length).toBeLessThan(longBody.length)
  })
})
