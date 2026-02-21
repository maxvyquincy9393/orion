import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("core.identity")

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace")
const BOOTSTRAP_MAX_CHARS = 20_000
const BOOTSTRAP_TOTAL_MAX_CHARS = 80_000

const DEFAULT_USER_PROFILE = `# User Profile

## Basic Info
(Auto-populated during onboarding or from conversation)
Name: unknown
Language: auto-detected
Timezone: unknown

## Preferences
(Updated automatically as Orion learns about you)

## Communication Style
(Detected from conversation patterns)
Formality: unknown
Technical level: unknown
Response length preference: unknown

## Context
(What Orion knows about your current situation)

## Topics of Interest
(Updated automatically)
`

const DEFAULT_MEMORY = `# Long-Term Memory

(This file is automatically maintained by Orion.
Only confirmed, high-confidence facts are stored here.
Speculative or uncertain information goes into semantic memory instead.)
`

interface BootstrapFile {
  filename: string
  content: string
  tokenEstimate: number
}

const ALWAYS_LOADED_FILES = [
  "SOUL.md",
  "AGENTS.md",
  "IDENTITY.md",
  "USER.md",
]

const DM_ONLY_FILES = [
  "MEMORY.md",
]

const SUBAGENT_FILES = [
  "AGENTS.md",
]

const PROFILE_FIELD_MAP: Record<string, string> = {
  name: "Name",
  user_name: "Name",
  preferred_name: "Name",
  language: "Language",
  preferred_language: "Language",
  timezone: "Timezone",
  time_zone: "Timezone",
  formality: "Formality",
  technical_level: "Technical level",
  expertise_level: "Technical level",
  response_length: "Response length preference",
  response_length_preference: "Response length preference",
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeProfileKey(rawKey: string): string {
  return rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

function formatProfileLabel(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export class IdentityManager {
  private bootstrapCache = new Map<string, { content: string; mtime: number }>()

  private async ensureWorkspaceDir(): Promise<void> {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true })
  }

  async loadBootstrapFile(filename: string): Promise<BootstrapFile | null> {
    await this.ensureWorkspaceDir()

    const filePath = path.join(WORKSPACE_DIR, filename)

    try {
      const stat = await fs.stat(filePath)
      const cached = this.bootstrapCache.get(filename)

      if (cached && cached.mtime === stat.mtimeMs) {
        return {
          filename,
          content: cached.content,
          tokenEstimate: estimateTokens(cached.content),
        }
      }

      let content = await fs.readFile(filePath, "utf-8")
      const originalLength = content.length

      if (content.length > BOOTSTRAP_MAX_CHARS) {
        content = `${content.slice(0, BOOTSTRAP_MAX_CHARS)}\n\n[... truncated]`
        log.warn("bootstrap file truncated", { filename, originalLength })
      }

      this.bootstrapCache.set(filename, { content, mtime: stat.mtimeMs })

      return {
        filename,
        content,
        tokenEstimate: estimateTokens(content),
      }
    } catch {
      log.debug("bootstrap file missing", { filename })
      return null
    }
  }

  async buildIdentityContext(options: {
    isDM?: boolean
    isSubagent?: boolean
  } = {}): Promise<string> {
    await this.ensureWorkspaceDir()

    const { isDM = true, isSubagent = false } = options

    const filesToLoad = isSubagent
      ? SUBAGENT_FILES
      : isDM
        ? [...ALWAYS_LOADED_FILES, ...DM_ONLY_FILES]
        : ALWAYS_LOADED_FILES

    const blocks: string[] = []
    let totalChars = 0

    for (const filename of filesToLoad) {
      const file = await this.loadBootstrapFile(filename)
      if (!file) {
        continue
      }

      if (totalChars + file.content.length > BOOTSTRAP_TOTAL_MAX_CHARS) {
        log.warn("bootstrap total limit reached, skipping remaining files", { skippedFrom: filename })
        break
      }

      blocks.push(`[${filename}]\n${file.content}`)
      totalChars += file.content.length
    }

    return blocks.join("\n\n---\n\n")
  }

  async updateUserProfile(updates: Record<string, string>): Promise<void> {
    await this.ensureWorkspaceDir()

    const filePath = path.join(WORKSPACE_DIR, "USER.md")

    try {
      let content = await fs.readFile(filePath, "utf-8").catch(() => DEFAULT_USER_PROFILE)

      for (const [rawKey, rawValue] of Object.entries(updates)) {
        const value = rawValue.trim()
        if (!value) {
          continue
        }

        const normalizedKey = normalizeProfileKey(rawKey)
        if (!normalizedKey) {
          continue
        }

        const label = PROFILE_FIELD_MAP[normalizedKey] ?? formatProfileLabel(normalizedKey)
        const pattern = new RegExp(`(^${escapeRegExp(label)}:).*`, "im")

        if (pattern.test(content)) {
          content = content.replace(pattern, `$1 ${value}`)
        } else {
          content = `${content.trimEnd()}\n${label}: ${value}\n`
        }
      }

      await fs.writeFile(filePath, content, "utf-8")
      this.bootstrapCache.delete("USER.md")
      log.debug("USER.md updated", { keys: Object.keys(updates) })
    } catch (error) {
      log.error("failed to update USER.md", error)
    }
  }

  async appendToMemory(fact: string): Promise<void> {
    await this.ensureWorkspaceDir()

    const filePath = path.join(WORKSPACE_DIR, "MEMORY.md")

    try {
      const existing = await fs.readFile(filePath, "utf-8").catch(() => DEFAULT_MEMORY)
      const timestamp = new Date().toISOString().slice(0, 10)
      const separator = existing.endsWith("\n") ? "" : "\n"
      const updated = `${existing}${separator}- [${timestamp}] ${fact}\n`
      await fs.writeFile(filePath, updated, "utf-8")
      this.bootstrapCache.delete("MEMORY.md")
    } catch (error) {
      log.error("failed to append to MEMORY.md", error)
    }
  }
}

export const identityManager = new IdentityManager()
