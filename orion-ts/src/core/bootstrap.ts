import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("core.bootstrap")

export const DEFAULT_AGENTS_FILENAME = "AGENTS.md"
export const DEFAULT_SOUL_FILENAME = "SOUL.md"
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md"
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md"
export const DEFAULT_USER_FILENAME = "USER.md"
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md"
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md"
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md"

const DEFAULT_CHECKSUMS_FILENAME = "CHECKSUMS.sha256"

const DEFAULT_BOOTSTRAP_MAX_CHARS = 65_536
const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000
const TRUNCATION_MARKER = "\n\n[...truncated]"

const ALWAYS_INJECT = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
]

const DM_ONLY_INJECT = [DEFAULT_MEMORY_FILENAME]
const SUBAGENT_INJECT = [DEFAULT_AGENTS_FILENAME, DEFAULT_TOOLS_FILENAME]

const ZERO_WIDTH_DETECT_RE = /[\u200B-\u200D\u2060\uFEFF]/
const ZERO_WIDTH_STRIP_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const SUSPICIOUS_BASE64_DETECT_RE = /(?:[A-Za-z0-9+/]{160,}={0,2})/
const SUSPICIOUS_BASE64_STRIP_RE = /(?:[A-Za-z0-9+/]{160,}={0,2})/g

export type SessionMode = "dm" | "group" | "subagent"

export interface BootstrapFile {
  filename: string
  content: string
  chars: number
  truncated: boolean
  missing: boolean
  hash: string | null
  checksumExpected: string | null
  checksumVerified: boolean | null
  securityFlags: string[]
}

export interface BootstrapContext {
  files: BootstrapFile[]
  totalChars: number
  truncatedCount: number
  missingCount: number
  formatted: string
  integrityWarnings: string[]
  securityWarnings: string[]
}

export interface ResolvedIdentity {
  name: string
  source:
    | "config.ui.assistant.name"
    | "config.agents.list[].identity.name"
    | "workspace/IDENTITY.md"
    | "default"
}

interface BootstrapCacheEntry {
  content: string
  mtimeMs: number
  resolvedPath: string
}

interface ChecksumsCacheEntry {
  mtimeMs: number
  resolvedPath: string
  entries: Map<string, string>
}

interface OrionConfigCacheEntry {
  mtimeMs: number
  resolvedPath: string
  payload: Record<string, unknown>
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export class BootstrapLoader extends EventEmitter {
  private readonly workspaceDir: string
  private readonly maxPerFile: number
  private readonly maxTotal: number

  private readonly fileCache = new Map<string, BootstrapCacheEntry>()
  private checksumsCache: ChecksumsCacheEntry | null = null
  private configCache: OrionConfigCacheEntry | null = null

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
    const checksums = await this.loadChecksumsManifest()
    const files: BootstrapFile[] = []
    const integrityWarnings: string[] = []
    const securityWarnings: string[] = []

    if (!checksums) {
      integrityWarnings.push(`${DEFAULT_CHECKSUMS_FILENAME} missing; bootstrap files are not integrity-verified.`)
    }

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

      let loadedFile = await this.loadOne(filename, checksums)
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

      if (!loadedFile.missing) {
        if (checksums && loadedFile.checksumVerified === null) {
          integrityWarnings.push(`${filename}: missing hash entry in ${DEFAULT_CHECKSUMS_FILENAME}.`)
        }
        if (loadedFile.checksumVerified === false) {
          integrityWarnings.push(`${filename}: checksum mismatch (possible tampering or local edits).`)
        }
      }

      if (loadedFile.securityFlags.length > 0) {
        securityWarnings.push(`${filename}: ${loadedFile.securityFlags.join("; ")}`)
      }
    }

    this.emit("agent:bootstrap", { mode, files: files.length, totalChars })

    return {
      files,
      totalChars,
      truncatedCount: files.filter((file) => file.truncated).length,
      missingCount: files.filter((file) => file.missing).length,
      formatted: this.format(files, mode),
      integrityWarnings,
      securityWarnings,
    }
  }

  async resolveIdentity(): Promise<ResolvedIdentity> {
    const configPayload = await this.loadRawOrionConfig()
    const uiName = readString((configPayload?.ui as { assistant?: { name?: unknown } } | undefined)?.assistant?.name)
    if (uiName) {
      return {
        name: uiName,
        source: "config.ui.assistant.name",
      }
    }

    const configuredAgents = (configPayload?.agents as { list?: unknown[] } | undefined)?.list
    if (Array.isArray(configuredAgents)) {
      for (const agent of configuredAgents) {
        const agentName = readString((agent as { identity?: { name?: unknown } } | undefined)?.identity?.name)
        if (agentName) {
          return {
            name: agentName,
            source: "config.agents.list[].identity.name",
          }
        }
      }
    }

    const identityPath = await this.resolvePath(DEFAULT_IDENTITY_FILENAME)
    if (identityPath) {
      try {
        const identityContent = await fs.readFile(identityPath, "utf-8")
        const match = identityContent.match(/^Name:\s*(.+)$/im)
        const workspaceName = readString(match?.[1])
        if (workspaceName) {
          return {
            name: workspaceName,
            source: "workspace/IDENTITY.md",
          }
        }
      } catch (error) {
        log.debug("failed to read identity file", { error })
      }
    }

    return {
      name: "Assistant",
      source: "default",
    }
  }

  private async loadOne(
    filename: string,
    checksums: Map<string, string> | null,
  ): Promise<BootstrapFile> {
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
        const expectedHash = checksums?.get(cacheKey) ?? null
        return this.buildLoadedFile(filename, cached.content, expectedHash)
      }

      const raw = await fs.readFile(resolvedPath, "utf-8")
      this.fileCache.set(cacheKey, {
        content: raw,
        mtimeMs: stat.mtimeMs,
        resolvedPath,
      })

      this.emit("file:loaded", { filename, chars: raw.length })
      const expectedHash = checksums?.get(cacheKey) ?? null
      return this.buildLoadedFile(filename, raw, expectedHash)
    } catch (error) {
      log.warn("failed to read bootstrap file", { filename, error })
      return this.buildMissingFile(filename, "read error")
    }
  }

  private buildLoadedFile(
    filename: string,
    raw: string,
    expectedHash: string | null,
  ): BootstrapFile {
    const securityFlags = this.detectSecurityFlags(raw)
    const sanitized = this.sanitizeContent(raw)

    if (securityFlags.length > 0) {
      log.warn("bootstrap file sanitized", { filename, flags: securityFlags })
    }

    const content = this.capContent(sanitized, this.maxPerFile)
    const actualHash = sha256(raw)

    return {
      filename,
      content,
      chars: content.length,
      truncated: content.length < sanitized.length,
      missing: false,
      hash: actualHash,
      checksumExpected: expectedHash,
      checksumVerified: expectedHash ? expectedHash === actualHash : null,
      securityFlags,
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
      hash: null,
      checksumExpected: null,
      checksumVerified: null,
      securityFlags: [],
    }
  }

  private detectSecurityFlags(content: string): string[] {
    const flags: string[] = []

    if (ZERO_WIDTH_DETECT_RE.test(content)) {
      flags.push("zero-width unicode characters detected")
    }

    if (SUSPICIOUS_BASE64_DETECT_RE.test(content)) {
      flags.push("long encoded block detected")
    }

    return flags
  }

  private sanitizeContent(content: string): string {
    let sanitized = content
    sanitized = sanitized.replace(ZERO_WIDTH_STRIP_RE, "")
    sanitized = sanitized.replace(SUSPICIOUS_BASE64_STRIP_RE, "[REDACTED_ENCODED_BLOCK]")
    return sanitized
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

  private async loadChecksumsManifest(): Promise<Map<string, string> | null> {
    const resolvedPath = await this.resolvePath(DEFAULT_CHECKSUMS_FILENAME)
    if (!resolvedPath) {
      return null
    }

    try {
      const stat = await fs.stat(resolvedPath)
      if (
        this.checksumsCache
        && this.checksumsCache.mtimeMs === stat.mtimeMs
        && this.checksumsCache.resolvedPath === resolvedPath
      ) {
        return this.checksumsCache.entries
      }

      const raw = await fs.readFile(resolvedPath, "utf-8")
      const entries = new Map<string, string>()

      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) {
          continue
        }

        const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
        if (!match) {
          continue
        }

        const hash = match[1].toLowerCase()
        const filename = path.basename(match[2].trim()).toLowerCase()
        entries.set(filename, hash)
      }

      this.checksumsCache = {
        mtimeMs: stat.mtimeMs,
        resolvedPath,
        entries,
      }

      return entries
    } catch (error) {
      log.warn("failed to load checksum manifest", { error })
      return null
    }
  }

  private async loadRawOrionConfig(): Promise<Record<string, unknown> | null> {
    const configPath = path.resolve(process.cwd(), "orion.json")

    try {
      const stat = await fs.stat(configPath)
      if (
        this.configCache
        && this.configCache.mtimeMs === stat.mtimeMs
        && this.configCache.resolvedPath === configPath
      ) {
        return this.configCache.payload
      }

      const raw = await fs.readFile(configPath, "utf-8")
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") {
        return null
      }

      const payload = parsed as Record<string, unknown>
      this.configCache = {
        mtimeMs: stat.mtimeMs,
        resolvedPath: configPath,
        payload,
      }

      return payload
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.debug("orion.json load skipped", { error })
      }
      return null
    }
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
    if (filename.toLowerCase() === DEFAULT_CHECKSUMS_FILENAME.toLowerCase()) {
      this.checksumsCache = null
    }
  }

  invalidateAll(): void {
    this.fileCache.clear()
    this.checksumsCache = null
    this.configCache = null
  }

  async updateUserMd(updates: Record<string, string>): Promise<void> {
    const existingPath = await this.resolvePath(DEFAULT_USER_FILENAME)
    const filepath = existingPath ?? path.join(this.workspaceDir, DEFAULT_USER_FILENAME)

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
    this.invalidate(DEFAULT_USER_FILENAME)
    log.debug("USER.md updated", { keys: Object.keys(updates) })
  }

  async appendMemory(fact: string): Promise<void> {
    const existingPath = await this.resolvePath(DEFAULT_MEMORY_FILENAME)
    const filepath = existingPath ?? path.join(this.workspaceDir, DEFAULT_MEMORY_FILENAME)

    try {
      await fs.access(filepath)
    } catch {
      await fs.writeFile(filepath, "# Long-Term Memory\n\n---\n\n", "utf-8")
    }

    const date = new Date().toISOString().slice(0, 10)
    await fs.appendFile(filepath, `- [${date}] ${fact}\n`, "utf-8")
    this.invalidate(DEFAULT_MEMORY_FILENAME)
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
