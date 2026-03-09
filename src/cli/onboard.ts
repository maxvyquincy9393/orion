/**
 * @file onboard.ts
 * @description Interactive onboarding CLI  guided first-run setup wizard for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Prompts for API keys, channel tokens, and persona configuration, then writes
 *   to .env and edith.json.
 */
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import dotenv from "dotenv"
import { execa } from "execa"

import { colors } from "./banner.js"
import { createClackPrompter, WizardCancelledError, type WizardPrompter } from "./wizard-prompter.js"

type ChannelChoice = "telegram" | "discord" | "whatsapp" | "webchat"
type ProviderChoice = "groq" | "openrouter" | "anthropic" | "openai" | "gemini" | "ollama"
type WhatsAppSetupMode = "scan" | "cloud"

type WriteMode = "write" | "print"

interface OnboardArgs {
  flow: "quickstart"
  channel: ChannelChoice | null
  provider: ProviderChoice | null
  whatsappMode: WhatsAppSetupMode | null
  writeMode: WriteMode
  yes: boolean
}

interface EnvTemplate {
  content: string
  source: ".env" | ".env.example" | "empty"
}

interface OnboardEnvPaths {
  envPath: string
  envExamplePath: string
}

interface QuickstartPlan {
  channel: ChannelChoice
  provider: ProviderChoice
  updates: Record<string, string>
  computerUseEnabled: boolean
}

interface NextStepCommands {
  status: string
  dashboard: string
  doctor: string
  all: string
  onboard: string
}

interface DatabaseBootstrapResult {
  ok: boolean
  lines: string[]
}

const DEFAULT_ONBOARD_COMPUTER_USE_CONFIG = {
  enabled: true,
  planner: "lats",
  fallbackPlanner: "dag",
  maxEpisodes: 30,
  maxStepsPerEpisode: 20,
  explorationConstant: 1.4142135623730951,
  expansionBranches: 3,
  taskTimeoutMs: 120000,
  browser: {
    injectSetOfMark: true,
    maxElements: 50,
    pageTimeoutMs: 15000,
    headless: true,
  },
  fileAgent: {
    allowedPaths: ["./workspace", "./workbenches"],
    maxFileSizeMb: 10,
    allowWrite: true,
  },
} as const

const CHANNEL_CHOICES: ReadonlyArray<{ key: ChannelChoice; label: string; description: string }> = [
  { key: "webchat", label: "WebChat (recommended)", description: "Closest to OpenClaw dashboard-first setup; no chat token required" },
  { key: "telegram", label: "Telegram", description: "Fastest phone-based bot test via Bot API" },
  { key: "discord", label: "Discord", description: "Good for DMs or one allowlisted server channel" },
  { key: "whatsapp", label: "WhatsApp", description: "Choose QR scan for quick pairing or Cloud API for Meta-hosted setup" },
]

const PROVIDER_CHOICES: ReadonlyArray<{ key: ProviderChoice; label: string; description: string }> = [
  { key: "groq", label: "Groq (recommended quick start)", description: "Fast and easy for chat testing" },
  { key: "openrouter", label: "OpenRouter", description: "Many models behind one API key" },
  { key: "anthropic", label: "Anthropic", description: "Claude API key" },
  { key: "openai", label: "OpenAI", description: "OpenAI API key" },
  { key: "gemini", label: "Gemini", description: "Google AI Studio / Gemini API key" },
  { key: "ollama", label: "Ollama (local model)", description: "No paid API key required" },
]

const WHATSAPP_MODE_CHOICES: ReadonlyArray<{ key: WhatsAppSetupMode; label: string; description: string }> = [
  { key: "scan", label: "Scan QR (recommended)", description: "Fastest OpenClaw-style test using Baileys (no Meta dashboard)" },
  { key: "cloud", label: "Cloud API", description: "Official Meta API with webhook, token, and phone number ID" },
]

function printHelp(): void {
  console.log("EDITH Setup Wizard")
  console.log("==================")
  console.log("")
  console.log("Usage:")
  console.log("  edith onboard                     # interactive setup (recommended)")
  console.log("  edith onboard --channel telegram   # preselect a channel")
  console.log("  edith onboard --provider groq      # preselect a provider")
  console.log("  edith wa scan                      # WhatsApp QR scan shortcut")
  console.log("")
  console.log("Options:")
  console.log("  --channel <name>    Preselect channel: telegram | discord | whatsapp | webchat")
  console.log("  --provider <name>   Preselect provider: groq | openrouter | anthropic | openai | gemini | ollama")
  console.log("  --whatsapp-mode <m> scan (QR) or cloud (Meta API)")
  console.log("  --print-only        Show planned .env changes without writing")
  console.log("  --yes               Non-interactive: use defaults, skip optional prompts")
  console.log("  --help, -h          Show this help")
}

function isChannelChoice(value: string): value is ChannelChoice {
  return CHANNEL_CHOICES.some((item) => item.key === value)
}

function isProviderChoice(value: string): value is ProviderChoice {
  return PROVIDER_CHOICES.some((item) => item.key === value)
}

function isWhatsAppSetupMode(value: string): value is WhatsAppSetupMode {
  return WHATSAPP_MODE_CHOICES.some((item) => item.key === value)
}

export function parseOnboardArgs(argv: string[]): OnboardArgs {
  let flow: "quickstart" = "quickstart"
  let channel: ChannelChoice | null = null
  let provider: ProviderChoice | null = null
  let whatsappMode: WhatsAppSetupMode | null = null
  let writeMode: WriteMode = "write"
  let yes = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--flow" && argv[i + 1]) {
      const next = argv[i + 1]
      i += 1
      if (next !== "quickstart") {
        throw new Error(`Unsupported --flow '${next}'. Only 'quickstart' is currently supported.`)
      }
      flow = "quickstart"
      continue
    }
    if (arg === "--flow=quickstart") {
      flow = "quickstart"
      continue
    }
    if (arg === "--channel" && argv[i + 1]) {
      const next = (argv[i + 1] ?? "").trim().toLowerCase()
      i += 1
      if (!isChannelChoice(next)) {
        throw new Error(`Invalid --channel '${next}'`)
      }
      channel = next
      continue
    }
    if (arg.startsWith("--channel=")) {
      const next = arg.slice("--channel=".length).trim().toLowerCase()
      if (!isChannelChoice(next)) {
        throw new Error(`Invalid --channel '${next}'`)
      }
      channel = next
      continue
    }
    if (arg === "--provider" && argv[i + 1]) {
      const next = (argv[i + 1] ?? "").trim().toLowerCase()
      i += 1
      if (!isProviderChoice(next)) {
        throw new Error(`Invalid --provider '${next}'`)
      }
      provider = next
      continue
    }
    if (arg === "--whatsapp-mode" && argv[i + 1]) {
      const next = (argv[i + 1] ?? "").trim().toLowerCase()
      i += 1
      if (!isWhatsAppSetupMode(next)) {
        throw new Error(`Invalid --whatsapp-mode '${next}'`)
      }
      whatsappMode = next
      continue
    }
    if (arg.startsWith("--whatsapp-mode=")) {
      const next = arg.slice("--whatsapp-mode=".length).trim().toLowerCase()
      if (!isWhatsAppSetupMode(next)) {
        throw new Error(`Invalid --whatsapp-mode '${next}'`)
      }
      whatsappMode = next
      continue
    }
    if (arg.startsWith("--provider=")) {
      const next = arg.slice("--provider=".length).trim().toLowerCase()
      if (!isProviderChoice(next)) {
        throw new Error(`Invalid --provider '${next}'`)
      }
      provider = next
      continue
    }
    if (arg === "--print-only") {
      writeMode = "print"
      continue
    }
    if (arg === "--write") {
      writeMode = "write"
      continue
    }
    if (arg === "--yes" || arg === "-y" || arg === "--non-interactive") {
      yes = true
      continue
    }
    if (arg === "--wizard") {
      continue
    }
  }

  return { flow, channel, provider, whatsappMode, writeMode, yes }
}

function providerEnvKey(provider: ProviderChoice): "GROQ_API_KEY" | "OPENROUTER_API_KEY" | "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY" | "OLLAMA_BASE_URL" {
  switch (provider) {
    case "groq":
      return "GROQ_API_KEY"
    case "openrouter":
      return "OPENROUTER_API_KEY"
    case "anthropic":
      return "ANTHROPIC_API_KEY"
    case "openai":
      return "OPENAI_API_KEY"
    case "gemini":
      return "GEMINI_API_KEY"
    case "ollama":
      return "OLLAMA_BASE_URL"
  }
}

function readEnvValueMap(content: string): Record<string, string> {
  try {
    return dotenv.parse(content)
  } catch {
    return {}
  }
}

function formatEnvValue(value: string): string {
  if (/[\s#]/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

function parseEnvLineKey(line: string): string | null {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
  return match?.[1] ?? null
}

export function mergeEnvContent(baseContent: string, updates: Record<string, string>): string {
  const normalizedBase = baseContent.replace(/\r\n/g, "\n")
  const lines = normalizedBase.split("\n")
  const out: string[] = []
  const presentKeys = new Set<string>()

  for (const line of lines) {
    const key = parseEnvLineKey(line)
    if (!key || !(key in updates)) {
      out.push(line)
      continue
    }

    out.push(`${key}=${formatEnvValue(updates[key] ?? "")}`)
    presentKeys.add(key)
  }

  const missingEntries = Object.entries(updates).filter(([key]) => !presentKeys.has(key))
  if (missingEntries.length > 0) {
    if (out.length > 0 && out[out.length - 1] !== "") {
      out.push("")
    }
    out.push("# Added by `pnpm onboard` quickstart wizard")
    for (const [key, value] of missingEntries) {
      out.push(`${key}=${formatEnvValue(value)}`)
    }
  }

  return `${out.join("\n").replace(/\n+$/g, "")}\n`
}

async function loadEnvTemplate(cwd: string): Promise<EnvTemplate> {
  const paths = resolveOnboardEnvPaths(cwd)
  const envPath = paths.envPath
  const envExamplePath = paths.envExamplePath

  try {
    return {
      content: await fs.readFile(envPath, "utf-8"),
      source: ".env",
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  try {
    return {
      content: await fs.readFile(envExamplePath, "utf-8"),
      source: ".env.example",
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  return { content: "", source: "empty" }
}

function resolveOnboardEnvPaths(cwd: string): OnboardEnvPaths {
  const explicitEnvPath = typeof process.env.EDITH_ENV_FILE === "string" && process.env.EDITH_ENV_FILE.trim().length > 0
    ? path.resolve(process.env.EDITH_ENV_FILE.trim())
    : null

  return {
    envPath: explicitEnvPath ?? path.join(cwd, ".env"),
    // Keep using the repo template as the canonical base when writing a profile env.
    envExamplePath: path.join(cwd, ".env.example"),
  }
}

function resolveOnboardConfigPath(cwd: string): string {
  return path.join(cwd, "edith.json")
}

async function writeComputerUseConfig(cwd: string, enabled: boolean): Promise<string> {
  const configPath = resolveOnboardConfigPath(cwd)
  let parsed: Record<string, unknown> = {}

  try {
    parsed = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  const currentComputerUse =
    parsed.computerUse && typeof parsed.computerUse === "object"
      ? parsed.computerUse as Record<string, unknown>
      : {}

  parsed.computerUse = {
    ...DEFAULT_ONBOARD_COMPUTER_USE_CONFIG,
    ...currentComputerUse,
    enabled,
  }

  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8")
  return configPath
}

function redactSecretValue(key: string, value: string): string {
  if (!/_KEY$|TOKEN|PASSWORD|SECRET/.test(key)) {
    return value
  }
  if (!value) {
    return value
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`
}

function defaultNextStepCommands(env: NodeJS.ProcessEnv = process.env): NextStepCommands {
  const usingGlobalWrapper = [env.EDITH_ENV_FILE, env.EDITH_WORKSPACE, env.EDITH_STATE_DIR]
    .some((value) => typeof value === "string" && value.trim().length > 0)

  if (usingGlobalWrapper) {
    return {
      status: "edith status",
      dashboard: "edith dashboard --open",
      doctor: "edith doctor",
      all: "edith all",
      onboard: "edith onboard",
    }
  }

  return {
    status: "pnpm doctor",
    dashboard: "pnpm gateway",
    doctor: "pnpm doctor",
    all: "pnpm all",
    onboard: "pnpm onboard",
  }
}

function buildNextSteps(plan: QuickstartPlan, commands: NextStepCommands = defaultNextStepCommands()): string[] {
  const lines: string[] = []

  lines.push(colors.accent("Setup complete."))
  lines.push("")
  lines.push("Recommended next steps:")
  lines.push(`  \`${commands.status}\`            # verify the active profile is healthy`)
  lines.push(`  \`${commands.dashboard}\`         # start the dashboard / gateway first`)
  lines.push(`  \`${commands.all}\`               # start the full app once status is clean`)
  lines.push("")
  lines.push("Useful commands:")
  lines.push(`  \`${commands.doctor}\`            # detailed health check`)
  lines.push(`  \`pnpm typecheck\`        # TypeScript check`)
  lines.push(`  \`${commands.onboard}\`         # re-run wizard anytime`)
  lines.push(`  \`pnpm dev -- --mode text\`    # text-only CLI mode`)
  lines.push(`  \`pnpm dev -- --mode gateway\` # HTTP gateway only`)

  if (plan.channel === "telegram") {
    lines.push("")
    lines.push("Telegram setup:")
    lines.push("  1. DM your bot and run /start, /id, /ping")
    if (!plan.updates.TELEGRAM_CHAT_ID) {
      lines.push(`  2. Copy /id result into TELEGRAM_CHAT_ID and rerun \`${commands.onboard}\``)
    }
    lines.push("  -> docs/channels/telegram.md")
  } else if (plan.channel === "discord") {
    lines.push("")
    lines.push("Discord setup:")
    lines.push("  1. Enable Message Content Intent in Discord Developer Portal")
    lines.push("  2. DM the bot and run !help, !id, !ping")
    if (!plan.updates.DISCORD_CHANNEL_ID) {
      lines.push(`  3. Add !id result to DISCORD_CHANNEL_ID and rerun \`${commands.onboard}\``)
    }
    lines.push("  -> docs/channels/discord.md")
  } else if (plan.channel === "whatsapp") {
    const isCloudMode = (plan.updates.WHATSAPP_MODE ?? "").trim().toLowerCase() === "cloud"
    lines.push("")
    lines.push("WhatsApp setup:")
    if (isCloudMode) {
      lines.push("  1. Expose gateway publicly (Cloudflare Tunnel / ngrok)")
      lines.push("  2. Point Meta webhook to /webhooks/whatsapp")
      lines.push("  3. Set verify token = WHATSAPP_CLOUD_VERIFY_TOKEN")
    } else {
      lines.push(`  1. Scan the QR code when it appears in terminal (WHATSAPP_MODE=baileys)`)
      lines.push("  2. WhatsApp -> Linked Devices -> Link a Device")
    }
    lines.push("  -> docs/channels/whatsapp.md")
  } else {
    lines.push("")
    lines.push("WebChat:")
    lines.push("  1. Start the dashboard / gateway")
    lines.push("  2. Open http://127.0.0.1:8080 in your browser")
    lines.push(`  Add more channels later with \`${commands.onboard}\``)
  }

  lines.push("")
  lines.push("Docs: docs/platform/onboarding.md")

  return lines
}

async function collectQuickstartPlan(
  args: OnboardArgs,
  envValues: Record<string, string>,
  prompter: WizardPrompter,
): Promise<QuickstartPlan> {
  const nonInteractive = args.yes

  if (!nonInteractive) {
    await prompter.note(
      [
        "This wizard will configure:",
        `  • your first test channel  (WebChat / Telegram / Discord / WhatsApp)`,
        `  • your model provider  (Groq, OpenRouter, Anthropic, OpenAI, Gemini, Ollama…)`,
        "  • the minimum API keys needed to start EDITH",
      ].join("\n"),
      "What we'll configure",
    )
  } else {
    console.log("Non-interactive mode (--yes): using defaults and skipping optional prompts.")
  }

  const choose = async <T extends string>(
    selected: T | null,
    message: string,
    choices: ReadonlyArray<{ key: T; label: string; description: string }>,
  ): Promise<T> => {
    if (selected) return selected
    if (nonInteractive) return choices[0].key
    return prompter.select({
      message,
      options: choices.map((c) => ({ value: c.key, label: c.label, hint: c.description })),
      initialValue: choices[0].key,
    })
  }

  const askInputMaybe = async (
    label: string,
    opts: {
      current?: string | null
      placeholder?: string
      optional?: boolean
      defaultValue?: string
    } = {},
  ): Promise<string | null> => {
    if (nonInteractive) return opts.defaultValue ?? null
    const result = await prompter.text({
      message: label,
      placeholder: opts.placeholder ?? (opts.optional ? "leave blank to skip" : undefined),
      initialValue: opts.current ?? opts.defaultValue ?? undefined,
    })
    return result.trim() || null
  }

  const askYesNoMaybe = async (message: string, defaultYes = true): Promise<boolean> => {
    if (nonInteractive) return defaultYes
    return prompter.confirm({ message, initialValue: defaultYes })
  }

  const channel = await choose(args.channel, "Choose your first test channel", CHANNEL_CHOICES)
  const provider = await choose(args.provider, "Choose your primary model provider", PROVIDER_CHOICES)

  const updates: Record<string, string> = {}

  const providerKey = providerEnvKey(provider)
  if (provider === "ollama") {
    const baseUrl = await askInputMaybe("OLLAMA_BASE_URL", {
      current: envValues.OLLAMA_BASE_URL ?? null,
      placeholder: "default=http://localhost:11434",
      defaultValue: envValues.OLLAMA_BASE_URL || "http://localhost:11434",
    })
    if (baseUrl) {
      updates[providerKey] = baseUrl
    }
  } else {
    const apiKey = await askInputMaybe(providerKey, {
      current: envValues[providerKey] ?? null,
      optional: true,
      placeholder: "leave blank to keep current / set later",
    })
    if (apiKey) {
      updates[providerKey] = apiKey
    }
  }

  if (channel === "telegram") {
    const botToken = await askInputMaybe("TELEGRAM_BOT_TOKEN", {
      current: envValues.TELEGRAM_BOT_TOKEN ?? null,
      optional: true,
      placeholder: "from @BotFather (leave blank to set later)",
    })
    const chatId = await askInputMaybe("TELEGRAM_CHAT_ID", {
      current: envValues.TELEGRAM_CHAT_ID ?? null,
      optional: true,
      placeholder: "allowlist chat id (optional now, use /id later)",
    })
    if (botToken) {
      updates.TELEGRAM_BOT_TOKEN = botToken
    }
    if (chatId) {
      updates.TELEGRAM_CHAT_ID = chatId
    }
  } else if (channel === "discord") {
    const botToken = await askInputMaybe("DISCORD_BOT_TOKEN", {
      current: envValues.DISCORD_BOT_TOKEN ?? null,
      optional: true,
      placeholder: "Discord Developer Portal token (leave blank to set later)",
    })
    const channelId = await askInputMaybe("DISCORD_CHANNEL_ID", {
      current: envValues.DISCORD_CHANNEL_ID ?? null,
      optional: true,
      placeholder: "allowlist channel id (optional; DMs work without it)",
    })
    if (botToken) {
      updates.DISCORD_BOT_TOKEN = botToken
    }
    if (channelId) {
      updates.DISCORD_CHANNEL_ID = channelId
    }
  } else if (channel === "whatsapp") {
    updates.WHATSAPP_ENABLED = "true"
    const whatsAppMode = await choose(args.whatsappMode, "Choose WhatsApp setup mode", WHATSAPP_MODE_CHOICES)

    if (whatsAppMode === "scan") {
      updates.WHATSAPP_MODE = "baileys"
    } else {
      const accessToken = await askInputMaybe("WHATSAPP_CLOUD_ACCESS_TOKEN", {
        current: envValues.WHATSAPP_CLOUD_ACCESS_TOKEN ?? null,
        optional: true,
        placeholder: "Meta permanent/long-lived access token (leave blank to set later)",
      })
      const phoneNumberId = await askInputMaybe("WHATSAPP_CLOUD_PHONE_NUMBER_ID", {
        current: envValues.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? null,
        optional: true,
        placeholder: "from Meta WhatsApp Cloud API dashboard",
      })
      const verifyTokenDefault =
        envValues.WHATSAPP_CLOUD_VERIFY_TOKEN
        || crypto.randomUUID().replaceAll("-", "")
      const verifyToken = await askInputMaybe("WHATSAPP_CLOUD_VERIFY_TOKEN", {
        current: envValues.WHATSAPP_CLOUD_VERIFY_TOKEN ?? null,
        placeholder: "used by Meta webhook verification (auto-generated if blank)",
        defaultValue: verifyTokenDefault,
      })
      const allowlist = await askInputMaybe("WHATSAPP_CLOUD_ALLOWED_WA_IDS", {
        current: envValues.WHATSAPP_CLOUD_ALLOWED_WA_IDS ?? null,
        optional: true,
        placeholder: "optional allowlist (comma/newline wa_id), use /id later",
      })
      const apiVersion = await askInputMaybe("WHATSAPP_CLOUD_API_VERSION", {
        current: envValues.WHATSAPP_CLOUD_API_VERSION ?? null,
        optional: true,
        placeholder: "default=v20.0",
        defaultValue: envValues.WHATSAPP_CLOUD_API_VERSION || "v20.0",
      })

      updates.WHATSAPP_MODE = "cloud"
      if (accessToken) {
        updates.WHATSAPP_CLOUD_ACCESS_TOKEN = accessToken
      }
      if (phoneNumberId) {
        updates.WHATSAPP_CLOUD_PHONE_NUMBER_ID = phoneNumberId
      }
      if (verifyToken) {
        updates.WHATSAPP_CLOUD_VERIFY_TOKEN = verifyToken
      }
      if (allowlist) {
        updates.WHATSAPP_CLOUD_ALLOWED_WA_IDS = allowlist
      }
      if (apiVersion) {
        updates.WHATSAPP_CLOUD_API_VERSION = apiVersion
      }
    }
  }

  const setAutoStartGateway = await askYesNoMaybe(
    "Set AUTO_START_GATEWAY=true for `pnpm dev`",
    channel === "webchat" || (channel === "whatsapp" && updates.WHATSAPP_MODE === "cloud"),
  )
  if (setAutoStartGateway) {
    updates.AUTO_START_GATEWAY = "true"
  }

  const enableComputerUse = await askYesNoMaybe(
    "Enable computer use defaults in edith.json",
    true,
  )

  return { channel, provider, updates, computerUseEnabled: enableComputerUse }
}

function formatPlannedChangesNote(plan: QuickstartPlan, envPath: string, templateSource: EnvTemplate["source"]): string {
  const lines: string[] = [
    `Channel:  ${colors.accent(plan.channel)}`,
    `Provider: ${colors.accent(plan.provider)}`,
    `Computer use: ${plan.computerUseEnabled ? colors.success("enabled") : colors.dim("disabled")}`,
    `Target env: ${colors.dim(envPath)} ${colors.dim(`(base: ${templateSource})`)}`,
  ]
  if (Object.keys(plan.updates).length === 0) {
    lines.push("")
    lines.push(colors.dim("No env changes collected — set values later."))
  } else {
    lines.push("")
    lines.push("Env updates:")
    for (const [key, value] of Object.entries(plan.updates)) {
      lines.push(`  ${colors.label(key)}=${colors.dim(redactSecretValue(key, value))}`)
    }
  }
  return lines.join("\n")
}

async function writeEnvFile(cwd: string, template: EnvTemplate, updates: Record<string, string>): Promise<string> {
  const { envPath } = resolveOnboardEnvPaths(cwd)
  const merged = mergeEnvContent(template.content, updates)
  await fs.mkdir(path.dirname(envPath), { recursive: true })
  await fs.writeFile(envPath, merged, "utf-8")
  return envPath
}

function isUsingGlobalWrapper(env: NodeJS.ProcessEnv = process.env): boolean {
  return [env.EDITH_ENV_FILE, env.EDITH_WORKSPACE, env.EDITH_STATE_DIR]
    .some((value) => typeof value === "string" && value.trim().length > 0)
}

function parseFileDatabaseUrl(databaseUrl: string): string | null {
  const raw = databaseUrl.trim()
  if (!raw.toLowerCase().startsWith("file:")) {
    return null
  }
  const filePath = raw.slice("file:".length)
  if (!filePath) {
    return null
  }
  if (filePath.startsWith("./") || filePath.startsWith(".\\")) {
    return path.resolve(process.cwd(), filePath)
  }
  return filePath
}

function buildDatabaseRecoveryHint(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const filePath = parseFileDatabaseUrl(databaseUrl)
  if (!filePath) {
    return []
  }

  const repairCommand = isUsingGlobalWrapper(env)
    ? "edith status --fix --migrate"
    : "pnpm exec prisma migrate deploy"

  return [
    "If this is only a local test profile, the quickest recovery is:",
    `- Stop EDITH and back up or remove: ${filePath}`,
    `- Re-run: \`${repairCommand}\``,
  ]
}

function normalizeDatabaseBootstrapOutput(error: unknown): string {
  const stderr = typeof (error as { stderr?: unknown })?.stderr === "string" ? (error as { stderr: string }).stderr : ""
  const stdout = typeof (error as { stdout?: unknown })?.stdout === "string" ? (error as { stdout: string }).stdout : ""
  const fallback = error instanceof Error ? error.message : String(error)
  return (stderr || stdout || fallback).trim()
}

function shouldFallbackToDbPush(output: string): boolean {
  return /Schema engine error/i.test(output) || /no such table:\s*MemoryNode/i.test(output) || /\bP3009\b|\bP3018\b/i.test(output)
}

async function bootstrapDatabase(
  cwd: string,
  envPath: string,
  currentEnv: Record<string, string>,
  updates: Record<string, string>,
): Promise<DatabaseBootstrapResult> {
  const writtenEnv = readEnvValueMap(await fs.readFile(envPath, "utf-8").catch(() => ""))
  const databaseUrl = (writtenEnv.DATABASE_URL ?? updates.DATABASE_URL ?? currentEnv.DATABASE_URL ?? "").trim()
  if (!databaseUrl) {
    return {
      ok: true,
      lines: ["DATABASE_URL is not set yet, so database bootstrap was skipped."],
    }
  }

  const sqliteDbPath = parseFileDatabaseUrl(databaseUrl)
  if (sqliteDbPath) {
    await fs.mkdir(path.dirname(sqliteDbPath), { recursive: true })
    try {
      await fs.access(sqliteDbPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await fs.writeFile(sqliteDbPath, "", "utf-8")
      } else {
        throw error
      }
    }
  }

  try {
    await execa("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      stdio: "pipe",
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: "1",
      },
    })
    return {
      ok: true,
      lines: ["Database ready (migrations applied or already up to date)."],
    }
  } catch (error) {
    const output = normalizeDatabaseBootstrapOutput(error)
    if (shouldFallbackToDbPush(output)) {
      try {
        await execa("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], {
          stdio: "pipe",
          cwd,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            PRISMA_HIDE_UPDATE_MESSAGE: "1",
          },
        })
        return {
          ok: true,
          lines: ["Database ready (schema synced with Prisma db push for this local profile)."],
        }
      } catch (pushError) {
        const pushOutput = normalizeDatabaseBootstrapOutput(pushError)
        return {
          ok: false,
          lines: [
            "Database init did not complete cleanly.",
            "Both `prisma migrate deploy` and the local SQLite fallback `prisma db push` failed.",
            "",
            "Prisma said:",
            pushOutput || output,
            "",
            ...buildDatabaseRecoveryHint(databaseUrl),
          ],
        }
      }
    }

    const lines = [
      "Database init did not complete cleanly.",
      "Onboarding now uses `prisma migrate deploy` so setup matches runtime behavior.",
    ]

    if (output) {
      lines.push("")
      lines.push("Prisma said:")
      lines.push(output)
    }

    const recoveryHint = buildDatabaseRecoveryHint(databaseUrl)
    if (recoveryHint.length > 0) {
      lines.push("")
      lines.push(...recoveryHint)
    }

    return { ok: false, lines }
  }
}

async function requireRiskAcknowledgement(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "EDITH can:",
      "  • read and write files in your project",
      "  • run commands via computer-use agents",
      "  • send messages through configured channels",
      "",
      "API keys written to .env are stored unencrypted on disk.",
      "Keep your .env out of version control (.gitignore is already set).",
    ].join("\n"),
    "Before you begin",
  )
  const ok = await prompter.confirm({ message: "I understand. Continue?", initialValue: true })
  if (!ok) throw new WizardCancelledError("risk not accepted")
}

async function runOnboarding(argv: string[]): Promise<void> {
  const args = parseOnboardArgs(argv)
  if (args.flow !== "quickstart") {
    throw new Error(`Unsupported flow: ${args.flow}`)
  }

  const prompter = createClackPrompter()
  await prompter.intro("EDITH Setup Wizard")

  const cwd = process.cwd()
  const commands = defaultNextStepCommands()
  const template = await loadEnvTemplate(cwd)
  const { envPath } = resolveOnboardEnvPaths(cwd)
  const currentEnv = readEnvValueMap(template.content)

  try {
    if (!args.yes) {
      await requireRiskAcknowledgement(prompter)
    }

    const plan = await collectQuickstartPlan(args, currentEnv, prompter)
    const changesSummary = formatPlannedChangesNote(plan, envPath, template.source)

    if (args.writeMode === "print") {
      await prompter.note(changesSummary, "Planned changes (print-only, not written)")
    } else {
      await prompter.note(changesSummary, "Planned changes")

      let shouldWrite = args.yes
      if (!shouldWrite) {
        shouldWrite = await prompter.confirm({ message: "Write these changes to .env now?", initialValue: true })
      }

      if (shouldWrite) {
        const writeProg = prompter.progress("Writing configuration...")
        await writeEnvFile(cwd, template, plan.updates)
        const configPath = await writeComputerUseConfig(cwd, plan.computerUseEnabled)
        writeProg.stop(`Configuration saved — ${envPath}  ${colors.dim(configPath)}`)

        const dbProg = prompter.progress("Setting up database...")
        const databaseBootstrap = await bootstrapDatabase(cwd, envPath, currentEnv, plan.updates)
        if (!databaseBootstrap.ok) {
          dbProg.stop("Database setup failed")
          await prompter.note(databaseBootstrap.lines.join("\n"), "Database error")
          process.exitCode = 1
          return
        }
        dbProg.stop("Database ready")

        const healthProg = prompter.progress("Running health check...")
        try {
          await execa("pnpm", ["doctor"], { stdio: "pipe", cwd })
          healthProg.stop("Health check passed")
        } catch {
          healthProg.stop("Some health checks failed — run `edith doctor` to see details")
        }
      } else {
        console.log(colors.dim("  Skipped writing .env"))
      }
    }

    const nextStepsNote = buildNextSteps(plan, commands).slice(2).join("\n")
    await prompter.note(nextStepsNote, "Next steps")
    await prompter.outro("All done! Run `edith status` to verify.")
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      process.exit(0)
    }
    throw error
  }
}

export const __onboardTestUtils = {
  parseOnboardArgs,
  mergeEnvContent,
  providerEnvKey,
  buildNextSteps,
  defaultNextStepCommands,
  parseEnvLineKey,
  writeComputerUseConfig,
}

async function main(): Promise<void> {
  try {
    await runOnboarding(process.argv.slice(2))
  } catch (error) {
    console.error(`Onboarding failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (import.meta.url === invokedPath) {
  void main()
}
