import { describe, it, expect, vi } from "vitest"

vi.mock("../../config.js", () => ({
  default: {
    OWNER_ID: "",
    OPENAI_API_KEY: "sk-real-key-12345678",
    GROQ_API_KEY: "gsk_realkey90abcdef12",
    ANTHROPIC_API_KEY: "",
    DATABASE_URL: "sqlite:./dev.db",
    PLACEHOLDER_SECRET: "changeme",
    SHORT_TOKEN: "abc",
  },
}))

vi.mock("../../logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import { isSecretKey, scanForLeakedSecrets, auditConfig } from "../config-audit.js"

describe("isSecretKey", () => {
  it("detects API_KEY variants", () => {
    expect(isSecretKey("OPENAI_API_KEY")).toBe(true)
    expect(isSecretKey("GROQ_API_KEY")).toBe(true)
    expect(isSecretKey("api_key")).toBe(true)
  })

  it("detects secret / token / password", () => {
    expect(isSecretKey("CLIENT_SECRET")).toBe(true)
    expect(isSecretKey("ACCESS_TOKEN")).toBe(true)
    expect(isSecretKey("DB_PASSWORD")).toBe(true)
  })

  it("rejects non-secret keys", () => {
    expect(isSecretKey("DATABASE_URL")).toBe(false)
    expect(isSecretKey("OWNER_ID")).toBe(false)
    expect(isSecretKey("PORT")).toBe(false)
  })
})

describe("scanForLeakedSecrets", () => {
  it("finds leaked secret values in text", () => {
    const leaks = scanForLeakedSecrets("Found key: sk-real-key-12345678 in log")

    expect(leaks).toContain("OPENAI_API_KEY")
  })

  it("ignores short secrets (< 8 chars)", () => {
    const leaks = scanForLeakedSecrets("abc is in text")

    expect(leaks).not.toContain("SHORT_TOKEN")
  })

  it("returns empty when no leaks detected", () => {
    const leaks = scanForLeakedSecrets("this is a clean log output")

    expect(leaks).toEqual([])
  })
})

describe("auditConfig", () => {
  it("flags missing recommended keys as warnings", () => {
    const report = auditConfig()
    const ownerWarning = report.findings.find((f) => f.key === "OWNER_ID")

    expect(ownerWarning).toBeDefined()
    expect(ownerWarning?.severity).toBe("warning")
  })

  it("flags placeholder secrets as errors", () => {
    const report = auditConfig()
    const placeholder = report.findings.find((f) => f.key === "PLACEHOLDER_SECRET")

    expect(placeholder).toBeDefined()
    expect(placeholder?.severity).toBe("error")
  })

  it("fails the audit when there are error-level findings", () => {
    const report = auditConfig()

    expect(report.passed).toBe(false)
  })
})
