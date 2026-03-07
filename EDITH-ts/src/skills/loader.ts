import { constants, type Dirent, type FSWatcher, watch } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("skills.loader")

const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()

const SKILL_DIR_WORKSPACE = path.resolve(process.cwd(), "workspace", "skills")
const SKILL_DIR_MANAGED = path.resolve(HOME_DIR, ".edith", "skills")
const SKILL_DIR_BUNDLED = path.resolve(process.cwd(), "src", "skills", "bundled")

const SKILL_DIRS_BY_PRECEDENCE: readonly string[] = [
  SKILL_DIR_WORKSPACE,
  SKILL_DIR_MANAGED,
  SKILL_DIR_BUNDLED,
]

const DEFAULT_WATCH_DEBOUNCE_MS = 1_500

export interface SkillMeta {
  name: string
  description: string
  location: string
  alwaysActive: boolean
  os: string[]
  requires: {
    env: string[]
    bins: string[]
    anyBins: string[]
    configs: string[]
  }
  invokeKey: string
  emoji?: string
  version?: string
  enabled: boolean
}

export interface SkillSnapshot {
  skills: SkillMeta[]
  builtAt: number
  xmlIndex: string
  alwaysActiveContent: string
}

interface SkillEligibilityOptions {
  availableTools?: string[]
}

interface ParsedFrontmatter {
  name?: string
  description?: string
  version?: string
  alwaysActive: boolean
  emoji?: string
  os: string[]
  invokeKey?: string
  requiresEnv: string[]
  requiresBins: string[]
  requiresAnyBins: string[]
  requiresConfigs: string[]
}

interface DiscoveredSkill {
  meta: SkillMeta
  content: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeToolKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function expandHomePath(rawPath: string): string {
  if (rawPath.startsWith("~/") || rawPath === "~") {
    return path.resolve(HOME_DIR, rawPath.slice(2))
  }
  return path.resolve(rawPath)
}

function stripCommentsFromUnquotedScalar(raw: string): string {
  let result = ""
  let prev = ""

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === "#" && /\s/.test(prev || " ")) {
      break
    }
    result += char
    prev = char
  }

  return result.trim()
}

function sanitizeScalar(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1).trim()
    return inner.length > 0 ? inner : undefined
  }

  const noComment = stripCommentsFromUnquotedScalar(trimmed)
  return noComment.length > 0 ? noComment : undefined
}

function extractYamlBlock(yaml: string, key: string): string {
  const lines = yaml.split(/\r?\n/)
  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(key)}:\\s*(?:#.*)?$`)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const keyMatch = line.match(keyPattern)
    if (!keyMatch) {
      continue
    }

    const baseIndent = keyMatch[1]?.length ?? 0
    const blockLines: string[] = []

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const current = lines[cursor]
      if (current.trim().length === 0) {
        blockLines.push(current)
        continue
      }

      const indent = current.match(/^\s*/)?.[0].length ?? 0
      if (indent <= baseIndent) {
        break
      }

      blockLines.push(current)
    }

    return blockLines.join("\n")
  }

  return ""
}

function parseScalar(yaml: string, key: string): string | undefined {
  const scalarRegex = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m")
  const match = yaml.match(scalarRegex)
  if (!match) {
    return undefined
  }

  return sanitizeScalar(match[1])
}

function parseBoolean(yaml: string, key: string): boolean {
  const value = parseScalar(yaml, key)
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === "true" || normalized === "1" || normalized === "yes"
}

function splitInlineList(rawItems: string): string[] {
  const result: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null

  for (let index = 0; index < rawItems.length; index += 1) {
    const char = rawItems[index]

    if ((char === "'" || char === '"')) {
      if (!quote) {
        quote = char
      } else if (quote === char) {
        quote = null
      }
      current += char
      continue
    }

    if (char === "," && !quote) {
      const item = sanitizeScalar(current)
      if (item) {
        result.push(item)
      }
      current = ""
      continue
    }

    current += char
  }

  const finalItem = sanitizeScalar(current)
  if (finalItem) {
    result.push(finalItem)
  }

  return result
}

function parseList(yaml: string, key: string): string[] {
  if (!yaml) {
    return []
  }

  const lines = yaml.split(/\r?\n/)
  const keyRegex = new RegExp(`^(\\s*)${escapeRegExp(key)}:\\s*(.*)$`)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(keyRegex)
    if (!match) {
      continue
    }

    const indent = match[1]?.length ?? 0
    const remainder = (match[2] ?? "").trim()

    if (remainder.startsWith("[") && remainder.endsWith("]")) {
      return splitInlineList(remainder.slice(1, -1))
    }

    if (remainder.length > 0 && !remainder.startsWith("#")) {
      const scalar = sanitizeScalar(remainder)
      return scalar ? [scalar] : []
    }

    const listItems: string[] = []

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const current = lines[cursor]
      if (current.trim().length === 0) {
        continue
      }

      const currentIndent = current.match(/^\s*/)?.[0].length ?? 0
      if (currentIndent <= indent) {
        break
      }

      const itemMatch = current.match(/^\s*-\s+(.+)$/)
      if (!itemMatch) {
        continue
      }

      const item = sanitizeScalar(itemMatch[1])
      if (item) {
        listItems.push(item)
      }
    }

    return listItems
  }

  return []
}

function parseFrontmatter(skillMdContent: string): ParsedFrontmatter | null {
  const match = skillMdContent.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) {
    return null
  }

  const yaml = match[1]

  try {
    const requiresBlock = extractYamlBlock(yaml, "requires")
    const parsed: ParsedFrontmatter = {
      name: parseScalar(yaml, "name"),
      description: parseScalar(yaml, "description"),
      version: parseScalar(yaml, "version"),
      alwaysActive: parseBoolean(yaml, "alwaysActive"),
      emoji: parseScalar(yaml, "emoji"),
      os: parseList(yaml, "os"),
      invokeKey: parseScalar(yaml, "invokeKey"),
      requiresEnv: parseList(requiresBlock, "env"),
      requiresBins: parseList(requiresBlock, "bins"),
      requiresAnyBins: parseList(requiresBlock, "anyBins"),
      requiresConfigs: parseList(requiresBlock, "configs"),
    }

    if (!parsed.name || parsed.name.trim().length === 0) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function sortDirents(entries: readonly Dirent[]): Dirent[] {
  return [...entries].sort((left, right) => String(left.name).localeCompare(String(right.name)))
}

export class SkillLoader {
  private snapshot: SkillSnapshot | null = null
  private contentCache = new Map<string, string>()
  private watchers: FSWatcher[] = []
  private watchDebounceMs = DEFAULT_WATCH_DEBOUNCE_MS
  private watchTimer: NodeJS.Timeout | null = null
  private disabledSkills = new Set<string>()

  async buildSnapshot(): Promise<SkillSnapshot> {
    const seen = new Set<string>()
    const skills: SkillMeta[] = []
    const nextContentCache = new Map<string, string>()
    const platform = this.getPlatformName()

    for (const dir of SKILL_DIRS_BY_PRECEDENCE) {
      const entries = await this.readDirectoryEntries(dir)
      if (entries.length === 0) {
        continue
      }

      for (const entry of sortDirents(entries)) {
        if (!entry.isDirectory()) {
          continue
        }

        const discovered = await this.discoverSkillFromDirectory(dir, entry, platform, seen)
        if (!discovered) {
          continue
        }

        seen.add(normalizeName(discovered.meta.name))
        skills.push(discovered.meta)
        nextContentCache.set(discovered.meta.location, discovered.content)
        log.debug("skill discovered", {
          name: discovered.meta.name,
          alwaysActive: discovered.meta.alwaysActive,
        })
      }
    }

    const alwaysActiveSkills = skills.filter((skill) => skill.alwaysActive)
    const indexedSkills = skills.filter((skill) => !skill.alwaysActive)

    this.contentCache = nextContentCache
    this.snapshot = {
      skills,
      builtAt: Date.now(),
      xmlIndex: this.buildXmlIndex(indexedSkills),
      alwaysActiveContent: await this.buildAlwaysActiveContent(alwaysActiveSkills),
    }

    log.info("skill snapshot built", {
      total: skills.length,
      alwaysActive: alwaysActiveSkills.length,
      indexed: indexedSkills.length,
    })

    return this.snapshot
  }

  async getSnapshot(): Promise<SkillSnapshot> {
    if (!this.snapshot) {
      return this.buildSnapshot()
    }

    return this.snapshot
  }

  async getIndexForPrompt(options: SkillEligibilityOptions = {}): Promise<string> {
    const snapshot = await this.getSnapshot()
    const eligible = this.filterByToolPolicy(snapshot.skills, options)
    return this.buildXmlIndex(eligible.filter((skill) => !skill.alwaysActive))
  }

  async getAlwaysActiveContent(options: SkillEligibilityOptions = {}): Promise<string> {
    const snapshot = await this.getSnapshot()
    const eligible = this.filterByToolPolicy(snapshot.skills, options)
    return this.buildAlwaysActiveContent(eligible.filter((skill) => skill.alwaysActive))
  }

  async loadSkillContent(location: string): Promise<string | null> {
    const allowedPath = await this.resolveAllowedSkillFilePath(location)
    if (!allowedPath) {
      return null
    }

    const cached = this.contentCache.get(allowedPath)
    if (cached) {
      return cached
    }

    try {
      const content = await fs.readFile(allowedPath, "utf-8")
      this.contentCache.set(allowedPath, content)
      return content
    } catch {
      return null
    }
  }

  startWatching(options: { enabled?: boolean; debounceMs?: number } = {}): void {
    if (options.enabled === false || this.watchers.length > 0) {
      return
    }

    this.watchDebounceMs = Math.max(100, options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS)

    for (const dir of SKILL_DIRS_BY_PRECEDENCE) {
      const watcher = this.createWatcher(dir)
      if (watcher) {
        this.watchers.push(watcher)
      }
    }

    if (this.watchers.length > 0) {
      log.info("skill watch enabled", {
        paths: SKILL_DIRS_BY_PRECEDENCE,
        debounceMs: this.watchDebounceMs,
      })
    }
  }

  stopWatching(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close()
      } catch {
        continue
      }
    }

    this.watchers = []

    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
  }

  dispose(): void {
    this.stopWatching()
    this.invalidateSnapshot()
  }

  setDisabledSkills(names: string[]): void {
    this.disabledSkills = new Set(names.map((name) => normalizeName(name)))
    this.invalidateSnapshot()
  }

  invalidateSnapshot(): void {
    this.snapshot = null
    this.contentCache.clear()
  }

  private async readDirectoryEntries(dir: string): Promise<Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }

  private async discoverSkillFromDirectory(
    dir: string,
    entry: Dirent,
    platform: string,
    seen: Set<string>,
  ): Promise<DiscoveredSkill | null> {
    const folderName = String(entry.name)
    const skillMdPath = path.resolve(dir, folderName, "SKILL.md")

    let content: string
    try {
      content = await fs.readFile(skillMdPath, "utf-8")
    } catch {
      return null
    }

    const parsed = parseFrontmatter(content)
    if (!parsed?.name) {
      return null
    }

    const name = String(parsed.name)
    const canonicalName = normalizeName(name)
    if (seen.has(canonicalName)) {
      return null
    }

    const osList = parsed.os.map((value) => value.toLowerCase())
    if (osList.length > 0 && !osList.includes(platform)) {
      log.debug("skill filtered by os", { name, skillOs: osList, platform })
      return null
    }

    if (this.disabledSkills.has(canonicalName)) {
      log.debug("skill disabled by config", { name })
      return null
    }

    const skill = this.buildSkillMeta(parsed, folderName, skillMdPath)
    if (!(await this.meetsRequirements(skill))) {
      return null
    }

    return { meta: skill, content }
  }

  private buildSkillMeta(parsed: ParsedFrontmatter, folderName: string, skillMdPath: string): SkillMeta {
    const invokeKey = parsed.invokeKey?.trim().length ? parsed.invokeKey.trim() : folderName
    return {
      name: parsed.name!,
      description: String(parsed.description ?? "").slice(0, 120),
      location: path.resolve(skillMdPath),
      alwaysActive: Boolean(parsed.alwaysActive),
      os: parsed.os.map((value) => value.toLowerCase()),
      requires: {
        env: parsed.requiresEnv,
        bins: parsed.requiresBins,
        anyBins: parsed.requiresAnyBins,
        configs: parsed.requiresConfigs,
      },
      invokeKey,
      emoji: parsed.emoji?.trim().length ? parsed.emoji.trim() : undefined,
      version: parsed.version?.trim().length ? parsed.version.trim() : undefined,
      enabled: true,
    }
  }

  private createWatcher(dir: string): FSWatcher | null {
    try {
      return watch(dir, { recursive: true }, () => this.scheduleSnapshotRefresh())
    } catch {
      try {
        return watch(dir, () => this.scheduleSnapshotRefresh())
      } catch {
        return null
      }
    }
  }

  private scheduleSnapshotRefresh(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
    }

    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      this.invalidateSnapshot()
      void this.buildSnapshot().catch((error) => {
        log.warn("failed to refresh skill snapshot", { error })
      })
    }, this.watchDebounceMs)
    this.watchTimer.unref?.()
  }

  private filterByToolPolicy(skills: SkillMeta[], options: SkillEligibilityOptions): SkillMeta[] {
    const providedTools = options.availableTools?.map((tool) => normalizeToolKey(tool)).filter(Boolean) ?? []
    const availableTools = new Set(providedTools)

    if (availableTools.size === 0 || availableTools.has(normalizeToolKey("read_skill"))) {
      return skills
    }

    return skills.filter((skill) => {
      if (skill.alwaysActive) {
        return true
      }

      const candidateKeys = [
        skill.invokeKey,
        skill.name,
        skill.name.replace(/-/g, "_"),
        skill.name.replace(/-/g, ""),
      ]

      return candidateKeys.some((key) => availableTools.has(normalizeToolKey(key)))
    })
  }

  private async buildAlwaysActiveContent(skills: SkillMeta[]): Promise<string> {
    if (skills.length === 0) {
      return ""
    }

    const blocks: string[] = []
    for (const skill of skills) {
      const content = await this.getCachedOrReadSkill(skill.location)
      if (!content) {
        continue
      }
      blocks.push(`## Skill: ${skill.name}\n\n${content}`)
    }

    return blocks.join("\n\n---\n\n")
  }

  private async getCachedOrReadSkill(location: string): Promise<string | null> {
    const cached = this.contentCache.get(location)
    if (cached) {
      return cached
    }

    try {
      const content = await fs.readFile(location, "utf-8")
      this.contentCache.set(location, content)
      return content
    } catch {
      return null
    }
  }

  private buildXmlIndex(skills: SkillMeta[]): string {
    if (skills.length === 0) {
      return ""
    }

    const skillXml = skills
      .map((skill) => {
        const name = this.xmlEscape(skill.name)
        const description = this.xmlEscape(skill.description)
        const location = this.xmlEscape(skill.location)

        return [
          "  <skill>",
          `    <n>${name}</n>`,
          `    <description>${description}</description>`,
          `    <location>${location}</location>`,
          "  </skill>",
        ].join("\n")
      })
      .join("\n")

    return [
      "<available_skills>",
      skillXml,
      "</available_skills>",
      "",
      "To use a skill, read its SKILL.md at the listed location first.",
    ].join("\n")
  }

  private xmlEscape(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }

  private async meetsRequirements(skill: SkillMeta): Promise<boolean> {
    const missingEnv = skill.requires.env.filter((envName) => {
      const value = process.env[envName]
      return typeof value !== "string" || value.trim().length === 0
    })
    if (missingEnv.length > 0) {
      log.debug("skill filtered by missing env vars", { name: skill.name, missingEnv })
      return false
    }

    const missingBins = await this.findMissingRequiredBins(skill.requires.bins)
    if (missingBins.length > 0) {
      log.debug("skill filtered by missing bins", { name: skill.name, missingBins })
      return false
    }

    if (skill.requires.anyBins.length > 0 && !(await this.hasAnyBinary(skill.requires.anyBins))) {
      log.debug("skill filtered by anyBins requirement", {
        name: skill.name,
        candidates: skill.requires.anyBins,
      })
      return false
    }

    const missingConfigs = await this.findMissingConfigPaths(skill.requires.configs)
    if (missingConfigs.length > 0) {
      log.debug("skill filtered by missing config files", { name: skill.name, missingConfigs })
      return false
    }

    return true
  }

  private async findMissingRequiredBins(bins: string[]): Promise<string[]> {
    const missing: string[] = []
    for (const bin of bins) {
      if (!(await this.binaryExists(bin))) {
        missing.push(bin)
      }
    }
    return missing
  }

  private async hasAnyBinary(candidates: string[]): Promise<boolean> {
    for (const candidate of candidates) {
      if (await this.binaryExists(candidate)) {
        return true
      }
    }
    return false
  }

  private async findMissingConfigPaths(configPaths: string[]): Promise<string[]> {
    const missing: string[] = []

    for (const configPath of configPaths) {
      try {
        await fs.access(expandHomePath(configPath), constants.F_OK)
      } catch {
        missing.push(configPath)
      }
    }

    return missing
  }

  private async binaryExists(bin: string): Promise<boolean> {
    const raw = bin.trim()
    if (!raw) {
      return false
    }

    if (raw.includes("/") || raw.includes("\\")) {
      try {
        await fs.access(expandHomePath(raw), constants.F_OK)
        return true
      } catch {
        return false
      }
    }

    const pathEntries = (process.env.PATH ?? "")
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)

    const extensions = process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .map((ext) => ext.trim())
        .filter(Boolean)
      : [""]

    const hasKnownExtension = process.platform === "win32" && /\.[^./\\]+$/.test(raw)

    for (const entry of pathEntries) {
      const candidates = process.platform === "win32" && !hasKnownExtension
        ? extensions.map((ext) => path.join(entry, `${raw}${ext}`))
        : [path.join(entry, raw)]

      for (const candidate of candidates) {
        try {
          await fs.access(candidate, constants.F_OK)
          return true
        } catch {
          continue
        }
      }
    }

    return false
  }

  private async resolveAllowedSkillFilePath(location: string): Promise<string | null> {
    const requested = path.resolve(location)

    if (path.basename(requested).toLowerCase() !== "skill.md") {
      log.warn("blocked non-skill file request", { location })
      return null
    }

    let realRequested: string
    try {
      realRequested = await fs.realpath(requested)
    } catch {
      return null
    }

    for (const dir of SKILL_DIRS_BY_PRECEDENCE) {
      if (await this.isWithinDirectoryRealPath(realRequested, dir)) {
        return realRequested
      }
    }

    log.warn("blocked skill path traversal attempt", { location })
    return null
  }

  private async isWithinDirectoryRealPath(targetPath: string, allowedDir: string): Promise<boolean> {
    let resolvedDir: string
    try {
      resolvedDir = await fs.realpath(allowedDir)
    } catch {
      return false
    }

    const relative = path.relative(resolvedDir, targetPath)
    return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
  }

  private getPlatformName(): string {
    const platform = process.platform
    if (platform === "darwin") {
      return "macos"
    }
    if (platform === "win32") {
      return "windows"
    }
    return "linux"
  }
}

export const skillLoader = new SkillLoader()

export const __skillLoaderTestUtils = {
  sanitizeScalar,
  splitInlineList,
  parseFrontmatter,
}
