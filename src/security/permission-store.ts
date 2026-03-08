/**
 * @file permission-store.ts
 * @description Persistent storage backend for tool permissions.
 * Persists grants to a JSON file under `permissions/`. Loaded once on startup
 * and written on every mutation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Used exclusively by `permission-manager.ts`
 *   - File path: `permissions/tool-grants.json`
 *   - File is created automatically if it doesn't exist
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
import { createLogger } from "../logger.js"

const log = createLogger("security.permission-store")

const GRANTS_PATH = "permissions/tool-grants.json"

// ── Types ──────────────────────────────────────────────────────────────────────

/** Describes when a permission was granted and by whom */
export interface PermissionGrant {
  /** Tool or resource identifier (e.g. "calendar.read", "filesystem.write:/home") */
  key: string
  /** User who granted permission */
  userId: string
  /** When the grant was issued */
  grantedAt: string
  /** ISO timestamp when the grant expires; undefined = indefinite */
  expiresAt?: string
  /** Scope restriction (e.g. specific paths for filesystem access) */
  scope?: string
  /** Human note */
  reason?: string
}

/** Shape of the JSON file */
export interface GrantsFile {
  version: 1
  grants: PermissionGrant[]
}

// ── PermissionStore ───────────────────────────────────────────────────────────

/**
 * Simple JSON-backed permission grant store.
 */
export class PermissionStore {
  private grants: PermissionGrant[] = []
  private loaded = false

  /**
   * Load grants from disk. Idempotent — safe to call multiple times.
   */
  async load(): Promise<void> {
    if (this.loaded) return
    if (!existsSync(GRANTS_PATH)) {
      this.grants = []
      this.loaded = true
      return
    }
    try {
      const raw = await readFile(GRANTS_PATH, "utf8")
      const parsed = JSON.parse(raw) as GrantsFile
      this.grants = parsed.grants ?? []
      log.debug("grants loaded", { count: this.grants.length })
    } catch (err) {
      log.warn("failed to load grants file, starting empty", { err })
      this.grants = []
    }
    this.loaded = true
  }

  /**
   * Add or update a grant.
   */
  async add(grant: PermissionGrant): Promise<void> {
    await this.load()
    const idx = this.grants.findIndex(
      g => g.key === grant.key && g.userId === grant.userId,
    )
    if (idx >= 0) {
      this.grants[idx] = grant
    } else {
      this.grants.push(grant)
    }
    await this.persist()
  }

  /**
   * Remove a grant by key and userId.
   * @returns `true` if the grant existed and was removed
   */
  async remove(key: string, userId: string): Promise<boolean> {
    await this.load()
    const before = this.grants.length
    this.grants = this.grants.filter(g => !(g.key === key && g.userId === userId))
    if (this.grants.length < before) {
      await this.persist()
      return true
    }
    return false
  }

  /**
   * Return all grants for a specific user.
   */
  async forUser(userId: string): Promise<PermissionGrant[]> {
    await this.load()
    return this.grants.filter(g => g.userId === userId)
  }

  /**
   * Find a specific grant.
   */
  async find(key: string, userId: string): Promise<PermissionGrant | undefined> {
    await this.load()
    return this.grants.find(g => g.key === key && g.userId === userId)
  }

  /**
   * Remove all expired grants from storage.
   */
  async pruneExpired(): Promise<number> {
    await this.load()
    const now = new Date()
    const before = this.grants.length
    this.grants = this.grants.filter(
      g => !g.expiresAt || new Date(g.expiresAt) > now,
    )
    const removed = before - this.grants.length
    if (removed > 0) {
      await this.persist()
      log.debug("pruned expired grants", { removed })
    }
    return removed
  }

  /**
   * Return all grants (for admin purposes).
   */
  async all(): Promise<PermissionGrant[]> {
    await this.load()
    return [...this.grants]
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async persist(): Promise<void> {
    const dir = dirname(GRANTS_PATH)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    const file: GrantsFile = { version: 1, grants: this.grants }
    await writeFile(GRANTS_PATH, JSON.stringify(file, null, 2) + "\n", "utf8")
    log.debug("grants persisted", { count: this.grants.length })
  }
}

/** Singleton permission store */
export const permissionStore = new PermissionStore()
