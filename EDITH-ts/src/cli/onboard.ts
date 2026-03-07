import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { pathToFileURL } from "node:url"

import dotenv from "dotenv"
import { writeEdithConfig } from "../config/edith-config.js"

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
  /** Structured edith.json config object to merge/write (not needed for buildNextSteps) */
  jsonConfig?: Record<string, unknown>
}

interface NextStepCommands {
  doctor: string
  all: string
  onboard: string
}

const CHANNEL_CHOICES: ReadonlyArray<{ key: ChannelChoice; label: string; description: string }> = [
  { key: "telegram", label: "Telegram (recommended)", description: "Fastest path for phone testing via Bot API" },
  { key: "discord", label: "Discord", description: "Good for DMs or one allowlisted server channel" },
  { key: "whatsapp", label: "WhatsApp (Cloud API)", description: "Phone-native test via Meta WhatsApp Cloud API + webhook" },
  { key: "webchat", label: "WebChat (local browser)", description: "No external token needed; local-only testing" },
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
  { key: "scan", label: "Scan QR (recommended)", description: "Fastest QR test using Baileys (no Meta dashboard)" },
  { key: "cloud", label: "Cloud API", description: "Official Meta API with webhook, token, and phone number ID" },
]

function printHelp(): void {
  console.log("EDITH Onboarding")
  console.log("====================================")
  console.log("")
  console.log("Usage:")
  console.log("  pnpm quickstart   # beginner-friendly quickstart wizard (recommended)")
  console.log("  pnpm onboard -- [--channel telegram|discord|whatsapp|webchat] [--provider groq|openrouter|anthropic|openai|gemini|ollama] [--whatsapp-mode scan|cloud]")
  console.log("  pnpm wa:scan      # one-command WhatsApp QR setup")
  console.log("  pnpm run setup    # compatibility alias (avoid bare `pnpm setup`, it conflicts with pnpm built-in)")
  console.log("")
  console.log("Options:")
  console.log("  --flow quickstart   Only supported flow (default)")
  console.log("  --channel <name>    Preselect a channel")
  console.log("  --provider <name>   Preselect an AI provider")
  console.log("  --print-only        Do not write .env; print the planned changes")
  console.log("  --write             Force writing .env without print-only")
  console.log("  --yes               Non-interactive mode: use defaults, skip optional prompts, and skip final confirmation")
  console.log("  --non-interactive   Alias for --yes automation")
  console.log("  --wizard            Compatibility no-op (reserved for setup parity)")
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
      doctor: "edith doctor",
      all: "edith all",
      onboard: "edith onboard",
    }
  }

  return {
    doctor: "pnpm doctor",
    all: "pnpm all",
    onboard: "pnpm onboard",
  }
}

function buildNextSteps(plan: QuickstartPlan, commands: NextStepCommands = defaultNextStepCommands()): string[] {
  const lines: string[] = []

  lines.push("Next steps:")
  lines.push(`1. Run \`${commands.doctor}\` to validate config + ports.`)
  lines.push(`2. Start EDITH with channels: \`${commands.all}\``)

  if (plan.channel === "telegram") {
    lines.push("3. Open Telegram on your phone and DM your bot.")
    lines.push("4. Run `/start`, `/id`, `/ping`, then send a normal message.")
    if (!plan.updates.TELEGRAM_CHAT_ID) {
      lines.push(`5. Copy \`/id\` result into \`TELEGRAM_CHAT_ID\` (allowlist) and rerun \`${commands.onboard}\`.`)
    }
  } else if (plan.channel === "discord") {
    lines.push("3. Enable Message Content Intent in Discord Developer Portal.")
    lines.push("4. DM the bot (or use an allowlisted channel) and run `!help`, `!id`, `!ping`.")
    if (!plan.updates.DISCORD_CHANNEL_ID) {
      lines.push(`5. If using a server channel, add the \`!id\` result to \`DISCORD_CHANNEL_ID\` and rerun \`${commands.onboard}\`.`)
    }
  } else if (plan.channel === "whatsapp") {
    const isCloudMode = (plan.updates.WHATSAPP_MODE ?? "").trim().toLowerCase() === "cloud"
    if (isCloudMode) {
      lines.push("3. Expose your gateway publicly (e.g. Cloudflare Tunnel / ngrok) and point Meta webhook to `/webhooks/whatsapp`.")
      lines.push("4. In Meta App dashboard, set verify token to `WHATSAPP_CLOUD_VERIFY_TOKEN` and subscribe to `messages` webhook events.")
      lines.push("5. Run `/help`, `/id`, `/ping` from your WhatsApp test phone, then send a normal message.")
      if (!plan.updates.WHATSAPP_CLOUD_ALLOWED_WA_IDS) {
        lines.push(`6. Optional hardening: copy \`/id\` result into \`WHATSAPP_CLOUD_ALLOWED_WA_IDS\` and rerun \`${commands.onboard}\`.`)
      }
    } else {
      lines.push("3. Wait for the WhatsApp QR code in terminal.")
      lines.push("4. On your phone: WhatsApp -> Linked Devices -> Link a Device, then scan the QR.")
      lines.push("5. Send `/help`, `/id`, `/ping`, then a normal message from a test chat.")
      lines.push("6. If QR does not appear, make sure `baileys` is installed and `WHATSAPP_MODE=baileys`.")
    }
  } else {
    lines.push("3. Open `http://127.0.0.1:8080` on this machine and test WebChat.")
    lines.push(`4. For phone access, set up Telegram, Discord, or WhatsApp later with \`${commands.onboard}\`.`)
  }

  lines.push("")
  lines.push("Docs:")
  if (plan.channel === "telegram") {
    lines.push("- `docs/channels/telegram.md`")
  } else if (plan.channel === "discord") {
    lines.push("- `docs/channels/discord.md`")
  } else if (plan.channel === "whatsapp") {
    lines.push("- `docs/channels/whatsapp.md`")
  }
  lines.push("- `docs/platform/onboarding.md`")

  return lines
}

async function askChoice<T extends string>(
  rl: readline.Interface,
  prompt: string,
  choices: ReadonlyArray<{ key: T; label: string; description: string }>,
): Promise<T> {
  console.log("")
  console.log(prompt)
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice.label}`)
    console.log(`     ${choice.description}`)
  })

  while (true) {
    const raw = (await rl.question(`Select [1-${choices.length}] (default 1): `)).trim()
    if (!raw) {
      return choices[0].key
    }
    const index = Number.parseInt(raw, 10)
    if (Number.isFinite(index) && index >= 1 && index <= choices.length) {
      return choices[index - 1].key
    }
    const byKey = choices.find((choice) => choice.key === raw.toLowerCase())
    if (byKey) {
      return byKey.key
    }
    console.log("Invalid selection, try again.")
  }
}

async function askInput(
  rl: readline.Interface,
  label: string,
  opts: {
    current?: string | null
    placeholder?: string
    optional?: boolean
    defaultValue?: string
  } = {},
): Promise<string | null> {
  const suffixParts: string[] = []
  if (opts.current) {
    suffixParts.push(`current=${redactSecretValue(label, opts.current)}`)
  }
  if (opts.optional) {
    suffixParts.push("optional")
  }
  if (opts.placeholder) {
    suffixParts.push(opts.placeholder)
  }
  const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : ""

  const prompt = `${label}${suffix}: `
  const raw = (await rl.question(prompt)).trim()

  if (!raw) {
    if (opts.defaultValue !== undefined) {
      return opts.defaultValue
    }
    return opts.optional ? null : null
  }

  return raw
}

async function askYesNo(
  rl: readline.Interface,
  prompt: string,
  defaultYes = true,
): Promise<boolean> {
  const raw = (await rl.question(`${prompt} (${defaultYes ? "Y/n" : "y/N"}): `)).trim().toLowerCase()
  if (!raw) {
    return defaultYes
  }
  if (["y", "yes"].includes(raw)) {
    return true
  }
  if (["n", "no"].includes(raw)) {
    return false
  }
  return defaultYes
}

function buildQuickstartBanner(): void {
  console.log("EDITH Setup Wizard")
  console.log("======================================")
  console.log("")
  console.log("This wizard helps you:")
  console.log("- choose a test channel (Telegram / Discord / WhatsApp / WebChat)")
  console.log("- for WhatsApp: choose Scan QR (quick test) or Cloud API (official)")
  console.log("- choose a model provider")
  console.log("- write the config to edith.json (legacy edith.json is still supported)")
}

async function collectQuickstartPlan(
  args: OnboardArgs,
  envValues: Record<string, string>,
): Promise<QuickstartPlan> {
  const nonInteractive = args.yes
  const rl = nonInteractive ? null : readline.createInterface({ input, output })
  try {
    buildQuickstartBanner()
    if (nonInteractive) {
      console.log("")
      console.log("Non-interactive mode enabled (`--yes` / `--non-interactive`): using defaults and skipping optional prompts.")
    }

    const choose = async <T extends string>(
      selected: T | null,
      prompt: string,
      choices: ReadonlyArray<{ key: T; label: string; description: string }>,
    ): Promise<T> => {
      if (selected) {
        return selected
      }
      if (nonInteractive) {
        return choices[0].key
      }
      return askChoice(rl!, prompt, choices)
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
      if (nonInteractive) {
        return opts.defaultValue ?? null
      }
      return askInput(rl!, label, opts)
    }

    const askYesNoMaybe = async (prompt: string, defaultYes = true): Promise<boolean> => {
      if (nonInteractive) {
        return defaultYes
      }
      return askYesNo(rl!, prompt, defaultYes)
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
      channel === "whatsapp" && updates.WHATSAPP_MODE === "cloud",
    )
    if (setAutoStartGateway) {
      updates.AUTO_START_GATEWAY = "true"
    }

    // ── Build structured edith.json config (EDITH-style) ──────────
    const jsonConfig: Record<string, unknown> = {}

    // env section: provider API keys
    const envSection: Record<string, string> = {}
    const providerKeyName = providerEnvKey(provider)
    if (provider === "ollama") {
      if (updates.OLLAMA_BASE_URL) {
        envSection.OLLAMA_BASE_URL = updates.OLLAMA_BASE_URL
      }
    } else if (updates[providerKeyName]) {
      envSection[providerKeyName] = updates[providerKeyName]
    }
    if (setAutoStartGateway) {
      envSection.AUTO_START_GATEWAY = "true"
    }
    if (Object.keys(envSection).length > 0) {
      jsonConfig.env = envSection
    }

    // agents.defaults.model: set primary model based on provider
    const providerModelMap: Record<ProviderChoice, string> = {
      groq: "groq/llama-3.3-70b-versatile",
      openrouter: "openrouter/auto",
      anthropic: "anthropic/claude-sonnet-4-20250514",
      openai: "openai/gpt-4o",
      gemini: "gemini/gemini-2.0-flash",
      ollama: "ollama/llama3.2",
    }
    jsonConfig.agents = {
      defaults: {
        model: {
          primary: providerModelMap[provider] ?? providerModelMap.groq,
          fallbacks: [],
        },
      },
    }

    // channels section: tokens directly in JSON
    const channelsConfig: Record<string, Record<string, unknown>> = {}
    if (channel === "telegram") {
      const telegramCfg: Record<string, unknown> = {}
      if (updates.TELEGRAM_BOT_TOKEN) telegramCfg.botToken = updates.TELEGRAM_BOT_TOKEN
      if (updates.TELEGRAM_CHAT_ID) telegramCfg.chatId = updates.TELEGRAM_CHAT_ID
      if (Object.keys(telegramCfg).length > 0) channelsConfig.telegram = telegramCfg
    } else if (channel === "discord") {
      const discordCfg: Record<string, unknown> = {}
      if (updates.DISCORD_BOT_TOKEN) discordCfg.botToken = updates.DISCORD_BOT_TOKEN
      if (updates.DISCORD_CHANNEL_ID) discordCfg.channelId = updates.DISCORD_CHANNEL_ID
      if (Object.keys(discordCfg).length > 0) channelsConfig.discord = discordCfg
    } else if (channel === "whatsapp") {
      const waCfg: Record<string, unknown> = { enabled: true }
      if (updates.WHATSAPP_MODE) waCfg.mode = updates.WHATSAPP_MODE
      if (updates.WHATSAPP_CLOUD_ACCESS_TOKEN) waCfg.accessToken = updates.WHATSAPP_CLOUD_ACCESS_TOKEN
      if (updates.WHATSAPP_CLOUD_PHONE_NUMBER_ID) waCfg.phoneNumberId = updates.WHATSAPP_CLOUD_PHONE_NUMBER_ID
      if (updates.WHATSAPP_CLOUD_VERIFY_TOKEN) waCfg.verifyToken = updates.WHATSAPP_CLOUD_VERIFY_TOKEN
      if (updates.WHATSAPP_CLOUD_ALLOWED_WA_IDS) waCfg.allowedWaIds = updates.WHATSAPP_CLOUD_ALLOWED_WA_IDS
      if (updates.WHATSAPP_CLOUD_API_VERSION) waCfg.apiVersion = updates.WHATSAPP_CLOUD_API_VERSION
      channelsConfig.whatsapp = waCfg
    }
    if (Object.keys(channelsConfig).length > 0) {
      jsonConfig.channels = channelsConfig
    }

    return { channel, provider, updates, jsonConfig }
  } finally {
    rl?.close()
  }
}

function printPlannedChanges(plan: QuickstartPlan, configPath: string): void {
  console.log("")
  console.log("Quickstart plan")
  console.log("===============")
  console.log(`Channel: ${plan.channel}`)
  console.log(`Provider: ${plan.provider}`)
  console.log(`Target config: ${configPath}`)
  console.log("")
  const cfg = plan.jsonConfig ?? {}
  if (Object.keys(cfg).length === 0) {
    console.log("No config changes collected (you can still run the next steps and set values later).")
    return
  }
  // Pretty-print structured config with redacted secrets
  console.log("EDITH config updates:")
  const displayConfig = structuredClone(cfg) as Record<string, unknown>
  // Redact secrets in env section
  if (displayConfig.env && typeof displayConfig.env === "object") {
    const envObj = displayConfig.env as Record<string, string>
    for (const [key, value] of Object.entries(envObj)) {
      envObj[key] = redactSecretValue(key, value)
    }
  }
  // Redact secrets in channels section
  if (displayConfig.channels && typeof displayConfig.channels === "object") {
    for (const channelCfg of Object.values(displayConfig.channels as Record<string, Record<string, unknown>>)) {
      for (const [key, value] of Object.entries(channelCfg)) {
        if (typeof value === "string" && /token|key|password|secret/i.test(key)) {
          channelCfg[key] = redactSecretValue(key, value)
        }
      }
    }
  }
  console.log(JSON.stringify(displayConfig, null, 2))
}

/**
 * Deep merge: second object's values win. Only merges plain objects.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

async function loadExistingEdithJson(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(configPath, "utf-8")
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function runOnboarding(argv: string[]): Promise<void> {
  const args = parseOnboardArgs(argv)
  if (args.flow !== "quickstart") {
    throw new Error(`Unsupported flow: ${args.flow}`)
  }

  const cwd = process.cwd()

  // Load existing env values for the wizard prompts (from .env OR edith.json)
  const template = await loadEnvTemplate(cwd)
  const currentEnv = readEnvValueMap(template.content)

  // Prefer the EDITH config path, but keep legacy edith.json compatible.
  const edithConfigPath = path.resolve(cwd, "edith.json")
  const legacyConfigPath = path.resolve(cwd, "edith.json")
  const configPath = await fs.access(edithConfigPath).then(() => edithConfigPath).catch(async () => {
    return await fs.access(legacyConfigPath).then(() => legacyConfigPath).catch(() => edithConfigPath)
  })
  const existingJson = await loadExistingEdithJson(configPath)
  const existingEnv = (typeof existingJson.env === "object" && existingJson.env !== null)
    ? existingJson.env as Record<string, string>
    : {}
  // Merge: edith.json env values override .env values for display purposes
  const mergedCurrentEnv = { ...currentEnv, ...existingEnv }

  const plan = await collectQuickstartPlan(args, mergedCurrentEnv)

  printPlannedChanges(plan, configPath)

  if (args.writeMode === "print") {
    console.log("")
    console.log("Print-only mode: EDITH config was not modified.")
  } else {
    let shouldWrite = args.yes
    if (!shouldWrite) {
      const rl = readline.createInterface({ input, output })
      try {
        shouldWrite = await askYesNo(rl, "Write these changes to the EDITH config now?", true)
      } finally {
        rl.close()
      }
    }

    if (shouldWrite) {
      // Deep-merge new config into existing edith.json
      const merged = deepMerge(existingJson, plan.jsonConfig ?? {})
      await writeEdithConfig(merged, configPath)
      console.log("")
      console.log(`Wrote ${configPath}`)
      console.log("")
      console.log("Your config is stored in edith.json when present, or edith.json for legacy compatibility.")
      console.log("No need to edit .env manually - EDITH reads config values directly.")
    } else {
      console.log("")
      console.log("Skipped writing EDITH config")
    }
  }

  console.log("")
  for (const line of buildNextSteps(plan)) {
    console.log(line)
  }
}

export const __onboardTestUtils = {
  parseOnboardArgs,
  mergeEnvContent,
  providerEnvKey,
  buildNextSteps,
  defaultNextStepCommands,
  parseEnvLineKey,
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
