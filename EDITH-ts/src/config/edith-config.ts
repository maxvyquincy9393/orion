import fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"

import { z } from "zod"

import { createLogger } from "../logger.js"

const log = createLogger("config.edith-config")

const ChannelPolicySchema = z.enum(["pairing", "allowlist", "open"])

/**
 * Tokens/keys live directly in the JSON config alongside policy fields.
 */
const ChannelConfigSchema = z
  .object({
    dmPolicy: ChannelPolicySchema.default("pairing"),
    allowFrom: z.array(z.string()).default([]),
    groupPolicy: ChannelPolicySchema.default("allowlist"),
    ackReaction: z.string().default("👀"),
    // Channel-specific tokens 
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    channelId: z.string().optional(),
    appToken: z.string().optional(),
    // WhatsApp-specific
    enabled: z.boolean().optional(),
    mode: z.enum(["baileys", "cloud"]).optional(),
    accessToken: z.string().optional(),
    phoneNumberId: z.string().optional(),
    verifyToken: z.string().optional(),
    allowedWaIds: z.string().optional(),
    apiVersion: z.string().optional(),
    // Signal-specific
    phoneNumber: z.string().optional(),
    cliPath: z.string().optional(),
    // LINE-specific
    channelToken: z.string().optional(),
    channelSecret: z.string().optional(),
    // Matrix-specific
    homeserver: z.string().optional(),
    roomId: z.string().optional(),
    // Teams-specific
    appId: z.string().optional(),
    appPassword: z.string().optional(),
    serviceUrl: z.string().optional(),
    // BlueBubbles-specific
    serverUrl: z.string().optional(),
    password: z.string().optional(),
    // Generic token field (for discord, etc.)
    token: z.string().optional(),
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


const EnvSectionSchema = z.record(z.string(), z.string()).default({})

// ── OS-Agent Configuration Schemas (Phase H) ──

const GUIConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    backend: z.enum(["native", "nutjs", "robotjs"]).default("native"),
    screenshotMethod: z.enum(["native", "puppeteer"]).default("native"),
    requireConfirmation: z.boolean().default(true),
    maxActionsPerMinute: z.number().default(30),
  })
  .default({
    enabled: false,
    backend: "native",
    screenshotMethod: "native",
    requireConfirmation: true,
    maxActionsPerMinute: 30,
  })

const VisionConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    ocrEngine: z.enum(["tesseract", "cloud"]).default("tesseract"),
    elementDetection: z.enum(["accessibility", "yolo", "omniparser"]).default("accessibility"),
    multimodalEngine: z.enum(["gemini", "openai", "anthropic", "ollama"]).default("gemini"),
    monitorIntervalMs: z.number().default(5000),
  })
  .default({
    enabled: false,
    ocrEngine: "tesseract",
    elementDetection: "accessibility",
    multimodalEngine: "gemini",
    monitorIntervalMs: 5000,
  })

const VoiceIOConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    wakeWord: z.string().default("hey-edith"),
    wakeWordModelPath: z.string().optional(),
    wakeWordEngine: z.enum(["porcupine", "openwakeword"]).default("openwakeword"),
    sttEngine: z.enum(["whisper-local", "deepgram", "google", "azure"]).default("whisper-local"),
    vadEngine: z.enum(["silero", "webrtc"]).default("silero"),
    whisperModel: z.enum(["tiny", "base", "small", "medium", "large"]).default("base"),
    fullDuplex: z.boolean().default(true),
    language: z.string().default("en"),
  })
  .default({
    enabled: false,
    wakeWord: "hey-edith",
    wakeWordEngine: "openwakeword",
    sttEngine: "whisper-local",
    vadEngine: "silero",
    whisperModel: "base",
    fullDuplex: true,
    language: "en",
  })

const VoiceConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    mode: z.enum(["push-to-talk", "always-on"]).default("push-to-talk"),
    stt: z
      .object({
        engine: z.enum(["auto", "python-whisper", "deepgram"]).default("auto"),
        language: z.enum(["auto", "id", "en", "multi"]).default("auto"),
        whisperModel: z.enum(["tiny", "base", "small", "medium", "large"]).default("base"),
        providers: z
          .object({
            deepgram: z
              .object({
                apiKey: z.string().optional(),
              })
              .default({}),
          })
          .default({
            deepgram: {},
          }),
      })
      .default({
        engine: "auto",
        language: "auto",
        whisperModel: "base",
        providers: {
          deepgram: {},
        },
      }),
    tts: z
      .object({
        engine: z.enum(["edge"]).default("edge"),
        voice: z.string().default("en-US-GuyNeural"),
      })
      .default({
        engine: "edge",
        voice: "en-US-GuyNeural",
      }),
    wake: z
      .object({
        engine: z.enum(["porcupine", "openwakeword"]).default("openwakeword"),
        keyword: z.string().default("hey-edith"),
        modelPath: z.string().optional(),
        providers: z
          .object({
            picovoice: z
              .object({
                accessKey: z.string().optional(),
              })
              .default({}),
          })
          .default({
            picovoice: {},
          }),
      })
      .default({
        engine: "openwakeword",
        keyword: "hey-edith",
        modelPath: undefined,
        providers: {
          picovoice: {},
        },
      }),
    vad: z
      .object({
        engine: z.enum(["cobra", "silero", "webrtc"]).default("silero"),
      })
      .default({
        engine: "silero",
      }),
  })
  .default({
    enabled: true,
    mode: "push-to-talk",
    stt: {
      engine: "auto",
      language: "auto",
      whisperModel: "base",
      providers: {
        deepgram: {},
      },
    },
    tts: {
      engine: "edge",
      voice: "en-US-GuyNeural",
    },
    wake: {
      engine: "openwakeword",
      keyword: "hey-edith",
      modelPath: undefined,
      providers: {
        picovoice: {},
      },
    },
    vad: {
      engine: "silero",
    },
  })

const SystemConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    watchPaths: z.array(z.string()).default([]),
    watchClipboard: z.boolean().default(false),
    watchActiveWindow: z.boolean().default(true),
    resourceCheckIntervalMs: z.number().default(10_000),
    cpuWarningThreshold: z.number().default(90),
    ramWarningThreshold: z.number().default(85),
    diskWarningThreshold: z.number().default(90),
  })
  .default({
    enabled: true,
    watchPaths: [],
    watchClipboard: false,
    watchActiveWindow: true,
    resourceCheckIntervalMs: 10_000,
    cpuWarningThreshold: 90,
    ramWarningThreshold: 85,
    diskWarningThreshold: 90,
  })

const IoTConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    homeAssistantUrl: z.string().optional(),
    homeAssistantToken: z.string().optional(),
    mqttBrokerUrl: z.string().optional(),
    mqttUsername: z.string().optional(),
    mqttPassword: z.string().optional(),
    autoDiscover: z.boolean().default(true),
  })
  .default({
    enabled: false,
    autoDiscover: true,
  })

const OSAgentConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    gui: GUIConfigSchema,
    vision: VisionConfigSchema,
    voice: VoiceIOConfigSchema,
    system: SystemConfigSchema,
    iot: IoTConfigSchema,
    perceptionIntervalMs: z.number().default(2000),
  })
  .default({
    enabled: false,
    gui: {
      enabled: false,
      backend: "native",
      screenshotMethod: "native",
      requireConfirmation: true,
      maxActionsPerMinute: 30,
    },
    vision: {
      enabled: false,
      ocrEngine: "tesseract",
      elementDetection: "accessibility",
      multimodalEngine: "gemini",
      monitorIntervalMs: 5000,
    },
    voice: {
      enabled: false,
      wakeWord: "hey-edith",
      wakeWordEngine: "openwakeword",
      sttEngine: "whisper-local",
      vadEngine: "silero",
      whisperModel: "base",
      fullDuplex: true,
      language: "en",
    },
    system: {
      enabled: true,
      watchPaths: [],
      watchClipboard: false,
      watchActiveWindow: true,
      resourceCheckIntervalMs: 10_000,
      cpuWarningThreshold: 90,
      ramWarningThreshold: 85,
      diskWarningThreshold: 90,
    },
    iot: {
      enabled: false,
      autoDiscover: true,
    },
    perceptionIntervalMs: 2000,
  })

const EdithConfigSchema = z.object({
  /** Env-var overrides — injected into process.env before dotenv runs */
  env: EnvSectionSchema,

  voice: VoiceConfigSchema,

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
      line: ChannelConfigSchema.default({}),
      matrix: ChannelConfigSchema.default({}),
      teams: ChannelConfigSchema.default({}),
      bluebubbles: ChannelConfigSchema.default({}),
    })
    .default({
      whatsapp: {},
      telegram: {},
      discord: {},
      signal: {},
      slack: {},
      line: {},
      matrix: {},
      teams: {},
      bluebubbles: {},
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

  /** MCP server definitions (already supported, just documenting) */
  mcp: z
    .object({
      servers: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .default({ servers: [] }),

  /** OS-Agent layer configuration (Phase H — EDITH) */
  osAgent: OSAgentConfigSchema,
})

export type EdithConfig = z.infer<typeof EdithConfigSchema>

let cachedConfig: EdithConfig | null = null

/**
 * Resolve the path to the active config file.
 * Priority: EDITH_CONFIG_PATH -> EDITH_CONFIG_PATH -> edith.json -> edith.json
 */
function resolveConfigPath(): string {
  if (process.env.EDITH_CONFIG_PATH?.trim()) {
    return path.resolve(process.env.EDITH_CONFIG_PATH.trim())
  }
  if (process.env.EDITH_CONFIG_PATH?.trim()) {
    return path.resolve(process.env.EDITH_CONFIG_PATH.trim())
  }
  const edithConfigPath = path.resolve(process.cwd(), "edith.json")
  try {
    readFileSync(edithConfigPath, "utf-8")
    return edithConfigPath
  } catch {
    // Fall through to legacy edith.json path.
  }
  return path.resolve(process.cwd(), "edith.json")
}

/**
 * Synchronous early-load: inject edith.json `env` + channel tokens into
 * process.env BEFORE dotenv + config.ts parse.  This is the key EDITH-style
 * trick — the JSON config is the single source of truth for secrets.
 *
 * Call this ONCE at the very top of your entry point before importing config.ts.
 */
export function injectEdithJsonEnv(): void {
  const configPath = resolveConfigPath()
  let raw: string
  try {
    raw = readFileSync(configPath, "utf-8")
  } catch {
    return // No edith.json yet — dotenv / defaults used
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }

  // 1. Inject top-level `env` section
  const envSection = parsed.env
  if (envSection && typeof envSection === "object" && !Array.isArray(envSection)) {
    for (const [key, value] of Object.entries(envSection as Record<string, unknown>)) {
      if (typeof value === "string" && !process.env[key]) {
        process.env[key] = value
      }
    }
  }

  // 2. Map channel-config tokens → canonical env vars
  const channels = parsed.channels as Record<string, Record<string, unknown>> | undefined
  if (channels && typeof channels === "object") {
    const channelEnvMap: Record<string, Record<string, string>> = {
      telegram: { botToken: "TELEGRAM_BOT_TOKEN", chatId: "TELEGRAM_CHAT_ID" },
      discord: { botToken: "DISCORD_BOT_TOKEN", token: "DISCORD_BOT_TOKEN", channelId: "DISCORD_CHANNEL_ID" },
      slack: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
      whatsapp: {
        enabled: "WHATSAPP_ENABLED",
        mode: "WHATSAPP_MODE",
        accessToken: "WHATSAPP_CLOUD_ACCESS_TOKEN",
        phoneNumberId: "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
        verifyToken: "WHATSAPP_CLOUD_VERIFY_TOKEN",
        allowedWaIds: "WHATSAPP_CLOUD_ALLOWED_WA_IDS",
        apiVersion: "WHATSAPP_CLOUD_API_VERSION",
      },
      signal: { phoneNumber: "SIGNAL_PHONE_NUMBER", cliPath: "SIGNAL_CLI_PATH" },
      line: { channelToken: "LINE_CHANNEL_TOKEN", channelSecret: "LINE_CHANNEL_SECRET" },
      matrix: { homeserver: "MATRIX_HOMESERVER", accessToken: "MATRIX_ACCESS_TOKEN", roomId: "MATRIX_ROOM_ID" },
      teams: { appId: "TEAMS_APP_ID", appPassword: "TEAMS_APP_PASSWORD", serviceUrl: "TEAMS_SERVICE_URL" },
      bluebubbles: { serverUrl: "BLUEBUBBLES_URL", password: "BLUEBUBBLES_PASSWORD" },
    }

    for (const [channelName, mapping] of Object.entries(channelEnvMap)) {
      const channelCfg = channels[channelName]
      if (!channelCfg || typeof channelCfg !== "object") continue
      for (const [jsonKey, envKey] of Object.entries(mapping)) {
        const value = channelCfg[jsonKey]
        if (typeof value === "string" && value.length > 0 && !process.env[envKey]) {
          process.env[envKey] = value
        }
        if (typeof value === "boolean" && !process.env[envKey]) {
          process.env[envKey] = String(value)
        }
      }
    }
  }
}

export async function loadEdithConfig(): Promise<EdithConfig> {
  if (cachedConfig) {
    return cachedConfig
  }

  const configPath = resolveConfigPath()

  try {
    const raw = await fs.readFile(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    cachedConfig = EdithConfigSchema.parse(parsed)
    log.info("edith.json loaded", { workspace: cachedConfig.agents.defaults.workspace })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log.info("edith.json not found, using defaults")
    } else {
      log.warn("edith.json parse error, using defaults", error)
    }
    cachedConfig = EdithConfigSchema.parse({})
  }

  return cachedConfig
}

export function getEdithConfig(): EdithConfig {
  if (!cachedConfig) {
    throw new Error("Config not loaded - call loadEdithConfig() first")
  }

  return cachedConfig
}

/**
 * Write the full EdithConfig back to edith.json.
 * Used by the onboard wizard to persist config changes.
 */
export async function writeEdithConfig(cfg: Record<string, unknown>, configPath?: string): Promise<string> {
  const target = configPath ?? resolveConfigPath()
  const dir = path.dirname(target)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(target, JSON.stringify(cfg, null, 2) + "\n", "utf-8")
  cachedConfig = null // invalidate cache so next load picks up changes
  return target
}
