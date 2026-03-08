/**
 * @file permission-manager.ts
 * @description Per-tool permission management — check, grant, revoke, and
 * time-scope access grants. Integrates with the audit log for all denials.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Loaded once in `src/core/startup.ts`
 *   - `check()` is called by tool wrappers before execution
 *   - `grant()` / `revoke()` are called via admin skill commands
 *   - `permission-store.ts` handles JSON persistence of grants
 *   - `audit-interceptor.ts` handles writing denial audit entries
 *
 * DESIGN DECISIONS:
 *   - Wildcard support: granting "filesystem.*" grants all filesystem.X tools
 *   - Time-scoped grants: `expiresAt` ISO string — expired grants are silently rejected
 *   - Scope matches are enforced in calling code, not here (too context-specific)
 */

import { createLogger } from "../logger.js"
import { permissionStore, type PermissionGrant } from "./permission-store.js"
import { auditDenied } from "./audit-interceptor.js"

const log = createLogger("security.permission-manager")

// ── Types ──────────────────────────────────────────────────────────────────────

/** Result of a permission check */
export interface CheckResult {
  allowed: boolean
  reason?: string
  grant?: PermissionGrant
}

/** Options when granting a permission */
export interface GrantOptions {
  /** Duration in milliseconds. Omit for indefinite grant. */
  ttlMs?: number
  /** Scope restriction (e.g. directory path) */
  scope?: string
  /** Human-readable reason for the grant */
  reason?: string
}

// ── PermissionManager ─────────────────────────────────────────────────────────

/**
 * Central permission manager. All tool calls requiring explicit authorisation
 * should call `permissionManager.check()` first.
 */
export class PermissionManager {
  /**
   * Check whether `userId` has permission to call `tool`.
   *
   * Lookup order:
   * 1. Exact match: `tool === grant.key`
   * 2. Wildcard match: grant.key ends with `.*` and tool shares the prefix
   * 3. Global wildcard: grant.key === "*"
   *
   * Expired grants are automatically pruned.
   *
   * @param tool   - Tool identifier (e.g. "calendar.createEvent")
   * @param userId - Requesting user
   * @param channel - Optional channel hint (for audit)
   * @returns `CheckResult`
   */
  async check(tool: string, userId: string, channel?: string): Promise<CheckResult> {
    const grants = await permissionStore.forUser(userId)
    const now = new Date()

    for (const grant of grants) {
      // Skip expired
      if (grant.expiresAt && new Date(grant.expiresAt) <= now) continue

      if (this.matches(grant.key, tool)) {
        return { allowed: true, grant }
      }
    }

    const reason = `No active grant for "${tool}" (user: ${userId})`
    log.debug("permission denied", { tool, userId, channel })

    void auditDenied(tool, {}, { userId, channel }, reason).catch(
      err => log.warn("auditDenied failed", { err }),
    )

    return { allowed: false, reason }
  }

  /**
   * Grant permission to `userId` for `tool`.
   *
   * @param tool    - Tool identifier (supports wildcards like "filesystem.*")
   * @param userId  - User receiving the grant
   * @param options - TTL, scope, reason
   */
  async grant(tool: string, userId: string, options: GrantOptions = {}): Promise<void> {
    const now = new Date()
    const grant: PermissionGrant = {
      key: tool,
      userId,
      grantedAt: now.toISOString(),
      expiresAt: options.ttlMs
        ? new Date(now.getTime() + options.ttlMs).toISOString()
        : undefined,
      scope: options.scope,
      reason: options.reason,
    }
    await permissionStore.add(grant)
    log.info("permission granted", { tool, userId, expiresAt: grant.expiresAt })
  }

  /**
   * Revoke a previously granted permission.
   *
   * @param tool   - Tool identifier
   * @param userId - User whose grant is being revoked
   * @returns `true` if revoked, `false` if no grant existed
   */
  async revoke(tool: string, userId: string): Promise<boolean> {
    const removed = await permissionStore.remove(tool, userId)
    if (removed) log.info("permission revoked", { tool, userId })
    return removed
  }

  /**
   * List all active (non-expired) grants for `userId`.
   */
  async listActive(userId: string): Promise<PermissionGrant[]> {
    const grants = await permissionStore.forUser(userId)
    const now = new Date()
    return grants.filter(g => !g.expiresAt || new Date(g.expiresAt) > now)
  }

  /**
   * Prune all expired grants from storage.
   * Call periodically from the background daemon.
   */
  async pruneExpired(): Promise<number> {
    return permissionStore.pruneExpired()
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Determine whether `grantKey` matches `tool`.
   *
   * - `"*"` matches everything
   * - `"calendar.*"` matches `"calendar.createEvent"`, `"calendar.list"`, etc.
   * - `"calendar.createEvent"` matches only `"calendar.createEvent"`
   */
  private matches(grantKey: string, tool: string): boolean {
    if (grantKey === "*") return true
    if (grantKey === tool) return true
    if (grantKey.endsWith(".*")) {
      const prefix = grantKey.slice(0, -2)
      return tool === prefix || tool.startsWith(prefix + ".")
    }
    return false
  }
}

/** Singleton permission manager */
export const permissionManager = new PermissionManager()
