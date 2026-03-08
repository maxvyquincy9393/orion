/**
 * @file credentials-merge.test.ts
 * @description Tests for mergeEdithJsonCredentials() — verifies that edith.json
 * credentials are merged into the runtime config with correct priority:
 * edith.json > .env / system env.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}))

// We control what loadEDITHConfig returns
const mockLoadEDITHConfig = vi.fn()

vi.mock("../../config/edith-config.js", () => ({
  loadEDITHConfig: () => mockLoadEDITHConfig(),
}))

describe("mergeEdithJsonCredentials", () => {
  // We import config fresh by re-importing after setting up mocks
  // Because config.ts is a module singleton, we test via the function's side-effects on config

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("overlays non-empty credential from edith.json onto config", async () => {
    mockLoadEDITHConfig.mockResolvedValue({
      credentials: {
        GROQ_API_KEY: "gsk_from_edith_json",
        ANTHROPIC_API_KEY: "",
      },
      features: {}
    })

    // Import config and the merge function
    const configModule = await import("../../config.js")
    const { mergeEdithJsonCredentials, config } = configModule

    // Simulate .env had a different (or empty) value
    const originalGroq = config.GROQ_API_KEY
    config.GROQ_API_KEY = "gsk_old_env"

    await mergeEdithJsonCredentials()

    expect(config.GROQ_API_KEY).toBe("gsk_from_edith_json")

    // Restore
    config.GROQ_API_KEY = originalGroq
  })

  it("does NOT override a credential when edith.json value is empty", async () => {
    mockLoadEDITHConfig.mockResolvedValue({
      credentials: {
        GROQ_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
      features: {}
    })

    const configModule = await import("../../config.js")
    const { mergeEdithJsonCredentials, config } = configModule

    config.GROQ_API_KEY = "gsk_from_env"

    await mergeEdithJsonCredentials()

    // Empty edith.json value must not override
    expect(config.GROQ_API_KEY).toBe("gsk_from_env")
  })

  it("overrides VOICE_ENABLED from features.voice", async () => {
    mockLoadEDITHConfig.mockResolvedValue({
      credentials: {},
      features: { voice: true, knowledgeBase: false, computerUse: false }
    })

    const configModule = await import("../../config.js")
    const { mergeEdithJsonCredentials, config } = configModule

    config.VOICE_ENABLED = false

    await mergeEdithJsonCredentials()

    expect(config.VOICE_ENABLED).toBe(true)
  })

  it("overrides KNOWLEDGE_BASE_ENABLED from features.knowledgeBase", async () => {
    mockLoadEDITHConfig.mockResolvedValue({
      credentials: {},
      features: { voice: false, knowledgeBase: true, computerUse: true }
    })

    const configModule = await import("../../config.js")
    const { mergeEdithJsonCredentials, config } = configModule

    config.KNOWLEDGE_BASE_ENABLED = false

    await mergeEdithJsonCredentials()

    expect(config.KNOWLEDGE_BASE_ENABLED).toBe(true)
  })

  it("silently ignores errors from loadEDITHConfig", async () => {
    mockLoadEDITHConfig.mockRejectedValue(new Error("file not found"))

    const configModule = await import("../../config.js")
    const { mergeEdithJsonCredentials, config } = configModule

    config.GROQ_API_KEY = "gsk_safe"

    // Should not throw
    await expect(mergeEdithJsonCredentials()).resolves.toBeUndefined()

    // Original value untouched
    expect(config.GROQ_API_KEY).toBe("gsk_safe")
  })
})
