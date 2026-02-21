import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("core.bootstrap")

const DEFAULT_PER_FILE_MAX = 65_536
const DEFAULT_TOTAL_MAX = 100_000

const ALWAYS_INJECT = [
  "SOUL.md",
  "AGENTS.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
]

const DM_ONLY_INJECT = [
  "MEMORY.md",
]

const SUBAGENT_INJECT = [
  "AGENTS.md",
  "TOOLS.md",
]

export type SessionMode = "dm" | "group" | "subagent"

export interface BootstrapFile {
  filename: string
  content: string
  chars: number
  truncated: boolean
  missing: boolean
}

export interface BootstrapContext {
  files: BootstrapFile[]
  totalChars: number
  missingCount: number
  formatted: string
}

interface CachedBootstrapFile {
  content: string
  mtime: number
}

export class BootstrapLoader {
  private readonly dir: string
  private readonly maxPerFile: number
  private readonly maxTotal: number
  private cache = new Map<string, CachedBootstrapFile>()

  constructor(dir: string, opts: { maxPerFile?: number; maxTotal?: number } = {}) {
    this.dir = dir
    this.maxPerFile = opts.maxPerFile ?? DEFAULT_PER_FILE_MAX
    this.maxTotal = opts.maxTotal ?? DEFAULT_TOTAL_MAX
  }

  async load(mode: SessionMode = "dm"): Promise<BootstrapContext> {
    const filenames = this.filesForMode(mode)
    const files: BootstrapFile[] = []
    let totalChars = 0

    for (const filename of filenames) {
      if (totalChars >= this.maxTotal) {
        log.warn("bootstrap total limit hit", { remaining: filenames.slice(files.length) })
        break
      }

      const remainingBudget = this.maxTotal - totalChars
      const file = await this.loadOne(filename, remainingBudget)
      files.push(file)
      totalChars += file.chars
    }

    const label = mode === "subagent" ? "Subagent Context" : "Project Context"
    const blocks: string[] = [`# ${label}\n`]
    for (const file of files) {
      if (!file.missing) {
        blocks.push(`## ${file.filename}\n\n${file.content}`)
      }
    }

    return {
      files,
      totalChars,
      missingCount: files.filter((file) => file.missing).length,
      formatted: blocks.join("\n\n---\n\n"),
    }
  }

  private async loadOne(filename: string, budget: number): Promise<BootstrapFile> {
    const resolved = await this.resolve(filename)
    if (!resolved) {
      return { filename, content: "", chars: 0, truncated: false, missing: true }
    }

    try {
      const stat = await fs.stat(resolved)
      const cached = this.cache.get(filename.toLowerCase())
      const hardLimit = Math.max(0, Math.min(this.maxPerFile, budget))

      if (cached && cached.mtime === stat.mtimeMs) {
        const { content, truncated } = this.limitContent(cached.content, hardLimit)
        return { filename, content, chars: content.length, truncated, missing: false }
      }

      const raw = await fs.readFile(resolved, "utf-8")
      this.cache.set(filename.toLowerCase(), { content: raw, mtime: stat.mtimeMs })
      const { content, truncated } = this.limitContent(raw, hardLimit)
      return { filename, content, chars: content.length, truncated, missing: false }
    } catch (err) {
      log.warn("bootstrap file read error", { filename, err })
      return { filename, content: "", chars: 0, truncated: false, missing: true }
    }
  }

  private limitContent(raw: string, hardLimit: number): { content: string; truncated: boolean } {
    if (hardLimit <= 0) {
      return { content: "", truncated: true }
    }

    if (raw.length <= hardLimit) {
      return { content: raw, truncated: false }
    }

    return {
      content: `${raw.slice(0, hardLimit)}\n\n[...truncated]`,
      truncated: true,
    }
  }

  private async resolve(filename: string): Promise<string | null> {
    const direct = path.join(this.dir, filename)
    try {
      await fs.access(direct)
      return direct
    } catch {
      try {
        const entries = await fs.readdir(this.dir)
        const match = entries.find((entry) => entry.toLowerCase() === filename.toLowerCase())
        return match ? path.join(this.dir, match) : null
      } catch {
        return null
      }
    }
  }

  private filesForMode(mode: SessionMode): string[] {
    switch (mode) {
      case "subagent":
        return SUBAGENT_INJECT
      case "dm":
        return [...ALWAYS_INJECT, ...DM_ONLY_INJECT]
      case "group":
        return ALWAYS_INJECT
    }
  }

  async updateUserMd(updates: Record<string, string>): Promise<void> {
    const filepath = path.join(this.dir, "USER.md")
    let content = ""
    try {
      content = await fs.readFile(filepath, "utf-8")
    } catch {
      content = "# User Profile\n\n"
    }

    for (const [key, value] of Object.entries(updates)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const pattern = new RegExp(`^(${escapedKey}:.*)$`, "im")
      if (pattern.test(content)) {
        content = content.replace(pattern, `${key}: ${value}`)
      } else {
        content += `\n${key}: ${value}`
      }
    }

    const now = new Date().toISOString()
    if (/^Last updated:.*$/im.test(content)) {
      content = content.replace(/^Last updated:.*$/im, `Last updated: ${now}`)
    } else {
      content = `Last updated: ${now}\n${content}`
    }

    await fs.writeFile(filepath, content, "utf-8")
    this.cache.delete("user.md")
    log.debug("USER.md updated", { keys: Object.keys(updates) })
  }

  async appendMemory(fact: string): Promise<void> {
    const filepath = path.join(this.dir, "MEMORY.md")
    const date = new Date().toISOString().slice(0, 10)
    let content = ""

    try {
      content = await fs.readFile(filepath, "utf-8")
    } catch {
      content = "# Long-Term Memory\n\n---\n\n"
    }

    await fs.writeFile(filepath, `${content}- [${date}] ${fact}\n`, "utf-8")
    this.cache.delete("memory.md")
  }

  invalidate(filename?: string): void {
    if (filename) {
      this.cache.delete(filename.toLowerCase())
      return
    }
    this.cache.clear()
  }
}

const workspaceDir = process.env.ORION_WORKSPACE ?? path.resolve(process.cwd(), "workspace")
export const bootstrapLoader = new BootstrapLoader(workspaceDir)

void fs.mkdir(workspaceDir, { recursive: true }).catch(() => {})
void fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true }).catch(() => {})
void fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true }).catch(() => {})
