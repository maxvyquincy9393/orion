import dotenv from "dotenv"
import { z } from "zod"

dotenv.config({ path: ".env" })

const boolFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "1" || normalized === "yes"
  }
  return false
}, z.boolean())

const intFromEnv = z.preprocess((value) => {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}, z.number().int())

const floatFromEnv = z.preprocess((value) => {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}, z.number())

const logLevelSchema = z.enum(["debug", "info", "warn", "error"])

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GROQ_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  DISCORD_BOT_TOKEN: z.string().default(""),
  DISCORD_CHANNEL_ID: z.string().default(""),
  SLACK_BOT_TOKEN: z.string().default(""),
  SLACK_APP_TOKEN: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  WHATSAPP_ENABLED: boolFromEnv.default(false),
  SIGNAL_PHONE_NUMBER: z.string().default(""),
  SIGNAL_CLI_PATH: z.string().default(""),
  LINE_CHANNEL_TOKEN: z.string().default(""),
  LINE_CHANNEL_SECRET: z.string().default(""),
  MATRIX_HOMESERVER: z.string().default(""),
  MATRIX_ACCESS_TOKEN: z.string().default(""),
  MATRIX_ROOM_ID: z.string().default(""),
  TEAMS_APP_ID: z.string().default(""),
  TEAMS_APP_PASSWORD: z.string().default(""),
  TEAMS_SERVICE_URL: z.string().default(""),
  BLUEBUBBLES_URL: z.string().default(""),
  BLUEBUBBLES_PASSWORD: z.string().default(""),
  WEBCHAT_PORT: intFromEnv.default(8080),
  DATABASE_URL: z.string().default("file:./orion.db"),
  DEFAULT_USER_ID: z.string().default("owner"),
  LOG_LEVEL: logLevelSchema.default("info"),
  CRITIQUE_ENABLED: boolFromEnv.default(true),
  CRITIQUE_THRESHOLD: floatFromEnv.default(0.75),
  PERMISSIONS_FILE: z.string().default("permissions/permissions.yaml"),
  VOICE_ENABLED: boolFromEnv.default(false),
  VISION_ENABLED: boolFromEnv.default(false),
  PYTHON_PATH: z.string().default("python"),
  GATEWAY_PORT: intFromEnv.default(18789),
  GATEWAY_HOST: z.string().default("127.0.0.1"),
  AUTO_START_GATEWAY: boolFromEnv.default(false),
})

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  console.error("[Orion Config Error] Invalid environment configuration.")
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".")
    console.error(`  - ${key}: ${issue.message}`)
  }
  process.exit(1)
}

export type Config = z.infer<typeof ConfigSchema>

export const config: Config = parsed.data

export function validateRequired(keys: Array<keyof Config>): void {
  const missing = keys.filter((key) => {
    const value = config[key]
    return typeof value === "string" ? value.trim().length === 0 : value === undefined
  })

  if (missing.length > 0) {
    console.error(
      `[Orion Config Error] Missing required environment variables: ${missing.join(", ")}`,
    )
    process.exit(1)
  }
}

export default config
