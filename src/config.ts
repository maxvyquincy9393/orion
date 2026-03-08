import dotenv from "dotenv"
import { z } from "zod"

const envFilePath = typeof process.env.EDITH_ENV_FILE === "string" && process.env.EDITH_ENV_FILE.trim().length > 0
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
  PERSONA_ENABLED: boolFromEnv.default(true),
  CRITIQUE_ENABLED: boolFromEnv.default(true),
  CRITIQUE_THRESHOLD: floatFromEnv.default(0.75),
  MEMRL_ALPHA: floatFromEnv.default(0.1),
  MEMRL_GAMMA: floatFromEnv.default(0.9),
  MEMRL_SIMILARITY_THRESHOLD: floatFromEnv.default(0.3),
  PERMISSIONS_FILE: z.string().default("permissions/permissions.yaml"),
  VOICE_ENABLED: boolFromEnv.default(false),
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
  // Phase I-0: Hybrid Search
  HYBRID_SEARCH_ENABLED: boolFromEnv.default(true),
  // Phase I-1: VoI Chat Gating
  VOI_CHAT_ENABLED: boolFromEnv.default(true),
  VOICE_PROFILE: z.string().default("default"),
  VOICE_LANGUAGE: z.string().default(""),
  // Channel Send permission (T-1.6)
  ALLOW_PROACTIVE_CHANNEL_SEND: boolFromEnv.default(false),
  // Phase I-3: Session Compaction
  SESSION_COMPACTION_ENABLED: boolFromEnv.default(true),
  SESSION_CONTEXT_WINDOW_TOKENS: intFromEnv.default(32_000),
  // Phase I-4: Engine Stats
  ENGINE_STATS_ENABLED: boolFromEnv.default(true),
  // Phase 8: Email (Gmail + Outlook OAuth2)
  GMAIL_CLIENT_ID: z.string().default(""),
  GMAIL_CLIENT_SECRET: z.string().default(""),
  GMAIL_REFRESH_TOKEN: z.string().default(""),
  GMAIL_USER_EMAIL: z.string().default(""),
  OUTLOOK_CLIENT_ID: z.string().default(""),
  OUTLOOK_CLIENT_SECRET: z.string().default(""),
  OUTLOOK_REFRESH_TOKEN: z.string().default(""),
  // Phase 8: Calendar (Google + Outlook OAuth2)
  GCAL_CLIENT_ID: z.string().default(""),
  GCAL_CLIENT_SECRET: z.string().default(""),
  GCAL_REFRESH_TOKEN: z.string().default(""),
  OUTLOOK_CALENDAR_CLIENT_ID: z.string().default(""),
  OUTLOOK_CALENDAR_CLIENT_SECRET: z.string().default(""),
  OUTLOOK_CALENDAR_REFRESH_TOKEN: z.string().default(""),
  // Phase 8: SMS (Twilio + Android ADB)
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_PHONE_NUMBER: z.string().default(""),
  // Phase 8: Phone (Twilio Voice)
  TWILIO_TWIML_APP_SID: z.string().default(""),
  PHONE_WEBHOOK_URL: z.string().default(""),
  // Phase 8: Android ADB (self-hosted SMS fallback)
  ANDROID_ADB_HOST: z.string().default("127.0.0.1"),
  ANDROID_ADB_PORT: intFromEnv.default(5037),
  // Phase 8: Channel-specific security admin token (derived from ADMIN_TOKEN if exists)
  ADMIN_TOKEN: z.string().default(""),
  // Phase 9: Offline / Self-Hosted Mode
  // OfflineCoordinator health check intervals
  OFFLINE_HEALTH_CHECK_INTERVAL_MS: intFromEnv.default(30_000),
  OFFLINE_HEALTH_CHECK_INTERVAL_OFFLINE_MS: intFromEnv.default(60_000),
  // Local embeddings via @xenova/transformers
  LOCAL_EMBEDDER_ENABLED: boolFromEnv.default(false),
  LOCAL_EMBEDDER_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  LOCAL_EMBEDDER_CACHE_DIR: z.string().default("./models/embeddings"),
  // Kokoro.js offline TTS
  KOKORO_TTS_ENABLED: boolFromEnv.default(false),
  KOKORO_TTS_DTYPE: z.enum(["fp32", "fp16", "q8", "q4"]).default("q8"),
  KOKORO_TTS_VOICE: z.string().default("af_heart"),
  // nodejs-whisper offline STT
  WHISPER_CPP_ENABLED: boolFromEnv.default(false),
  WHISPER_CPP_MODEL: z.string().default("base"),
  // Phase 10: Personalization
  // UserPreferenceEngine inference
  PERSONALIZATION_ENABLED: boolFromEnv.default(true),
  PREFERENCE_INFERENCE_INTERVAL_MS: intFromEnv.default(5 * 60 * 1000), // every 5 min
  PREFERENCE_ALPHA: floatFromEnv.default(0.15),  // learning rate for slider updates
  // PersonalityEngine
  DEFAULT_TONE_PRESET: z.enum(["jarvis", "friday", "cortana", "hal", "custom"]).default("jarvis"),
  DEFAULT_TITLE_WORD: z.string().default("Sir"),
  // HabitModel
  HABIT_MODEL_ENABLED: boolFromEnv.default(true),
  HABIT_MODEL_UPDATE_INTERVAL_MS: intFromEnv.default(60 * 60 * 1000), // every 1h
  // Speaker ID (Resemblyzer Python sidecar)
  SPEAKER_ID_ENABLED: boolFromEnv.default(false),
  SPEAKER_ID_CONFIDENCE_THRESHOLD: floatFromEnv.default(0.75),
  // Phase 11: Multi-Agent Orchestration
  AGENT_MAX_CONCURRENT: intFromEnv.default(5),
  SKILL_MARKETPLACE_ENABLED: boolFromEnv.default(true),
  // Phase 13: Knowledge Base
  KNOWLEDGE_BASE_ENABLED: boolFromEnv.default(false),
  NOTION_API_KEY: z.string().default(""),
  NOTION_DATABASE_IDS: z.string().default(""),
  OBSIDIAN_VAULT_PATH: z.string().default(""),
  OCR_ENABLED: boolFromEnv.default(false),
  // Phase 14: Calendar extended config
  GCAL_TIMEZONE: z.string().default("Asia/Jakarta"),
  GCAL_CALENDARS: z.string().default("primary"),
  CALENDAR_ALERT_MINUTES: intFromEnv.default(15),
  ICAL_FEED_URLS: z.string().default(""),
  // Phase 15: Browser Agent config
  BROWSER_SESSION_DIR: z.string().default(".edith/browser-sessions"),
  BROWSER_MAX_TABS: intFromEnv.default(5),
  BROWSER_HEADLESS: boolFromEnv.default(true),
  // Phase 16: Mobile push notification config
  EXPO_PUSH_ACCESS_TOKEN: z.string().default(""),
  FCM_PROJECT_ID: z.string().default(""),
  FCM_CLIENT_EMAIL: z.string().default(""),
  FCM_PRIVATE_KEY: z.string().default(""),
  PUSH_QUIET_HOURS_START: z.string().default("23:00"),
  PUSH_QUIET_HOURS_END: z.string().default("07:00"),
  PUSH_MAX_DAILY_LOW_PRIORITY: intFromEnv.default(10),
  PUSH_DRY_RUN: boolFromEnv.default(false),
  // Phase 17: Privacy Vault & Security Layer
  VAULT_ENABLED: boolFromEnv.default(true),
  VAULT_PATH: z.string().default(".edith/vault.enc"),
  VAULT_AUTO_LOCK_MS: intFromEnv.default(30 * 60 * 1000), // 30 min
  VAULT_AUDIT_LOG_PATH: z.string().default(".edith/audit.jsonl"),
  // Phase 18: Social & Relationship Memory
  PEOPLE_GRAPH_ENABLED: boolFromEnv.default(true),
  PEOPLE_EXTRACTION_ENABLED: boolFromEnv.default(true),
  DORMANT_CONTACT_DAYS: intFromEnv.default(90),
  // Phase 19: Dev & Code Assistant
  DEV_MODE_ENABLED: boolFromEnv.default(false),
  GIT_COMMIT_AUTO_STAGE: boolFromEnv.default(false),
  // Phase 20: HUD Overlay
  HUD_ENABLED: boolFromEnv.default(false),
  HUD_POSITION: z.enum(["top-right", "top-left", "bottom-right", "bottom-left"]).default("top-right"),
  HUD_WIDTH: intFromEnv.default(360),
  HUD_OPACITY: floatFromEnv.default(0.9),
  HUD_CLICK_THROUGH: boolFromEnv.default(true),
  HUD_HOTKEY: z.string().default("Ctrl+Shift+E"),
  HUD_THEME: z.enum(["arc-reactor", "minimal", "stealth"]).default("arc-reactor"),
  HUD_CARD_TTL_MS: intFromEnv.default(30_000),
  HUD_MAX_NOTIFICATIONS: intFromEnv.default(5),
  // Phase 21: Emotional Intelligence
  EMOTION_ENABLED: boolFromEnv.default(true),
  EMOTION_WINDOW_SIZE: intFromEnv.default(10),
  EMOTION_SESSION_TTL_MS: intFromEnv.default(4 * 60 * 60 * 1000), // 4 hours
  EMOTION_WELLNESS_ENABLED: boolFromEnv.default(true),
  EMOTION_STRESS_THRESHOLD: floatFromEnv.default(0.65),
  EMOTION_BURNOUT_HOURS: intFromEnv.default(4),
  // Phase 22: Autonomous Mission
  MISSION_ENABLED: boolFromEnv.default(true),
  MISSION_TOKEN_BUDGET: intFromEnv.default(200_000),
  MISSION_TIME_BUDGET_MS: intFromEnv.default(4 * 60 * 60 * 1000), // 4 hours
  MISSION_API_CALL_BUDGET: intFromEnv.default(500),
  MISSION_CHECKPOINT_INTERVAL_MS: intFromEnv.default(15 * 60 * 1000), // 15 min
  MISSION_DEAD_MAN_SWITCH_MS: intFromEnv.default(30 * 60 * 1000), // 30 min
  MISSION_MAX_RETRIES: intFromEnv.default(3),
  MISSION_MAX_CONCURRENT: intFromEnv.default(2),
  // Phase 23: Hardware Bridge
  HARDWARE_ENABLED: boolFromEnv.default(false),
  HARDWARE_SCAN_ON_STARTUP: boolFromEnv.default(true),
  HARDWARE_SERIAL_BAUD_RATE: intFromEnv.default(115200),
  HARDWARE_MQTT_BROKER: z.string().default(""),
  HARDWARE_MQTT_PORT: intFromEnv.default(1883),
  HARDWARE_BLE_ENABLED: boolFromEnv.default(false),
  HARDWARE_DDC_ENABLED: boolFromEnv.default(false),
  HARDWARE_OCTOPRINT_URL: z.string().default(""),
  HARDWARE_OCTOPRINT_API_KEY: z.string().default(""),
  // Phase 24: Self-Improvement
  SELF_IMPROVEMENT_ENABLED: boolFromEnv.default(true),
  SELF_IMPROVEMENT_ANALYSIS_INTERVAL_MS: intFromEnv.default(7 * 24 * 60 * 60 * 1000), // weekly
  SELF_IMPROVEMENT_AUTO_APPLY_THRESHOLD: floatFromEnv.default(0.8),
  SELF_IMPROVEMENT_MAX_PROMPT_VERSIONS: intFromEnv.default(30),
  SELF_IMPROVEMENT_SKILL_UNUSED_DAYS: intFromEnv.default(60),
  // Phase 25: Digital Twin / Simulation
  SIMULATION_ENABLED: boolFromEnv.default(true),
  SIMULATION_SNAPSHOT_MAX: intFromEnv.default(50),
  SIMULATION_SNAPSHOT_TTL_DAYS: intFromEnv.default(7),
  SIMULATION_AUTO_PREVIEW_DESTRUCTIVE: boolFromEnv.default(true),
  SIMULATION_SANDBOX_ENABLED: boolFromEnv.default(false),
  // Phase 26: Iron Legion (Multi-Instance)
  LEGION_ENABLED: boolFromEnv.default(false),
  LEGION_ROLE: z.enum(["primary", "research", "code", "comm", "custom"]).default("primary"),
  LEGION_INSTANCE_ID: z.string().default("edith-primary"),
  LEGION_AUTH_SECRET: z.string().default(""),
  LEGION_PEER_URLS: z.string().default(""),
  LEGION_SYNC_INTERVAL_MS: intFromEnv.default(5_000),
  // Phase 27: Cross-Device Mesh
  CROSS_DEVICE_ENABLED: boolFromEnv.default(false),
  CROSS_DEVICE_SYNC_URL: z.string().default(""),
  CROSS_DEVICE_DEVICE_ID: z.string().default(""),
  CROSS_DEVICE_SYNC_INTERVAL_MS: intFromEnv.default(3_000),
  CROSS_DEVICE_PRESENCE_TTL_MS: intFromEnv.default(30_000),
  CROSS_DEVICE_SYNC_ENCRYPTION_KEY: z.string().default(""),
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

export function validateRequired(keys: Array<keyof Config>): void {
  const missing = keys.filter((key) => {
    const value = config[key]
    return typeof value === "string" ? value.trim().length === 0 : value === undefined
  })

  if (missing.length > 0) {
    console.error(
      `[EDITH Config Error] Missing required environment variables: ${missing.join(", ")}`,
    )
    process.exit(1)
  }
}

/**
 * Merge credentials from edith.json into the runtime config object.
 * Called once at startup (before orchestrator.init) so desktop users
 * never need to touch .env.  Server/Docker users continue using .env as normal.
 *
 * Priority: edith.json credentials > .env / system env (already in `config`)
 */
export async function mergeEdithJsonCredentials(): Promise<void> {
  try {
    // Dynamic import avoids a potential circular dependency at module load time
    const { loadEDITHConfig } = await import("./config/edith-config.js")
    const edithConfig = await loadEDITHConfig()

    const creds = edithConfig.credentials
    const configAsMutable = config as Record<string, unknown>

    // Override each credential only when edith.json provides a non-empty value
    for (const [key, value] of Object.entries(creds)) {
      if (typeof value === "string" && value.trim() !== "" && key in configAsMutable) {
        configAsMutable[key] = value
      }
    }

    // Override feature flags from edith.json features section
    const features = edithConfig.features
    if (features.voice !== undefined) config.VOICE_ENABLED = features.voice
    if (features.knowledgeBase !== undefined) config.KNOWLEDGE_BASE_ENABLED = features.knowledgeBase
    if (features.computerUse !== undefined) config.VISION_ENABLED = features.computerUse

  } catch {
    // Silent fallback — let .env values stand
  }
}

export default config
