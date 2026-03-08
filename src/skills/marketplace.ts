/**
 * @file marketplace.ts
 * @description SkillMarketplace — local skill discovery with trust-tiered loading.
 *
 * ARCHITECTURE:
 *   Scans 3 directories with different trust levels:
 *     system:   workspace/skills/      — pre-approved, bundled
 *     user:     .edith/skills/         — user-installed, semi-trusted
 *     external: ~/.edith/external/     — third-party, most restrictive
 *
 *   Each skill directory must contain either:
 *     1. `skill.json` — full manifest (preferred)
 *     2. `SKILL.md` — fallback; minimal manifest is auto-generated from frontmatter
 *
 *   Skills that fail validation are logged and skipped — never crash on bad manifests.
 *
 *   Called by SkillManager.init() at startup and by the EDITH skill CLI command.
 *
 * PAPER BASIS:
 *   - Agent Skills Architecture (arXiv:2602.12430): 4-tier trust model, progressive
 *     context loading, capability declaration before runtime
 *   - Agent Skills in the Wild (arXiv:2601.10338): 26.1% skills have vulnerabilities —
 *     local-only discovery eliminates supply chain attack surface entirely
 *   - SkillFortify (arXiv:2603.00195): manifest hash for integrity verification
 *
 * @module skills/marketplace
 */

import path from "node:path"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import os from "node:os"

import { createLogger } from "../logger.js"
import { skillSandbox, type SkillManifest, type SkillTrustLevel } from "./sandbox.js"

const log = createLogger("skills.marketplace")

/** The three skill discovery directories with their trust levels. */
export const SKILL_DIRS: Record<SkillTrustLevel, string> = {
  system: path.resolve(process.cwd(), "workspace", "skills"),
  user: path.resolve(process.cwd(), ".edith", "skills"),
  external: path.resolve(os.homedir(), ".edith", "external-skills"),
}

/**
 * A successfully discovered and validated skill.
 */
export interface DiscoveredSkill {
  /** Parsed and validated manifest. */
  manifest: SkillManifest
  /** Absolute path to the skill directory. */
  path: string
  /** Which trust tier this skill came from. */
  source: SkillTrustLevel
  /** SHA-256 hash of the manifest content at discovery time (for integrity). */
  manifestHash: string
  /** Absolute path to SKILL.md entrypoint (if it exists). */
  entrypointPath?: string
}

/**
 * SkillMarketplace — discovers, validates, and indexes local skills.
 *
 * Usage:
 *   await skillMarketplace.discover()
 *   const skills = skillMarketplace.list({ trustLevel: 'user' })
 *   const manifest = skillMarketplace.get('my-skill')?.manifest
 */
export class SkillMarketplace {
  /** All discovered skills keyed by skill name. */
  private discovered = new Map<string, DiscoveredSkill>()

  /**
   * Scan all 3 skill directories and load valid skills.
   * Directories that don't exist are silently skipped.
   *
   * @returns Number of successfully loaded skills
   */
  async discover(): Promise<number> {
    this.discovered.clear()
    let count = 0

    for (const [trustLevel, dirPath] of Object.entries(SKILL_DIRS) as [SkillTrustLevel, string][]) {
      const loaded = await this.scanDirectory(dirPath, trustLevel)
      count += loaded
      log.debug("skill directory scanned", { trustLevel, dir: dirPath, loaded })
    }

    log.info("skill marketplace discovery complete", {
      total: count,
      dirs: Object.values(SKILL_DIRS),
    })

    return count
  }

  /**
   * List all discovered skills.
   * @param filter - Optional filter by trust level
   */
  list(filter?: { trustLevel?: SkillTrustLevel }): DiscoveredSkill[] {
    const all = [...this.discovered.values()]
    if (filter?.trustLevel) {
      return all.filter((s) => s.source === filter.trustLevel)
    }
    return all
  }

  /**
   * Get a skill by name.
   * Returns undefined if the skill has not been discovered.
   */
  get(name: string): DiscoveredSkill | undefined {
    return this.discovered.get(name)
  }

  /**
   * Reload a specific skill from disk (after the user modifies its files).
   * Re-validates with SkillSandbox before updating the registry.
   *
   * @returns true if reloaded successfully, false if validation failed
   */
  async reload(name: string): Promise<boolean> {
    const existing = this.discovered.get(name)
    if (!existing) {
      log.warn("reload: skill not found", { name })
      return false
    }

    const fresh = await this.loadSkill(existing.path, existing.source)
    if (!fresh) {
      log.warn("reload: skill failed validation after reload", { name })
      return false
    }

    this.discovered.set(name, fresh)
    log.info("skill reloaded", { name, path: existing.path })
    return true
  }

  /**
   * Format the discovered skill list as a human-readable markdown string.
   * Suitable for displaying to the user via the CLI or chat.
   */
  formatList(): string {
    if (this.discovered.size === 0) {
      return "No skills discovered. Add skills to workspace/skills/ or .edith/skills/."
    }

    const byTier = new Map<SkillTrustLevel, DiscoveredSkill[]>()
    for (const skill of this.discovered.values()) {
      const tier = skill.source
      if (!byTier.has(tier)) {
        byTier.set(tier, [])
      }
      byTier.get(tier)!.push(skill)
    }

    const lines: string[] = ["# Available Skills"]
    for (const [tier, skills] of byTier) {
      lines.push(`\n## ${tier.charAt(0).toUpperCase() + tier.slice(1)} Skills`)
      for (const skill of skills) {
        const perms = skill.manifest.permissions.length > 0
          ? ` [${skill.manifest.permissions.join(", ")}]`
          : ""
        lines.push(`- **${skill.manifest.name}** v${skill.manifest.version}${perms}: ${skill.manifest.description}`)
      }
    }
    return lines.join("\n")
  }

  // ============================================================
  //  Private helpers
  // ============================================================

  private async scanDirectory(dirPath: string, trustLevel: SkillTrustLevel): Promise<number> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      let count = 0

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }

        const skillDir = path.join(dirPath, entry.name)
        const skill = await this.loadSkill(skillDir, trustLevel)

        if (skill) {
          this.discovered.set(skill.manifest.name, skill)
          count += 1
        }
      }

      return count
    } catch (err: unknown) {
      const isNotFound = typeof err === "object"
        && err !== null
        && "code" in err
        && (err as { code?: string }).code === "ENOENT"

      if (!isNotFound) {
        log.warn("skill directory scan failed", { dir: dirPath, err })
      }
      return 0
    }
  }

  private async loadSkill(skillDir: string, trustLevel: SkillTrustLevel): Promise<DiscoveredSkill | null> {
    try {
      const manifest = await this.parseManifest(skillDir, trustLevel)
      if (!manifest) {
        return null
      }

      // Validate with sandbox before registering
      const validation = skillSandbox.validateManifest(manifest)

      if (!validation.valid) {
        log.warn("skill manifest validation failed — skill skipped", {
          dir: skillDir,
          errors: validation.errors,
        })
        return null
      }

      for (const warning of validation.warnings) {
        log.warn("skill manifest warning", { skill: manifest.name, warning })
      }

      // Hash the manifest for integrity tracking
      const manifestContent = JSON.stringify(manifest)
      const manifestHash = createHash("sha256").update(manifestContent).digest("hex").slice(0, 16)

      // Check for SKILL.md entrypoint
      const entrypointPath = path.join(skillDir, "SKILL.md")
      const hasEntrypoint = await fs.access(entrypointPath).then(() => true).catch(() => false)

      return {
        manifest,
        path: skillDir,
        source: trustLevel,
        manifestHash,
        entrypointPath: hasEntrypoint ? entrypointPath : undefined,
      }
    } catch (err) {
      log.debug("loadSkill failed", { skillDir, err })
      return null
    }
  }

  /**
   * Parse a skill manifest from `skill.json` in the skill directory.
   * Falls back to auto-generating a minimal manifest from `SKILL.md` frontmatter.
   */
  private async parseManifest(
    skillDir: string,
    trustLevel: SkillTrustLevel,
  ): Promise<SkillManifest | null> {
    // Try skill.json first
    const jsonPath = path.join(skillDir, "skill.json")
    try {
      const raw = await fs.readFile(jsonPath, "utf-8")
      const parsed = JSON.parse(raw) as Partial<SkillManifest>

      if (!parsed.name || !parsed.version) {
        log.debug("skill.json missing required fields", { skillDir })
        return null
      }

      return {
        name: String(parsed.name),
        version: String(parsed.version),
        description: String(parsed.description ?? ""),
        permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
        trustLevel,
      }
    } catch {
      // Fall through to SKILL.md
    }

    // Fallback: parse SKILL.md frontmatter
    const mdPath = path.join(skillDir, "SKILL.md")
    try {
      const content = await fs.readFile(mdPath, "utf-8")
      return this.parseSkillMdManifest(content, skillDir, trustLevel)
    } catch {
      return null
    }
  }

  /**
   * Auto-generate a minimal manifest from SKILL.md frontmatter.
   * Supported frontmatter keys: name, version, description, permissions, triggers.
   */
  private parseSkillMdManifest(
    content: string,
    skillDir: string,
    trustLevel: SkillTrustLevel,
  ): SkillManifest | null {
    // Extract YAML frontmatter between --- delimiters
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) {
      // No frontmatter — generate minimal manifest from directory name
      const name = path.basename(skillDir).replace(/[^a-z0-9-]/gi, "-").toLowerCase()
      return {
        name,
        version: "1.0.0",
        description: `${name} skill`,
        permissions: [],
        trustLevel,
      }
    }

    const frontmatter = match[1] ?? ""
    const getName = (): string => {
      const m = frontmatter.match(/^name:\s*(.+)$/m)
      return m ? m[1]!.trim().replace(/['"]/g, "") : path.basename(skillDir)
    }
    const getVersion = (): string => {
      const m = frontmatter.match(/^version:\s*(.+)$/m)
      return m ? m[1]!.trim().replace(/['"]/g, "") : "1.0.0"
    }
    const getDescription = (): string => {
      const m = frontmatter.match(/^description:\s*(.+)$/m)
      return m ? m[1]!.trim().replace(/['"]/g, "") : ""
    }

    return {
      name: getName(),
      version: getVersion(),
      description: getDescription(),
      permissions: [],
      trustLevel,
    }
  }
}

/** Singleton export. */
export const skillMarketplace = new SkillMarketplace()
