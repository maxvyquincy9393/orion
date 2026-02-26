import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  buildDiscordSelfTestChecks,
  isProfileEnvLikelyConfigured,
  buildTelegramSelfTestChecks,
  buildWebchatSelfTestChecks,
  buildWhatsAppSelfTestChecks,
  getPnpmCommand,
  getNamedProfileDir,
  isLikelyProfileName,
  normalizeChannelName,
  normalizeWhatsAppLoginMode,
  parseChannelsArgs,
  parseSelfTestArgs,
  parseOrionCliArgs,
  parseEnvContentLoose,
  findOrionRepoUpwards,
  getProfilePaths,
  isOrionRepoDir,
  resolveProfileSelector,
  shouldUseShellForCommand,
  shouldInvokeCli,
} from "../../../bin/orion.js"

describe("global orion CLI helpers", () => {
  it("parses repo override and positionals", () => {
    const parsed = parseOrionCliArgs([
      "--repo",
      "C:\\repo\\orion-ts",
      "--profile",
      "C:\\Users\\me\\.orion\\profiles\\test",
      "wa",
      "scan",
    ])

    expect(parsed).toEqual({
      repoOverride: "C:\\repo\\orion-ts",
      profileOverride: "C:\\Users\\me\\.orion\\profiles\\test",
      dev: false,
      positionals: ["wa", "scan"],
      help: false,
    })
  })

  it("parses --dev global flag", () => {
    const parsed = parseOrionCliArgs(["--dev", "dashboard"])
    expect(parsed).toMatchObject({
      dev: true,
      positionals: ["dashboard"],
    })
  })

  it("detects help flag early", () => {
    expect(parseOrionCliArgs(["--help"])).toEqual({
      repoOverride: null,
      profileOverride: null,
      dev: false,
      positionals: [],
      help: true,
    })
  })

  it("matches direct execution paths case-insensitively on Windows", () => {
    const ok = shouldInvokeCli(
      "file:///C:/Users/test/AppData/Roaming/npm/node_modules/orion/bin/orion.js",
      "c:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\orion\\bin\\orion.js",
      "win32",
    )

    expect(ok).toBe(true)
  })

  it("uses pnpm.cmd on Windows and pnpm elsewhere", () => {
    expect(getPnpmCommand("win32")).toBe("pnpm.cmd")
    expect(getPnpmCommand("linux")).toBe("pnpm")
  })

  it("uses shell only for Windows cmd/bat wrappers", () => {
    expect(shouldUseShellForCommand("pnpm.cmd", "win32")).toBe(true)
    expect(shouldUseShellForCommand("build.BAT", "win32")).toBe(true)
    expect(shouldUseShellForCommand("node", "win32")).toBe(false)
    expect(shouldUseShellForCommand("pnpm", "linux")).toBe(false)
  })

  it("builds profile-relative env/workspace/state paths", () => {
    const paths = getProfilePaths("C:\\Users\\me\\.orion\\profiles\\default")
    expect(paths.envPath).toContain(`${path.sep}.env`)
    expect(paths.workspaceDir).toContain(`${path.sep}workspace`)
    expect(paths.stateDir).toContain(`${path.sep}.orion`)
  })

  it("maps profile names to ~/.orion/profiles/<name>", () => {
    expect(isLikelyProfileName("work")).toBe(true)
    expect(isLikelyProfileName("C:\\Users\\me\\.orion\\profiles\\work")).toBe(false)
    expect(isLikelyProfileName("./local-profile")).toBe(false)

    const resolved = resolveProfileSelector("work", "C:\\repo", "C:\\Users\\me")
    expect(resolved).toBe(path.join("C:\\Users\\me", ".orion", "profiles", "work"))
    expect(getNamedProfileDir("work")).toContain(`${path.sep}.orion${path.sep}profiles${path.sep}work`)
  })

  it("supports explicit profile paths and tilde expansion", () => {
    expect(resolveProfileSelector("./profiles/test", "C:\\repo", "C:\\Users\\me")).toBe(
      path.resolve("C:\\repo", "./profiles/test"),
    )
    expect(resolveProfileSelector("~/custom-profile", "C:\\repo", "C:\\Users\\me")).toBe(
      path.join("C:\\Users\\me", "custom-profile"),
    )
  })

  it("parses channels namespace args and strips channel/mode flags", () => {
    const parsed = parseChannelsArgs([
      "login",
      "--channel",
      "whatsapp",
      "--mode",
      "qr",
      "--non-interactive",
      "--provider",
      "groq",
    ])

    expect(parsed).toEqual({
      channel: "whatsapp",
      mode: "qr",
      help: false,
      json: false,
      positionals: ["login", "--non-interactive", "--provider", "groq"],
    })
  })

  it("parses channels status --json without swallowing other args", () => {
    const parsed = parseChannelsArgs(["status", "--channel", "telegram", "--json", "--verbose"])
    expect(parsed).toEqual({
      channel: "telegram",
      mode: null,
      help: false,
      json: true,
      positionals: ["status", "--verbose"],
    })
  })

  it("normalizes supported channel names and whatsapp login modes", () => {
    expect(normalizeChannelName("WhatsApp")).toBe("whatsapp")
    expect(normalizeChannelName("unknown")).toBe(null)

    expect(normalizeWhatsAppLoginMode(undefined as any)).toBe("scan")
    expect(normalizeWhatsAppLoginMode("baileys")).toBe("scan")
    expect(normalizeWhatsAppLoginMode("qr")).toBe("scan")
    expect(normalizeWhatsAppLoginMode("cloud")).toBe("cloud")
    expect(normalizeWhatsAppLoginMode("invalid")).toBe(null)
  })

  it("parses self-test flags without swallowing extra args", () => {
    expect(parseSelfTestArgs(["--fix", "--migrate", "--json", "--help", "--foo"])).toEqual({
      fix: true,
      migrate: true,
      help: true,
      json: true,
      positionals: ["--foo"],
    })
  })

  it("parses dotenv-like content for profile env checks", () => {
    const parsed = parseEnvContentLoose([
      "# comment",
      "WHATSAPP_ENABLED=true",
      "WHATSAPP_MODE=baileys",
      "DATABASE_URL=\"file:C:/Users/test profile/orion.db\"",
      "",
    ].join("\n"))

    expect(parsed).toMatchObject({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "baileys",
      DATABASE_URL: "file:C:/Users/test profile/orion.db",
    })
  })

  it("reports WhatsApp Cloud config errors when required keys are missing", () => {
    const checks = buildWhatsAppSelfTestChecks(
      {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "cloud",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "123",
      },
      getProfilePaths("C:\\Users\\me\\.orion\\profiles\\default"),
    )

    expect(checks.some((check) => check.level === "error" && /WHATSAPP_CLOUD_ACCESS_TOKEN/.test(check.detail))).toBe(true)
  })

  it("reports WhatsApp QR scan mode as ready without Cloud API requirements", () => {
    const checks = buildWhatsAppSelfTestChecks(
      {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "baileys",
      },
      getProfilePaths("C:\\Users\\me\\.orion\\profiles\\default"),
    )

    expect(checks.find((check) => check.label === "WhatsApp Mode")?.detail).toContain("QR Scan")
    expect(checks.some((check) => check.label === "WhatsApp Cloud Config")).toBe(false)
  })

  it("reports Telegram and Discord defaults as DM/private-safe warnings", () => {
    const telegram = buildTelegramSelfTestChecks({ TELEGRAM_BOT_TOKEN: "token" })
    const discord = buildDiscordSelfTestChecks({ DISCORD_BOT_TOKEN: "token" })

    expect(telegram.find((check) => check.label === "Telegram Allowlist")?.level).toBe("warn")
    expect(discord.find((check) => check.label === "Discord Allowlist")?.level).toBe("warn")
  })

  it("reports WebChat URL using configured port fallback", () => {
    const explicit = buildWebchatSelfTestChecks({ WEBCHAT_PORT: "9090" })
    const fallback = buildWebchatSelfTestChecks({ WEBCHAT_PORT: "invalid" })

    expect(explicit[0]?.detail).toContain("127.0.0.1:9090")
    expect(fallback[0]?.detail).toContain("127.0.0.1:8080")
  })

  it("detects whether a profile env looks configured for first-run smart entrypoint", () => {
    expect(isProfileEnvLikelyConfigured({})).toBe(false)
    expect(isProfileEnvLikelyConfigured({ GROQ_API_KEY: "" })).toBe(false)
    expect(isProfileEnvLikelyConfigured({ OLLAMA_BASE_URL: "http://127.0.0.1:11434" })).toBe(false)
    expect(isProfileEnvLikelyConfigured({ GROQ_API_KEY: "gsk_test" })).toBe(true)
    expect(isProfileEnvLikelyConfigured({ WHATSAPP_ENABLED: "true" })).toBe(true)
    expect(isProfileEnvLikelyConfigured({ TELEGRAM_BOT_TOKEN: "123:abc" })).toBe(true)
    expect(isProfileEnvLikelyConfigured({ DISCORD_BOT_TOKEN: "discord-token" })).toBe(true)
  })

  it("validates Orion repo by package name", async () => {
    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith(`${path.sep}package.json`)) {
          return JSON.stringify({ name: "orion" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    await expect(isOrionRepoDir("C:\\repo\\orion-ts", fsMock as any)).resolves.toBe(true)
  })

  it("finds nested orion-ts repo while walking upward", async () => {
    const validDirs = new Set([
      path.resolve("C:\\work\\mono\\orion-ts"),
    ])

    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        const dir = path.dirname(filePath)
        if (path.basename(filePath) === "package.json" && validDirs.has(dir)) {
          return JSON.stringify({ name: "orion" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    const found = await findOrionRepoUpwards("C:\\work\\mono\\apps\\demo", fsMock as any)
    expect(found).toBe(path.resolve("C:\\work\\mono\\orion-ts"))
  })
})
