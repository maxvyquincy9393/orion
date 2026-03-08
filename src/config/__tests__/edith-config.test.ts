/**
 * @file edith-config.test.ts
 * @description Tests for CredentialsSchema, FeaturesSchema defaults, and the
 * saveEDITHConfig / getCredential helpers added in the config-free setup plan.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// We need to intercept fs/promises before importing the module
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}))

import fs from "node:fs/promises"
import {
  loadEDITHConfig,
  resetEDITHConfigCache,
  saveEDITHConfig,
  getCredential,
  type EDITHConfig,
} from "../edith-config.js"

const mockFs = fs as unknown as { readFile: ReturnType<typeof vi.fn>; writeFile: ReturnType<typeof vi.fn> }

describe("CredentialsSchema defaults", () => {
  beforeEach(() => {
    resetEDITHConfigCache()
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
  })

  it("defaults all credential fields to empty string", async () => {
    const cfg = await loadEDITHConfig()
    const creds = cfg.credentials
    expect(creds.GROQ_API_KEY).toBe("")
    expect(creds.ANTHROPIC_API_KEY).toBe("")
    expect(creds.OPENAI_API_KEY).toBe("")
    expect(creds.GEMINI_API_KEY).toBe("")
    expect(creds.OPENROUTER_API_KEY).toBe("")
    expect(creds.OLLAMA_BASE_URL).toBe("")
    expect(creds.TELEGRAM_BOT_TOKEN).toBe("")
    expect(creds.TELEGRAM_CHAT_ID).toBe("")
    expect(creds.DISCORD_BOT_TOKEN).toBe("")
    expect(creds.DISCORD_CHANNEL_ID).toBe("")
    expect(creds.WHATSAPP_CLOUD_ACCESS_TOKEN).toBe("")
    expect(creds.NOTION_API_KEY).toBe("")
  })

  it("parses credential values from edith.json", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      credentials: { GROQ_API_KEY: "gsk_test123", TELEGRAM_BOT_TOKEN: "999:abc" }
    }))
    const cfg = await loadEDITHConfig()
    expect(cfg.credentials.GROQ_API_KEY).toBe("gsk_test123")
    expect(cfg.credentials.TELEGRAM_BOT_TOKEN).toBe("999:abc")
    // Unset keys still default to empty
    expect(cfg.credentials.OPENAI_API_KEY).toBe("")
  })
})

describe("FeaturesSchema defaults", () => {
  beforeEach(() => {
    resetEDITHConfigCache()
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
  })

  it("defaults voice to false", async () => {
    const cfg = await loadEDITHConfig()
    expect(cfg.features.voice).toBe(false)
  })

  it("defaults computerUse to true", async () => {
    const cfg = await loadEDITHConfig()
    expect(cfg.features.computerUse).toBe(true)
  })

  it("defaults knowledgeBase to false", async () => {
    const cfg = await loadEDITHConfig()
    expect(cfg.features.knowledgeBase).toBe(false)
  })

  it("parses feature flags from edith.json", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      features: { voice: true, knowledgeBase: true, email: true }
    }))
    const cfg = await loadEDITHConfig()
    expect(cfg.features.voice).toBe(true)
    expect(cfg.features.knowledgeBase).toBe(true)
    expect(cfg.features.email).toBe(true)
    expect(cfg.features.calendar).toBe(false) // still default
  })
})

describe("saveEDITHConfig", () => {
  beforeEach(() => {
    resetEDITHConfigCache()
    vi.clearAllMocks()
  })

  it("writes merged JSON to edith.json", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ identity: { name: "EDITH" } }))
    await saveEDITHConfig({ credentials: { GROQ_API_KEY: "gsk_new" } } as Partial<EDITHConfig>)
    expect(mockFs.writeFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string) as Record<string, unknown>
    expect((written.credentials as Record<string, unknown>).GROQ_API_KEY).toBe("gsk_new")
    // Existing sections should be preserved
    expect((written.identity as Record<string, unknown>).name).toBe("EDITH")
  })

  it("invalidates cache after save", async () => {
    mockFs.readFile.mockResolvedValue("{}")
    await saveEDITHConfig({ features: { voice: true } } as Partial<EDITHConfig>)
    // After save, cache is null — next loadEDITHConfig will re-read
    mockFs.readFile.mockResolvedValue(JSON.stringify({ features: { voice: true } }))
    const cfg = await loadEDITHConfig()
    expect(cfg.features.voice).toBe(true)
  })
})

describe("getCredential", () => {
  beforeEach(() => {
    resetEDITHConfigCache()
    vi.clearAllMocks()
  })

  it("returns empty string when config not yet loaded", () => {
    expect(getCredential("GROQ_API_KEY")).toBe("")
  })

  it("returns credential value after config is loaded", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      credentials: { ANTHROPIC_API_KEY: "sk-ant-test" }
    }))
    await loadEDITHConfig()
    expect(getCredential("ANTHROPIC_API_KEY")).toBe("sk-ant-test")
  })
})
