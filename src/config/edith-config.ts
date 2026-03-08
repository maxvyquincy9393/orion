/**
 * @file edith-config.ts
 * @description Loads, validates, and saves edith.json — the single source of truth for EDITH
 * configuration including credentials, features, channels, and identity.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Read at startup via loadEDITHConfig() before service init
 *   - mergeEdithJsonCredentials() in src/config.ts overlays credentials onto env-parsed config
 *   - Electron OOBE wizard writes to edith.json via IPC → main.js → saveEDITHConfig()
 *   - Desktop users never need .env; server/Docker users keep using .env normally (backward-compat)
 */
import fs from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { createLogger } from "../logger.js"

const log = createLogger("config.edith-config")

/** All API keys and secret tokens — written by OOBE wizard, read at startup. */
const CredentialsSchema = z.object({
  GROQ_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  OLLAMA_BASE_URL: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  DISCORD_BOT_TOKEN: z.string().default(""),
  DISCORD_CHANNEL_ID: z.string().default(""),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_CLOUD_VERIFY_TOKEN: z.string().default(""),
  GMAIL_CLIENT_ID: z.string().default(""),
  GMAIL_CLIENT_SECRET: z.string().default(""),
  GMAIL_REFRESH_TOKEN: z.string().default(""),
  GMAIL_USER_EMAIL: z.string().default(""),
  NOTION_API_KEY: z.string().default(""),
}).default({
  GROQ_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "",
  OPENROUTER_API_KEY: "", OLLAMA_BASE_URL: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "",
  DISCORD_BOT_TOKEN: "", DISCORD_CHANNEL_ID: "", WHATSAPP_CLOUD_ACCESS_TOKEN: "",
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: "", WHATSAPP_CLOUD_VERIFY_TOKEN: "",
  GMAIL_CLIENT_ID: "", GMAIL_CLIENT_SECRET: "", GMAIL_REFRESH_TOKEN: "",
  GMAIL_USER_EMAIL: "", NOTION_API_KEY: "",
})

export type CredentialsConfig = z.infer<typeof CredentialsSchema>

/** Feature flags — toggled in OOBE wizard and Settings page. */
const FeaturesSchema = z.object({
  voice: z.boolean().default(false),
  knowledgeBase: z.boolean().default(false),
  computerUse: z.boolean().default(true),
  email: z.boolean().default(false),
  calendar: z.boolean().default(false),
  sms: z.boolean().default(false),
}).default({ voice: false, knowledgeBase: false, computerUse: true, email: false, calendar: false, sms: false })

export type FeaturesConfig = z.infer<typeof FeaturesSchema>

const ChannelPolicySchema = z.enum(["pairing", "allowlist", "open"])

const ChannelConfigSchema = z
  .object({
    dmPolicy: ChannelPolicySchema.default("pairing"),
    allowFrom: z.array(z.string()).default([]),
    groupPolicy: ChannelPolicySchema.default("allowlist"),
    ackReaction: z.string().default("👀"),
  })
  .partial()

const AgentIdentitySchema = z.object({
  name: z.string().default("EDITH"),
  emoji: z.string().default("✦"),
  theme: z.string().default("dark minimal"),
})

const SkillConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    apiKey: z.string().optional(),
    env: z.record(z.string(), z.string()).default({}),
  })
  .partial()

const ComputerUseSchema = z.object({
  enabled: z.boolean().default(true),
  planner: z.enum(["lats", "dag"]).default("lats"),
  fallbackPlanner: z.enum(["dag"]).default("dag"),
  maxEpisodes: z.number().int().positive().default(30),
  maxStepsPerEpisode: z.number().int().positive().default(20),
  explorationConstant: z.number().positive().default(Math.SQRT2),
  expansionBranches: z.number().int().positive().default(3),
  taskTimeoutMs: z.number().int().positive().default(120000),
  browser: z.object({
    injectSetOfMark: z.boolean().default(true),
    maxElements: z.number().int().positive().default(50),
    pageTimeoutMs: z.number().int().positive().default(15000),
    headless: z.boolean().default(true),
  }).default({
    injectSetOfMark: true,
    maxElements: 50,
    pageTimeoutMs: 15000,
    headless: true,
  }),
  fileAgent: z.object({
    allowedPaths: z.array(z.string()).default(["./workspace", "./workbenches"]),
    maxFileSizeMb: z.number().positive().default(10),
    allowWrite: z.boolean().default(true),
  }).default({
    allowedPaths: ["./workspace", "./workbenches"],
    maxFileSizeMb: 10,
    allowWrite: true,
  }),
}).default({
  enabled: true,
  planner: "lats",
  fallbackPlanner: "dag",
  maxEpisodes: 30,
  maxStepsPerEpisode: 20,
  explorationConstant: Math.SQRT2,
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
})

// App behavior configuration
const AppConfigSchema = z.object({
  minimizeToTray: z.boolean().default(true),
  autoLaunch: z.boolean().default(false),
  showTrayNotifications: z.boolean().default(true),
  startMinimized: z.boolean().default(false),
}).default({ minimizeToTray: true, autoLaunch: false, showTrayNotifications: true, startMinimized: false })

// Telemetry (OFF by default — privacy first)
const TelemetrySchema = z.object({
  enabled: z.boolean().default(false),
  crashReporting: z.boolean().default(false),
  endpoint: z.string().default(""),
}).default({ enabled: false, crashReporting: false, endpoint: "" })

// Auto-updater configuration
const UpdateSchema = z.object({
  autoCheck: z.boolean().default(true),
  autoDownload: z.boolean().default(true),
  provider: z.enum(["github", "generic"]).default("github"),
  url: z.string().default(""),
}).default({ autoCheck: true, autoDownload: true, provider: "github", url: "" })

// Knowledge base sources configuration (Phase 13 integration)
const KnowledgeBaseSchema = z.object({
  enabled: z.boolean().default(false),
  obsidian: z.object({
    enabled: z.boolean().default(false),
    vaultPath: z.string().default(""),
    syncIntervalMs: z.number().default(300_000),
  }).default({ enabled: false, vaultPath: "", syncIntervalMs: 300_000 }),
  notion: z.object({
    enabled: z.boolean().default(false),
    syncIntervalMs: z.number().default(3_600_000),
    databaseIds: z.array(z.string()).default([]),
  }).default({ enabled: false, syncIntervalMs: 3_600_000, databaseIds: [] }),
  bookmarks: z.object({
    enabled: z.boolean().default(false),
    jsonPath: z.string().default(""),
  }).default({ enabled: false, jsonPath: "" }),
}).default({ enabled: false, obsidian: { enabled: false, vaultPath: "", syncIntervalMs: 300_000 }, notion: { enabled: false, syncIntervalMs: 3_600_000, databaseIds: [] }, bookmarks: { enabled: false, jsonPath: "" } })

const EDITHConfigSchema = z.object({
  identity: AgentIdentitySchema.default({
    name: "EDITH",
    emoji: "✦",
    theme: "dark minimal",
  }),

  agents: z
    .object({
      defaults: z
        .object({
          model: z
            .object({
              primary: z.string().default("groq/llama-3.3-70b-versatile"),
              fallbacks: z.array(z.string()).default([]),
            })
            .default({
              primary: "groq/llama-3.3-70b-versatile",
              fallbacks: [],
            }),
          workspace: z.string().default("./workspace"),
          bootstrapMaxChars: z.number().default(65536),
          bootstrapTotalMaxChars: z.number().default(100000),
        })
        .default({
          model: {
            primary: "groq/llama-3.3-70b-versatile",
            fallbacks: [],
          },
          workspace: "./workspace",
          bootstrapMaxChars: 65536,
          bootstrapTotalMaxChars: 100000,
        }),
    })
    .default({
      defaults: {
        model: {
          primary: "groq/llama-3.3-70b-versatile",
          fallbacks: [],
        },
        workspace: "./workspace",
        bootstrapMaxChars: 65536,
        bootstrapTotalMaxChars: 100000,
      },
    }),

  channels: z
    .object({
      whatsapp: ChannelConfigSchema.default({}),
      telegram: ChannelConfigSchema.default({}),
      discord: ChannelConfigSchema.default({}),
      signal: ChannelConfigSchema.default({}),
      slack: ChannelConfigSchema.default({}),
    })
    .default({
      whatsapp: {},
      telegram: {},
      discord: {},
      signal: {},
      slack: {},
    }),

  skills: z
    .object({
      allowBundled: z.array(z.string()).default([]),
      load: z
        .object({
          extraDirs: z.array(z.string()).default([]),
          watch: z.boolean().default(false),
        })
        .default({
          extraDirs: [],
          watch: false,
        }),
      entries: z.record(z.string(), SkillConfigSchema).default({}),
    })
    .default({
      allowBundled: [],
      load: {
        extraDirs: [],
        watch: false,
      },
      entries: {},
    }),
  computerUse: ComputerUseSchema,
  app: AppConfigSchema,
  telemetry: TelemetrySchema,
  update: UpdateSchema,
  knowledgeBase: KnowledgeBaseSchema,
  credentials: CredentialsSchema,
  features: FeaturesSchema,
})

export type EDITHConfig = z.infer<typeof EDITHConfigSchema>

let cachedConfig: EDITHConfig | null = null

export async function loadEDITHConfig(): Promise<EDITHConfig> {
  if (cachedConfig) {
    return cachedConfig
  }

  const configPath = path.resolve(process.cwd(), "edith.json")

  try {
    const raw = await fs.readFile(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    cachedConfig = EDITHConfigSchema.parse(parsed)
    log.info("edith.json loaded", { workspace: cachedConfig.agents.defaults.workspace })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log.info("edith.json not found, using defaults")
    } else {
      log.warn("edith.json parse error, using defaults", error)
    }
    cachedConfig = EDITHConfigSchema.parse({})
  }

  return cachedConfig
}

export function getEDITHConfig(): EDITHConfig {
  if (!cachedConfig) {
    throw new Error("Config not loaded - call loadEDITHConfig() first")
  }

  return cachedConfig
}

/**
 * Reset the cached config — used in tests to ensure a fresh parse on each test.
 */
export function resetEDITHConfigCache(): void {
  cachedConfig = null
}

/**
 * Persist a partial update to edith.json and invalidate the cache.
 * Merges deeply into the existing file so unrelated sections are preserved.
 * @param partial - Partial EDITHConfig fields to merge into edith.json
 */
export async function saveEDITHConfig(partial: Partial<EDITHConfig>): Promise<void> {
  const configPath = path.resolve(process.cwd(), "edith.json")
  let existing: Record<string, unknown> = {}
  try {
    const raw = await fs.readFile(configPath, "utf-8")
    existing = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // File doesn't exist yet — start fresh
  }

  // Deep merge: for each top-level key in partial, merge objects; overwrite primitives
  for (const [key, value] of Object.entries(partial)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof existing[key] === "object" && existing[key] !== null) {
      existing[key] = { ...(existing[key] as Record<string, unknown>), ...(value as Record<string, unknown>) }
    } else {
      existing[key] = value
    }
  }

  await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8")
  // Invalidate cache so next loadEDITHConfig() re-reads the file
  cachedConfig = null
  log.info("edith.json saved")
}

/**
 * Get a single credential value from the loaded edith.json config.
 * Falls back to empty string if config not yet loaded or key is absent.
 * @param key - Key from CredentialsConfig
 * @returns Credential string value, or empty string
 */
export function getCredential(key: keyof CredentialsConfig): string {
  return cachedConfig?.credentials?.[key] ?? ""
}
