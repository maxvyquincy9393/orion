import { constants, type Dirent, type FSWatcher, watch } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { createLogger } from "../logger.js"

const log = createLogger("skills.loader")

const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()

const SKILL_DIR_WORKSPACE = path.resolve(process.cwd(), "workspace", "skills")
const SKILL_DIR_MANAGED = path.resolve(HOME_DIR, ".orion", "skills")
const SKILL_DIR_BUNDLED = path.resolve(process.cwd(), "src", "skills", "bundled")

const SKILL_DIRS_BY_PRECEDENCE = [
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

function parseFrontmatter(skillMdContent: string): ParsedFrontmatter | null {
  const match = skillMdContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)
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

  return value.trim().toLowerCase() === "true"
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
      const rawItems = remainder.slice(1, -1)
      return rawItems
        .split(",")
        .map((item) => sanitizeScalar(item))
        .filter((item): item is string => Boolean(item))
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

function sanitizeScalar(raw: string): string | undefined {
  const noComment = raw.replace(/\s+#.*$/, "").trim()
  if (!noComment) {
    return undefined
  }

  if (
    (noComment.startsWith('"') && noComment.endsWith('"'))
    || (noComment.startsWith("'") && noComment.endsWith("'"))
  ) {
    return noComment.slice(1, -1).trim()
  }

  return noComment
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
    const platform = this.getPlatformName()

    for (const dir of SKILL_DIRS_BY_PRECEDENCE) {
      let entries: Dirent<string>[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }

      const sortedEntries = [...entries].sort((left, right) => {
        return String(left.name).localeCompare(String(right.name))
      })

      for (const entry of sortedEntries) {
        if (!entry.isDirectory()) {
          continue
        }

        const folderName = String(entry.name)
        const skillMdPath = path.resolve(dir, folderName, "SKILL.md")

        let content = ""
        try {
          content = await fs.readFile(skillMdPath, "utf-8")
        } catch {
          continue
        }

        const parsed = parseFrontmatter(content)
        if (!parsed?.name) {
          continue
        }

        const name = String(parsed.name)
        const canonicalName = normalizeName(name)

        if (seen.has(canonicalName)) {
          continue
        }

        const osList = parsed.os.map((value) => value.toLowerCase())
        if (osList.length > 0 && !osList.includes(platform)) {
          log.debug("skill filtered by os", { name, skillOs: osList, platform })
          continue
        }

        if (this.disabledSkills.has(canonicalName)) {
          log.debug("skill disabled by config", { name })
          continue
        }

        const skill: SkillMeta = {
          name,
          description: String(parsed.description ?? "").slice(0, 120),
          location: skillMdPath,
          alwaysActive: Boolean(parsed.alwaysActive),
          os: osList,
          requires: {
            env: parsed.requiresEnv,
            bins: parsed.requiresBins,
            anyBins: parsed.requiresAnyBins,
            configs: parsed.requiresConfigs,
          },
          invokeKey: parsed.invokeKey?.trim().length
            ? parsed.invokeKey.trim()
            : folderName,
          emoji: parsed.emoji?.trim().length ? parsed.emoji.trim() : undefined,
          version: parsed.version?.trim().length ? parsed.version.trim() : undefined,
          enabled: true,
        }

        const meetsRequirements = await this.meetsRequirements(skill)
        if (!meetsRequirements) {
          continue
        }

        seen.add(canonicalName)
        skills.push(skill)
        this.contentCache.set(skillMdPath, content)
        log.debug("skill discovered", { name: skill.name, alwaysActive: skill.alwaysActive })
      }
    }

    const alwaysActiveSkills = skills.filter((skill) => skill.alwaysActive)
    const indexedSkills = skills.filter((skill) => !skill.alwaysActive)

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
    const indexedSkills = eligible.filter((skill) => !skill.alwaysActive)
    return this.buildXmlIndex(indexedSkills)
  }

  async getAlwaysActiveContent(options: SkillEligibilityOptions = {}): Promise<string> {
    const snapshot = await this.getSnapshot()
    const eligible = this.filterByToolPolicy(snapshot.skills, options)
    const alwaysActiveSkills = eligible.filter((skill) => skill.alwaysActive)
    return this.buildAlwaysActiveContent(alwaysActiveSkills)
  }

  async loadSkillContent(location: string): Promise<string | null> {
    const resolved = path.resolve(location)

    if (path.basename(resolved).toLowerCase() !== "skill.md") {
      log.warn("blocked non-skill file request", { location })
      return null
    }

    const allowed = SKILL_DIRS_BY_PRECEDENCE.some((dir) => this.isWithinDirectory(resolved, dir))
    if (!allowed) {
      log.warn("blocked skill path traversal attempt", { location })
      return null
    }

    const cached = this.contentCache.get(resolved)
    if (cached) {
      return cached
    }

    try {
      const content = await fs.readFile(resolved, "utf-8")
      this.contentCache.set(resolved, content)
      return content
    } catch {
      return null
    }
  }

  startWatching(options: { enabled?: boolean; debounceMs?: number } = {}): void {
    if (options.enabled === false) {
      return
    }

    if (this.watchers.length > 0) {
      return
    }

    this.watchDebounceMs = Math.max(100, options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS)

    for (const dir of SKILL_DIRS_BY_PRECEDENCE) {
      try {
        const watcher = watch(dir, { recursive: true }, () => this.scheduleSnapshotRefresh())
        this.watchers.push(watcher)
      } catch {
        try {
          const watcher = watch(dir, () => this.scheduleSnapshotRefresh())
          this.watchers.push(watcher)
        } catch {
          continue
        }
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

  setDisabledSkills(names: string[]): void {
    this.disabledSkills = new Set(names.map((name) => normalizeName(name)))
    this.invalidateSnapshot()
  }

  invalidateSnapshot(): void {
    this.snapshot = null
    this.contentCache.clear()
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
  }

  private filterByToolPolicy(skills: SkillMeta[], options: SkillEligibilityOptions): SkillMeta[] {
    const providedTools = options.availableTools?.map((tool) => normalizeToolKey(tool)).filter(Boolean) ?? []
    const availableTools = new Set(providedTools)

    if (availableTools.size === 0) {
      return skills
    }

    const hasReadSkillTool = availableTools.has(normalizeToolKey("read_skill"))
    if (hasReadSkillTool) {
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
      const content = this.contentCache.get(skill.location)
      if (!content) {
        continue
      }

      blocks.push(`## Skill: ${skill.name}\n\n${content}`)
    }

    return blocks.join("\n\n---\n\n")
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
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }

  private async meetsRequirements(skill: SkillMeta): Promise<boolean> {
    const missingEnv = skill.requires.env.filter((envName) => {
      const value = process.env[envName]
      return typeof value !== "string" || value.trim().length === 0
    })

    if (missingEnv.length > 0) {
      log.debug("skill filtered by missing env vars", {
        name: skill.name,
        missingEnv,
      })
      return false
    }

    const missingBins: string[] = []
    for (const bin of skill.requires.bins) {
      const exists = await this.binaryExists(bin)
      if (!exists) {
        missingBins.push(bin)
      }
    }

    if (missingBins.length > 0) {
      log.debug("skill filtered by missing bins", {
        name: skill.name,
        missingBins,
      })
      return false
    }

    if (skill.requires.anyBins.length > 0) {
      let hasAnyBin = false
      for (const candidate of skill.requires.anyBins) {
        if (await this.binaryExists(candidate)) {
          hasAnyBin = true
          break
        }
      }

      if (!hasAnyBin) {
        log.debug("skill filtered by anyBins requirement", {
          name: skill.name,
          candidates: skill.requires.anyBins,
        })
        return false
      }
    }

    const missingConfigs: string[] = []
    for (const configPath of skill.requires.configs) {
      try {
        await fs.access(expandHomePath(configPath), constants.F_OK)
      } catch {
        missingConfigs.push(configPath)
      }
    }

    if (missingConfigs.length > 0) {
      log.debug("skill filtered by missing config files", {
        name: skill.name,
        missingConfigs,
      })
      return false
    }

    return true
  }

  private async binaryExists(bin: string): Promise<boolean> {
    if (!bin.trim()) {
      return false
    }

    const raw = bin.trim()
    if (raw.includes("/") || raw.includes("\\")) {
      try {
        await fs.access(raw, constants.F_OK)
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

  private isWithinDirectory(targetPath: string, allowedDir: string): boolean {
    const resolvedDir = path.resolve(allowedDir)
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
