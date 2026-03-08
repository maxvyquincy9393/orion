import fs from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { createLogger } from "../logger.js"

const log = createLogger("config.edith-config")

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
