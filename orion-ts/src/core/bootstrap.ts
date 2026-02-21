import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("core.bootstrap")

const DEFAULT_BOOTSTRAP_MAX_CHARS = 65_536
const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000
const TRUNCATION_MARKER = "\n\n[...truncated]"

const ALWAYS_INJECT = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
]
const DM_ONLY_INJECT = ["MEMORY.md"]
const SUBAGENT_INJECT = ["AGENTS.md", "TOOLS.md"]

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
  truncatedCount: number
  missingCount: number
  formatted: string
}

interface BootstrapCacheEntry {
  content: string
  mtimeMs: number
  resolvedPath: string
}

export class BootstrapLoader extends EventEmitter {
  private readonly workspaceDir: string
  private readonly maxPerFile: number
  private readonly maxTotal: number
  private readonly fileCache = new Map<string, BootstrapCacheEntry>()

  constructor(
    workspaceDir: string,
    opts: { maxPerFile?: number; maxTotal?: number } = {},
  ) {
    super()
    this.workspaceDir = path.resolve(workspaceDir)
    this.maxPerFile = opts.maxPerFile ?? DEFAULT_BOOTSTRAP_MAX_CHARS
    this.maxTotal = opts.maxTotal ?? DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS
  }

  async load(mode: SessionMode = "dm"): Promise<BootstrapContext> {
    const filenames = this.getFileListForMode(mode)
    const files: BootstrapFile[] = []
    let totalChars = 0

    for (const filename of filenames) {
      const remaining = this.maxTotal - totalChars
      if (remaining <= 0) {
        log.warn("bootstrap total limit hit, skipping remaining files", {
          loaded: files.length,
          skipped: filenames.slice(files.length).join(", "),
          maxTotal: this.maxTotal,
        })
        break
      }

      let loadedFile = await this.loadOne(filename)
      if (loadedFile.chars > remaining) {
        const capped = this.capContent(loadedFile.content, remaining)
        loadedFile = {
          ...loadedFile,
          content: capped,
          chars: capped.length,
          truncated: loadedFile.truncated || capped.length < loadedFile.content.length,
        }

        files.push(loadedFile)
        totalChars += loadedFile.chars

        log.warn("bootstrap total limit reached during file injection", {
          filename,
          maxTotal: this.maxTotal,
        })
        break
      }

      files.push(loadedFile)
      totalChars += loadedFile.chars
    }

    this.emit("agent:bootstrap", { mode, files: files.length, totalChars })

    return {
      files,
      totalChars,
      truncatedCount: files.filter((file) => file.truncated).length,
      missingCount: files.filter((file) => file.missing).length,
      formatted: this.format(files, mode),
    }
  }

  private async loadOne(filename: string): Promise<BootstrapFile> {
    const cacheKey = filename.toLowerCase()
    const resolvedPath = await this.resolvePath(filename)

    if (!resolvedPath) {
      return this.buildMissingFile(filename, "not found")
    }

    try {
      const stat = await fs.stat(resolvedPath)
      const cached = this.fileCache.get(cacheKey)

      if (
        cached
        && cached.mtimeMs === stat.mtimeMs
        && cached.resolvedPath === resolvedPath
      ) {
        return this.buildLoadedFile(filename, cached.content)
      }

      const raw = await fs.readFile(resolvedPath, "utf-8")
      this.fileCache.set(cacheKey, {
        content: raw,
        mtimeMs: stat.mtimeMs,
        resolvedPath,
      })

      this.emit("file:loaded", { filename, chars: raw.length })
      return this.buildLoadedFile(filename, raw)
    } catch (error) {
      log.warn("failed to read bootstrap file", { filename, error })
      return this.buildMissingFile(filename, "read error")
    }
  }

  private buildLoadedFile(filename: string, raw: string): BootstrapFile {
    const content = this.capContent(raw, this.maxPerFile)
    return {
      filename,
      content,
      chars: content.length,
      truncated: content.length < raw.length,
      missing: false,
    }
  }

  private buildMissingFile(filename: string, reason: "not found" | "read error"): BootstrapFile {
    const content = `[${filename}: ${reason}]`
    return {
      filename,
      content,
      chars: content.length,
      truncated: false,
      missing: true,
    }
  }

  private capContent(content: string, limit: number): string {
    if (limit <= 0) {
      return ""
    }
    if (content.length <= limit) {
      return content
    }
    if (limit <= TRUNCATION_MARKER.length) {
      return content.slice(0, limit)
    }
    return `${content.slice(0, limit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
  }

  private async resolvePath(filename: string): Promise<string | null> {
    const direct = path.join(this.workspaceDir, filename)
    try {
      await fs.access(direct)
      return direct
    } catch {
      try {
        const entries = await fs.readdir(this.workspaceDir)
        const match = entries.find((entry) => entry.toLowerCase() === filename.toLowerCase())
        return match ? path.join(this.workspaceDir, match) : null
      } catch {
        return null
      }
    }
  }

  private format(files: BootstrapFile[], mode: SessionMode): string {
    if (files.length === 0) {
      return ""
    }

    const label = mode === "subagent" ? "Subagent Context" : "Project Context"
    const blocks: string[] = [`# ${label}`]

    for (const file of files) {
      if (file.missing) {
        blocks.push(`\n## ${file.filename}\n${file.content}`)
        continue
      }

      blocks.push(`\n## ${file.filename}\n\n${file.content}`)
    }

    return blocks.join("\n")
  }

  private getFileListForMode(mode: SessionMode): string[] {
    switch (mode) {
      case "subagent":
        return SUBAGENT_INJECT
      case "group":
        return ALWAYS_INJECT
      case "dm":
      default:
        return [...ALWAYS_INJECT, ...DM_ONLY_INJECT]
    }
  }

  invalidate(filename: string): void {
    this.fileCache.delete(filename.toLowerCase())
  }

  invalidateAll(): void {
    this.fileCache.clear()
  }

  async updateUserMd(updates: Record<string, string>): Promise<void> {
    const existingPath = await this.resolvePath("USER.md")
    const filepath = existingPath ?? path.join(this.workspaceDir, "USER.md")

    let content: string
    try {
      content = await fs.readFile(filepath, "utf-8")
    } catch {
      content = "# User Profile\n\n"
    }

    for (const [key, value] of Object.entries(updates)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const pattern = new RegExp(`^(${escapedKey}:\\s*).*$`, "im")
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${value}`)
      } else {
        content += `\n${key}: ${value}`
      }
    }

    await fs.writeFile(filepath, content, "utf-8")
    this.invalidate("USER.md")
    log.debug("USER.md updated", { keys: Object.keys(updates) })
  }

  async appendMemory(fact: string): Promise<void> {
    const existingPath = await this.resolvePath("MEMORY.md")
    const filepath = existingPath ?? path.join(this.workspaceDir, "MEMORY.md")

    try {
      await fs.access(filepath)
    } catch {
      await fs.writeFile(filepath, "# Long-Term Memory\n\n---\n\n", "utf-8")
    }

    const date = new Date().toISOString().slice(0, 10)
    await fs.appendFile(filepath, `- [${date}] ${fact}\n`, "utf-8")
    this.invalidate("MEMORY.md")
  }
}

let singletonBootstrapLoader: BootstrapLoader | null = null

export function getBootstrapLoader(): BootstrapLoader {
  if (singletonBootstrapLoader) {
    return singletonBootstrapLoader
  }

  const workspaceDir = process.env.ORION_WORKSPACE ?? path.resolve(process.cwd(), "workspace")
  singletonBootstrapLoader = new BootstrapLoader(workspaceDir)
  return singletonBootstrapLoader
}

export const bootstrapLoader = getBootstrapLoader()
