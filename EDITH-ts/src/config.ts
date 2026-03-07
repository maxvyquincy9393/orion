import dotenv from "dotenv"
import { z } from "zod"

const envFilePath = typeof process.env.EDITH_ENV_FILE === "string" && process.env.EDITH_ENV_FILE.trim().length > 0
  ? process.env.EDITH_ENV_FILE.trim()
  : typeof process.env.EDITH_ENV_FILE === "string" && process.env.EDITH_ENV_FILE.trim().length > 0
  ? process.env.EDITH_ENV_FILE.trim()
  : ".env"

dotenv.config({ path: envFilePath })

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
const logFormatSchema = z.enum(["text", "json"])
const whatsAppModeSchema = z.enum(["baileys", "cloud"])

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
  WHATSAPP_MODE: whatsAppModeSchema.default("baileys"),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_CLOUD_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_CLOUD_ALLOWED_WA_IDS: z.string().default(""),
  WHATSAPP_CLOUD_API_VERSION: z.string().default("v20.0"),
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
  DATABASE_URL: z.string().default("file:./edith.db"),
  DEFAULT_USER_ID: z.string().default("owner"),
  LOG_LEVEL: logLevelSchema.default("info"),
  LOG_FORMAT: logFormatSchema.default("text"),
  LOG_FILE_MAX_SIZE_MB: intFromEnv.default(10),
  LOG_FILE_MAX_FILES: intFromEnv.default(5),
  PERSONA_ENABLED: boolFromEnv.default(true),
  CRITIQUE_ENABLED: boolFromEnv.default(true),
  CRITIQUE_THRESHOLD: floatFromEnv.default(0.75),
  MEMRL_ALPHA: floatFromEnv.default(0.1),
  MEMRL_GAMMA: floatFromEnv.default(0.9),
  MEMRL_SIMILARITY_THRESHOLD: floatFromEnv.default(0.3),
  MEMRL_EXPERIENCE_REPLAY_ENABLED: boolFromEnv.default(false),
  MEMRL_REPLAY_BUFFER_SIZE: intFromEnv.default(256),
  MEMRL_REPLAY_BATCH_SIZE: intFromEnv.default(16),
  MEMRL_TD_LAMBDA_ENABLED: boolFromEnv.default(false),
  MEMRL_TD_LAMBDA_TRACE_DECAY: floatFromEnv.default(0.9),
  PERMISSIONS_FILE: z.string().default("permissions/permissions.yaml"),
  VOICE_ENABLED: boolFromEnv.default(true),  // Edge TTS needs zero setup
  VISION_ENABLED: boolFromEnv.default(false),
  PYTHON_PATH: z.string().default("python"),
  GATEWAY_PORT: intFromEnv.default(18789),
  GATEWAY_HOST: z.string().default("127.0.0.1"),
  AUTO_START_GATEWAY: boolFromEnv.default(false),
  // Email configuration (T-1.3)
  EMAIL_HOST: z.string().default(""),
  EMAIL_PORT: z.string().default("993"),
  EMAIL_USER: z.string().default(""),
  EMAIL_PASS: z.string().default(""),
  EMAIL_SMTP_HOST: z.string().default(""),
  EMAIL_SMTP_PORT: z.string().default("587"),
  // Vision configuration (T-1.7)
  VISION_ENGINE: z.string().default("gemini"),
  // Voice configuration (T-3)
  VOICE_WHISPER_MODEL: z.string().default("base"),
  // Phase 11: EDITH Voice — native TypeScript TTS
  VOICE_TTS_BACKEND: z.string().default("edge"),           // "edge" | "python"
  VOICE_EDGE_VOICE: z.string().default("en-US-GuyNeural"), // Edge TTS neural voice
  VOICE_EDGE_RATE: z.string().default("-8%"),               // EDITH measured cadence
  VOICE_EDGE_PITCH: z.string().default("-5Hz"),             // Slightly deeper
  VOICE_DSP_ENABLED: boolFromEnv.default(true),            // Apply EDITH DSP
  VOICE_DSP_PRESET: z.string().default("tars"),            // "tars" | "clean"
  // Phase I-0: Hybrid Search
  HYBRID_SEARCH_ENABLED: boolFromEnv.default(true),
  HYBRID_HYDE_ENABLED: boolFromEnv.default(false),
  HYBRID_RERANK_ENABLED: boolFromEnv.default(false),
  // Phase I-1: VoI Chat Gating
  VOI_CHAT_ENABLED: boolFromEnv.default(true),
  VOICE_PROFILE: z.string().default("default"),
  VOICE_LANGUAGE: z.string().default(""),
  // Channel Send permission (T-1.6)
  ALLOW_PROACTIVE_CHANNEL_SEND: boolFromEnv.default(false),
  // Daemon trigger controls
  DAEMON_TRIGGER_COOLDOWN_MINUTES: intFromEnv.default(30),
  DAEMON_TRIGGER_DEDUP_ENABLED: boolFromEnv.default(true),
  // Phase I-3: Session Compaction
  SESSION_COMPACTION_ENABLED: boolFromEnv.default(true),
  SESSION_CONTEXT_WINDOW_TOKENS: intFromEnv.default(32_000),
  // Phase I-4: Engine Stats
  ENGINE_STATS_ENABLED: boolFromEnv.default(true),
  ORCHESTRATOR_COST_ROUTING_ENABLED: boolFromEnv.default(false),
  CAUSAL_BAYESIAN_UPDATE_ENABLED: boolFromEnv.default(false),
  CAUSAL_EDGE_DECAY_ENABLED: boolFromEnv.default(true),
  HIMES_FORGETTING_CURVE_ENABLED: boolFromEnv.default(false),
  HIMES_CONSOLIDATION_ENABLED: boolFromEnv.default(false),
  HIMES_TOKEN_BUDGET_ENABLED: boolFromEnv.default(true),
  // Admin & Gateway
  ADMIN_TOKEN: z.string().default(""),
  GATEWAY_CORS_ORIGINS: z.string().default(""),
  // Observability
  OTEL_ENABLED: boolFromEnv.default(false),
  OTEL_SERVICE_NAME: z.string().default("EDITH-ts"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default("http://127.0.0.1:4318/v1/traces"),
  METRICS_ENABLED: boolFromEnv.default(true),
  METRICS_PREFIX: z.string().default("edith_"),
  // Supervisor / Agent limits
  AGENT_TIMEOUT_MS: intFromEnv.default(120_000),
  AGENT_MAX_SUBTASKS: intFromEnv.default(8),
  AGENT_MAX_LLM_CALLS: intFromEnv.default(40),
  LATS_EARLY_STOP_THRESHOLD: floatFromEnv.default(0.95),
  SHUTDOWN_TIMEOUT_MS: intFromEnv.default(10_000),
  // Phase H: OS-Agent / EDITH mode
  OS_AGENT_ENABLED: boolFromEnv.default(false),
  EDITH_MODE: boolFromEnv.default(false),
  HOME_ASSISTANT_URL: z.string().default(""),
  HOME_ASSISTANT_TOKEN: z.string().default(""),
})

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  console.error("[EDITH Config Error] Invalid environment configuration.")
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".")
    console.error(`  - ${key}: ${issue.message}`)
  }
  process.exit(1)
}

export type Config = z.infer<typeof ConfigSchema>

export const config: Config = parsed.data

export class ConfigValidationError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`[EDITH Config] Missing required variables: ${missingKeys.join(", ")}`)
    this.name = "ConfigValidationError"
  }
}

export function validateRequired(keys: Array<keyof Config>): void {
  const missing = keys.filter((key) => {
    const value = config[key]
    return typeof value === "string" ? value.trim().length === 0 : value === undefined
  })

  if (missing.length > 0) {
    throw new ConfigValidationError(missing.map(String))
  }
}

export default config

