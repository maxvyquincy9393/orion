import path from "node:path"
import net from "node:net"

import { describe, expect, it, vi } from "vitest"

import {
  buildDiscordSelfTestChecks,
  isProfileEnvLikelyConfigured,
  parseDashboardArgs,
  buildTelegramSelfTestChecks,
  buildWebchatSelfTestChecks,
  buildWhatsAppSelfTestChecks,
  inspectWhatsAppBaileysAuthState,
  getPnpmCommand,
  getNamedProfileDir,
  isLikelyProfileName,
  normalizeChannelName,
  normalizeWhatsAppLoginMode,
  parseChannelsArgs,
  parseSelfTestArgs,
  parseEdithCliArgs,
  parseEnvContentLoose,
  findEdithRepoUpwards,
  getProfilePaths,
  getChannelLogHints,
  isEdithRepoDir,
  lineMatchesChannelLogFilter,
  probeLocalTcpPort,
  resolveProfileSelector,
  summarizeDiscordBotToken,
  summarizeTelegramBotToken,
  summarizeWhatsAppBaileysCreds,
  shouldUseShellForCommand,
  shouldInvokeCli,
} from "../../../bin/edith.js"

describe("global edith CLI helpers", () => {
  it("parses repo override and positionals", () => {
    const parsed = parseEdithCliArgs([
      "--repo",
      "C:\\repo\\EDITH-ts",
      "--profile",
      "C:\\Users\\me\\.edith\\profiles\\test",
      "wa",
      "scan",
    ])

    expect(parsed).toEqual({
      repoOverride: "C:\\repo\\EDITH-ts",
      profileOverride: "C:\\Users\\me\\.edith\\profiles\\test",
      dev: false,
      positionals: ["wa", "scan"],
      help: false,
    })
  })

  it("parses --dev global flag", () => {
    const parsed = parseEdithCliArgs(["--dev", "dashboard"])
    expect(parsed).toMatchObject({
      dev: true,
      positionals: ["dashboard"],
    })
  })

  it("detects help flag early", () => {
    expect(parseEdithCliArgs(["--help"])).toEqual({
      repoOverride: null,
      profileOverride: null,
      dev: false,
      positionals: [],
      help: true,
    })
  })

  it("passes --help through to subcommands when command is already present", () => {
    expect(parseEdithCliArgs(["dashboard", "--help"])).toEqual({
      repoOverride: null,
      profileOverride: null,
      dev: false,
      positionals: ["dashboard", "--help"],
      help: false,
    })
  })

  it("accepts global repo/profile flags after subcommands (EDITH-style muscle memory)", () => {
    const parsed = parseEdithCliArgs([
      "channels",
      "status",
      "--channel",
      "whatsapp",
      "--repo",
      ".",
      "--profile",
      ".tmp",
    ])

    expect(parsed).toEqual({
      repoOverride: ".",
      profileOverride: ".tmp",
      dev: false,
      positionals: ["channels", "status", "--channel", "whatsapp"],
      help: false,
    })
  })

  it("matches direct execution paths case-insensitively on Windows", () => {
    const ok = shouldInvokeCli(
      "file:///C:/Users/test/AppData/Roaming/npm/node_modules/edith/bin/edith.js",
      "c:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\edith\\bin\\edith.js",
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
    const paths = getProfilePaths("C:\\Users\\me\\.edith\\profiles\\default")
    expect(paths.envPath).toContain(`${path.sep}.env`)
    expect(paths.workspaceDir).toContain(`${path.sep}workspace`)
    expect(paths.stateDir).toContain(`${path.sep}.edith`)
  })

  it("maps profile names to ~/.edith/profiles/<name>", () => {
    expect(isLikelyProfileName("work")).toBe(true)
    expect(isLikelyProfileName("C:\\Users\\me\\.edith\\profiles\\work")).toBe(false)
    expect(isLikelyProfileName("./local-profile")).toBe(false)

    const resolved = resolveProfileSelector("work", "C:\\repo", "C:\\Users\\me")
    expect(resolved).toBe(path.join("C:\\Users\\me", ".edith", "profiles", "work"))
    expect(getNamedProfileDir("work")).toContain(`${path.sep}.edith${path.sep}profiles${path.sep}work`)
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

  it("parses dashboard flags and preserves extra args", () => {
    expect(parseDashboardArgs(["--open", "--foo"])).toEqual({
      open: true,
      help: false,
      positionals: ["--foo"],
    })
    expect(parseDashboardArgs(["--open", "--no-open"])).toEqual({
      open: false,
      help: false,
      positionals: [],
    })
    expect(parseDashboardArgs(["--help"])).toEqual({
      open: false,
      help: true,
      positionals: [],
    })
  })

  it("parses dotenv-like content for profile env checks", () => {
    const parsed = parseEnvContentLoose([
      "# comment",
      "WHATSAPP_ENABLED=true",
      "WHATSAPP_MODE=baileys",
      "DATABASE_URL=\"file:C:/Users/test profile/edith.db\"",
      "",
    ].join("\n"))

    expect(parsed).toMatchObject({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "baileys",
      DATABASE_URL: "file:C:/Users/test profile/edith.db",
    })
  })

  it("parses dotenv content with UTF-8 BOM prefix (Windows Set-Content)", () => {
    const parsed = parseEnvContentLoose("\uFEFFWHATSAPP_ENABLED=true\nWHATSAPP_MODE=baileys\n")
    expect(parsed).toMatchObject({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "baileys",
    })
  })

  it("reports WhatsApp Cloud config errors when required keys are missing", () => {
    const checks = buildWhatsAppSelfTestChecks(
      {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "cloud",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "123",
      },
      getProfilePaths("C:\\Users\\me\\.edith\\profiles\\default"),
    )

    expect(checks.some((check) => check.level === "error" && /WHATSAPP_CLOUD_ACCESS_TOKEN/.test(check.detail))).toBe(true)
  })

  it("reports WhatsApp QR scan mode as ready without Cloud API requirements", () => {
    const checks = buildWhatsAppSelfTestChecks(
      {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_MODE: "baileys",
      },
      getProfilePaths("C:\\Users\\me\\.edith\\profiles\\default"),
    )

    expect(checks.find((check) => check.label === "WhatsApp Mode")?.detail).toContain("QR Scan")
    expect(checks.some((check) => check.label === "WhatsApp Cloud Config")).toBe(false)
  })

  it("summarizes paired WhatsApp Baileys creds without exposing raw jid", () => {
    const summary = summarizeWhatsAppBaileysCreds({
      me: { id: "628123456789:12@s.whatsapp.net" },
      registered: true,
      advSecretKey: "secret",
      registrationId: 123,
    })

    expect(summary).toMatchObject({
      parseable: true,
      paired: true,
      registered: true,
      hasIdentityMaterial: true,
    })
    expect(summary.maskedJid).toContain("@s.whatsapp.net")
    expect(summary.maskedJid).not.toContain("628123456789")
  })

  it("inspects WhatsApp auth dir runtime state from creds.json", async () => {
    const authState = await inspectWhatsAppBaileysAuthState(
      "C:\\Users\\me\\.edith\\profiles\\default\\.edith\\whatsapp-auth",
      {
        readdir: vi.fn(async () => ["creds.json", "session-foo.json"]),
        readFile: vi.fn(async () => JSON.stringify({
          me: { id: "628123456789:12@s.whatsapp.net" },
          registered: true,
          advSecretKey: "secret",
        })),
        stat: vi.fn(async () => ({ mtime: new Date("2026-02-26T16:00:00.000Z") })),
      } as any,
    )

    expect(authState.exists).toBe(true)
    expect(authState.entryCount).toBe(2)
    expect(authState.credsExists).toBe(true)
    expect(authState.creds.paired).toBe(true)
    expect(authState.creds.maskedJid).toContain("@s.whatsapp.net")
    expect(authState.credsMtime).toBe("2026-02-26T16:00:00.000Z")
    expect(authState.parseError).toBeNull()
    expect(authState.readError).toBeNull()
  })

  it("handles missing or malformed WhatsApp auth state without throwing", async () => {
    const missing = await inspectWhatsAppBaileysAuthState(
      "C:\\Users\\me\\.edith\\profiles\\default\\.edith\\whatsapp-auth",
      {
        readdir: vi.fn(async () => {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        }),
        readFile: vi.fn(),
        stat: vi.fn(),
      } as any,
    )
    expect(missing.exists).toBe(false)
    expect(missing.readError).toBeNull()

    const malformed = await inspectWhatsAppBaileysAuthState(
      "C:\\Users\\me\\.edith\\profiles\\default\\.edith\\whatsapp-auth",
      {
        readdir: vi.fn(async () => ["creds.json"]),
        readFile: vi.fn(async () => "{bad json"),
        stat: vi.fn(async () => ({ mtime: new Date("2026-02-26T16:00:00.000Z") })),
      } as any,
    )
    expect(malformed.exists).toBe(true)
    expect(malformed.credsExists).toBe(true)
    expect(malformed.parseError).toBeTruthy()
    expect(malformed.creds.paired).toBe(false)
  })

  it("reports Telegram and Discord defaults as DM/private-safe warnings", () => {
    const telegram = buildTelegramSelfTestChecks({ TELEGRAM_BOT_TOKEN: "token" })
    const discord = buildDiscordSelfTestChecks({ DISCORD_BOT_TOKEN: "token" })

    expect(telegram.find((check) => check.label === "Telegram Allowlist")?.level).toBe("warn")
    expect(discord.find((check) => check.label === "Discord Allowlist")?.level).toBe("warn")
  })

  it("summarizes Telegram and Discord token formats for channel status runtime hints", () => {
    const telegram = summarizeTelegramBotToken("123456789:AAAbbbCCCdddEEEfffGGG_hhhIII-jjj")
    const telegramOdd = summarizeTelegramBotToken("not-a-real-token")
    const discord = summarizeDiscordBotToken("abc.def.ghi_jklmnopqrstuvwxyz0123456789")
    const discordOdd = summarizeDiscordBotToken("short")

    expect(telegram).toMatchObject({ configured: true, formatLikelyValid: true })
    expect(telegram.preview).toBeTruthy()
    expect(telegramOdd).toMatchObject({ configured: true, formatLikelyValid: false })

    expect(discord).toMatchObject({ configured: true, formatLikelyValid: true })
    expect(discord.preview).toBeTruthy()
    expect(discordOdd).toMatchObject({ configured: true, formatLikelyValid: false })
  })

  it("probes local TCP port reachability for WebChat runtime hints", async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    if (!address || typeof address === "string") {
      server.close()
      throw new Error("Expected TCP address info")
    }

    const reachable = await probeLocalTcpPort(address.port, { host: "127.0.0.1", timeoutMs: 500 })
    expect(reachable.reachable).toBe(true)
    expect(reachable.port).toBe(address.port)
    expect(reachable.error).toBeNull()

    await new Promise<void>((resolve) => server.close(() => resolve()))

    const unreachable = await probeLocalTcpPort(address.port, { host: "127.0.0.1", timeoutMs: 200 })
    expect(unreachable.reachable).toBe(false)
    expect(unreachable.port).toBe(address.port)
    expect(unreachable.error).toBeTruthy()
  })

  it("matches channel-specific live logs and preserves fatal lines in filtered mode", () => {
    expect(lineMatchesChannelLogFilter("whatsapp", "[2026-01-01] INFO  [whatsapp-channel] started")).toBe(true)
    expect(lineMatchesChannelLogFilter("whatsapp", "{\"class\":\"baileys\",\"msg\":\"connected to WA\"}")).toBe(true)
    expect(lineMatchesChannelLogFilter("telegram", "[2026-01-01] INFO  [channels.telegram] Telegram disabled")).toBe(true)
    expect(lineMatchesChannelLogFilter("discord", "[2026-01-01] INFO  [channels.discord] Discord disabled")).toBe(true)
    expect(lineMatchesChannelLogFilter("webchat", "[2026-01-01] INFO  [webchat-channel] ready")).toBe(true)

    // Fatal lines should still pass through filtered mode even if they are not tagged to the channel.
    expect(lineMatchesChannelLogFilter("telegram", "ELIFECYCLE Command failed with exit code 1.")).toBe(true)
    expect(lineMatchesChannelLogFilter("discord", "TypeError: boom")).toBe(true)

    // Unrelated healthy lines are filtered out.
    expect(lineMatchesChannelLogFilter("telegram", "[startup] engines loaded")).toBe(false)
    expect(lineMatchesChannelLogFilter("whatsapp", "[channels.telegram] Telegram disabled")).toBe(false)
  })

  it("emits actionable hints for known channel log failure patterns", () => {
    const dbHints = getChannelLogHints(
      "whatsapp",
      "[database] getHistory failed {\"code\":\"P2021\",\"meta\":{\"table\":\"main.Message\"},\"msg\":\"The table does not exist in the current database.\"}",
    )
    expect(dbHints.some((hint) => hint.id === "db-schema-missing")).toBe(true)

    const waHints = getChannelLogHints(
      "whatsapp",
      "[2026-02-26] INFO [whatsapp-channel] WhatsApp (Baileys) disconnected {\"statusCode\":405,\"shouldReconnect\":true}",
    )
    expect(waHints.some((hint) => hint.id === "wa-405")).toBe(true)

    const otherChannel = getChannelLogHints("telegram", "[whatsapp-channel] disconnected {\"statusCode\":405}")
    expect(otherChannel.some((hint) => hint.id === "wa-405")).toBe(false)
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

  it("validates EDITH repo by package name", async () => {
    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith(`${path.sep}package.json`)) {
          return JSON.stringify({ name: "edith" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    await expect(isEdithRepoDir("C:\\repo\\EDITH-ts", fsMock as any)).resolves.toBe(true)
  })

  it("finds nested EDITH-ts repo while walking upward", async () => {
    const validDirs = new Set([
      path.resolve("C:\\work\\mono\\EDITH-ts"),
    ])

    const fsMock = {
      readFile: vi.fn(async (filePath: string) => {
        const dir = path.dirname(filePath)
        if (path.basename(filePath) === "package.json" && validDirs.has(dir)) {
          return JSON.stringify({ name: "edith" })
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    }

    const found = await findEdithRepoUpwards("C:\\work\\mono\\apps\\demo", fsMock as any)
    expect(found).toBe(path.resolve("C:\\work\\mono\\EDITH-ts"))
  })
})
