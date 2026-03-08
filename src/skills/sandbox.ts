/**
 * @file sandbox.ts
 * @description SkillSandbox — capability-based permission enforcement for skill execution.
 *
 * ARCHITECTURE:
 *   Every skill declares the tool permissions it needs in its manifest.
 *   Before any tool call from inside a skill, SkillSandbox.check() verifies
 *   the tool is within the declared permission set.
 *
 *   Three trust tiers determine which permissions are available:
 *     system:   workspace/skills/ — pre-approved, bundled with EDITH
 *     user:     .edith/skills/    — user-added, semi-trusted
 *     external: ~/.edith/external/ — third-party, most restrictive
 *
 *   External skills CANNOT request 'system' permission, and CANNOT request
 *   both 'execute_code' AND 'network' simultaneously (supply chain attack vector).
 *
 * PAPER BASIS:
 *   - SkillFortify (arXiv:2603.00195): capability-based sandboxing with confinement proof —
 *     skills may only use tools explicitly declared; undeclared = blocked at runtime
 *   - Agent Skills in the Wild (arXiv:2601.10338): 26.1% of skills vulnerable;
 *     3 main categories: data exfiltration, privilege escalation, supply chain
 *   - Agent Skills Architecture (arXiv:2602.12430): 4-tier trust model, progressive
 *     context disclosure, capability declaration before runtime
 *
 * @module skills/sandbox
 */

import { createLogger } from "../logger.js"

const log = createLogger("skills.sandbox")

/** Permission identifiers that a skill can declare in its manifest. */
export type SkillPermission =
  | "read_file"     // fileReadTool, fileListTool, fileAgentTool
  | "write_file"    // fileWriteTool
  | "network"       // searchTool, httpTool, browserTool
  | "execute_code"  // codeRunnerTool, terminalTool
  | "memory_read"   // memoryQueryTool
  | "memory_write"  // implicit from pipeline
  | "channel_send"  // channelSendTool, channelStatusTool
  | "system"        // systemTool — elevated; system trust level only

/** Trust tiers for skills. */
export type SkillTrustLevel = "system" | "user" | "external"

/**
 * Maps each permission to the tool names it covers.
 * A skill requesting 'read_file' can only call the tools listed here.
 */
export const PERMISSION_TOOL_MAP: Record<SkillPermission, readonly string[]> = {
  read_file: ["fileReadTool", "fileListTool", "fileAgentTool"],
  write_file: ["fileWriteTool"],
  network: ["searchTool", "httpTool", "browserTool"],
  execute_code: ["codeRunnerTool", "terminalTool"],
  memory_read: ["memoryQueryTool"],
  memory_write: [],
  channel_send: ["channelSendTool", "channelStatusTool"],
  system: ["systemTool"],
}

/**
 * Manifest describing a skill's identity, version, and capability requirements.
 * Parsed from `skill.json` in the skill directory.
 */
export interface SkillManifest {
  /** Unique skill name (kebab-case recommended). */
  name: string
  /** SemVer version string. */
  version: string
  /** One-line description of the skill. */
  description: string
  /** Permissions this skill requires. Empty means read-only by default. */
  permissions: SkillPermission[]
  /** Trust tier — determined by which directory the skill lives in. */
  trustLevel: SkillTrustLevel
}

/** Result of a sandbox permission check. */
export interface SandboxCheckResult {
  /** Whether the tool call is allowed. */
  allowed: boolean
  /** Reason for denial (only set when allowed=false). */
  reason?: string
  /** Permission that would cover this tool (informational). */
  requiredPermission?: SkillPermission
}

/** Result of manifest validation. */
export interface ManifestValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
}

/**
 * SkillSandbox — enforces capability-based access control for skills.
 *
 * Usage:
 *   const result = skillSandbox.check(manifest, 'browserTool')
 *   if (!result.allowed) throw new Error(result.reason)
 *
 *   const allowed = skillSandbox.filterTools(manifest, allTools)
 *   // Pass `allowed` to skill executor instead of full toolset
 */
export class SkillSandbox {
  /**
   * Check whether a skill is allowed to use a specific tool.
   *
   * @param manifest      - The skill's manifest
   * @param requestedTool - The tool name being requested
   */
  check(manifest: SkillManifest, requestedTool: string): SandboxCheckResult {
    // Find which permission covers this tool
    const requiredPermission = this.findRequiredPermission(requestedTool)

    if (!requiredPermission) {
      // Tool not in any permission map — blocked by default (unknown tool)
      log.warn("sandbox: unknown tool blocked", {
        skill: manifest.name,
        tool: requestedTool,
      })
      return {
        allowed: false,
        reason: `Tool '${requestedTool}' is not registered in any permission category.`,
      }
    }

    // Check if this permission is declared
    if (!manifest.permissions.includes(requiredPermission)) {
      log.warn("sandbox: permission denied", {
        skill: manifest.name,
        tool: requestedTool,
        required: requiredPermission,
        declared: manifest.permissions,
      })
      return {
        allowed: false,
        reason: `Skill '${manifest.name}' has not declared '${requiredPermission}' permission. Add it to the skill manifest to enable this tool.`,
        requiredPermission,
      }
    }

    // Trust level gate: 'system' permission requires system trust
    if (requiredPermission === "system" && manifest.trustLevel !== "system") {
      log.warn("sandbox: system permission denied for non-system skill", {
        skill: manifest.name,
        trustLevel: manifest.trustLevel,
      })
      return {
        allowed: false,
        reason: `Skill '${manifest.name}' requires 'system' permission but has trust level '${manifest.trustLevel}'. Only system-tier skills may use system tools.`,
        requiredPermission,
      }
    }

    return { allowed: true, requiredPermission }
  }

  /**
   * Filter a full tool set down to only the tools permitted by this skill's manifest.
   * Returns a new object containing only the allowed tool entries.
   *
   * @param manifest  - The skill manifest
   * @param allTools  - The full available tool map
   */
  filterTools(
    manifest: SkillManifest,
    allTools: Record<string, unknown>,
  ): Record<string, unknown> {
    const allowed = new Set<string>()

    for (const permission of manifest.permissions) {
      const tools = PERMISSION_TOOL_MAP[permission]
      for (const tool of tools) {
        allowed.add(tool)
      }
    }

    const filtered: Record<string, unknown> = {}
    for (const [name, tool] of Object.entries(allTools)) {
      if (allowed.has(name)) {
        filtered[name] = tool
      }
    }

    log.debug("tools filtered by sandbox", {
      skill: manifest.name,
      total: Object.keys(allTools).length,
      allowed: Object.keys(filtered).length,
    })

    return filtered
  }

  /**
   * Validate a skill manifest before it is registered.
   *
   * Rules enforced:
   *   - 'external' skills cannot request 'system' permission
   *   - 'external' skills cannot request 'execute_code' + 'network' simultaneously
   *   - Warn if skill requests more than 3 permissions (principle of least privilege)
   *   - Warn if permission list has duplicates
   */
  validateManifest(manifest: SkillManifest): ManifestValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (!manifest.name || manifest.name.trim().length === 0) {
      errors.push("Manifest missing required field: name")
    }

    if (!manifest.version || manifest.version.trim().length === 0) {
      errors.push("Manifest missing required field: version")
    }

    if (manifest.trustLevel === "external") {
      if (manifest.permissions.includes("system")) {
        errors.push(
          "External skills cannot request 'system' permission (supply chain risk). Use a user-tier skill instead.",
        )
      }

      if (
        manifest.permissions.includes("execute_code")
        && manifest.permissions.includes("network")
      ) {
        errors.push(
          "External skills cannot request both 'execute_code' and 'network' permissions simultaneously (data exfiltration risk per arXiv:2601.10338).",
        )
      }
    }

    if (manifest.permissions.length > 3) {
      warnings.push(
        `Skill '${manifest.name}' requests ${manifest.permissions.length} permissions. Consider reducing to the minimum needed (principle of least privilege).`,
      )
    }

    const unique = new Set(manifest.permissions)
    if (unique.size !== manifest.permissions.length) {
      warnings.push("Manifest contains duplicate permission entries.")
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    }
  }

  // ============================================================
  //  Private helpers
  // ============================================================

  private findRequiredPermission(toolName: string): SkillPermission | null {
    for (const [permission, tools] of Object.entries(PERMISSION_TOOL_MAP)) {
      if ((tools as readonly string[]).includes(toolName)) {
        return permission as SkillPermission
      }
    }
    return null
  }
}

/** Singleton export. */
export const skillSandbox = new SkillSandbox()
