import fs from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { createLogger } from "../logger.js"

const log = createLogger("config.orion-config")

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
  name: z.string().default("Orion"),
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

const OrionConfigSchema = z.object({
  identity: AgentIdentitySchema.default({
    name: "Orion",
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
})

export type OrionConfig = z.infer<typeof OrionConfigSchema>

let cachedConfig: OrionConfig | null = null

export async function loadOrionConfig(): Promise<OrionConfig> {
  if (cachedConfig) {
    return cachedConfig
  }

  const configPath = path.resolve(process.cwd(), "orion.json")

  try {
    const raw = await fs.readFile(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    cachedConfig = OrionConfigSchema.parse(parsed)
    log.info("orion.json loaded", { workspace: cachedConfig.agents.defaults.workspace })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log.info("orion.json not found, using defaults")
    } else {
      log.warn("orion.json parse error, using defaults", error)
    }
    cachedConfig = OrionConfigSchema.parse({})
  }

  return cachedConfig
}

export function getOrionConfig(): OrionConfig {
  if (!cachedConfig) {
    throw new Error("Config not loaded - call loadOrionConfig() first")
  }

  return cachedConfig
}
