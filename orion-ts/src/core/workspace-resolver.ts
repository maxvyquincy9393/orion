/**
 * Workspace Resolver - OC-12 Implementation
 *
 * Based on research:
 * - AWS AaaS Whitepaper 2026 (AI-as-a-Service architecture)
 * - Fast.io Multi-Tenant Guide
 *
 * Implements multi-tenant workspace resolution with:
 * - Tenant isolation (data, config, memory)
 * - Per-tenant configuration injection
 * - Automatic workspace provisioning
 * - Resource quotas and limits
 *
 * @module core/workspace-resolver
 */

import fs from "node:fs/promises"
import path from "node:path"

import { getOrionConfig } from "../config/orion-config.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.workspace-resolver")

/**
 * Tenant configuration interface
 */
export interface TenantConfig {
  /** Tenant identifier */
  tenantId: string
  /** User identifier within tenant */
  userId: string
  /** Display name */
  displayName?: string
  /** Tenant tier (affects quotas) */
  tier: "free" | "pro" | "enterprise"
  /** Resource limits */
  limits: {
    maxMessagesPerDay: number
    maxStorageMb: number
    maxSkills: number
    apiRateLimit: number
  }
  /** Feature flags */
  features: {
    enableVoice: boolean
    enableVision: boolean
    enableCustomSkills: boolean
    enableApi: boolean
  }
  /** Custom configuration overrides */
  customConfig?: Record<string, unknown>
}

/**
 * Workspace context for a tenant
 */
export interface WorkspaceContext {
  /** Resolved workspace path */
  path: string
  /** Tenant configuration */
  tenant: TenantConfig
  /** Creation timestamp */
  createdAt: Date
  /** Last access timestamp */
  lastAccessedAt: Date
}

/**
 * Multi-tenant workspace resolver
 *
 * Provides isolated workspaces per user/tenant with:
 * - Automatic directory structure creation
 * - Configuration injection
 * - Resource quota enforcement
 * - Tenant-level feature flags
 */
export class WorkspaceResolver {
  private readonly saasMode: boolean
  private readonly saasDataDir: string
  private readonly tenantCache = new Map<string, WorkspaceContext>()
  private readonly cacheMaxAgeMs = 5 * 60 * 1000 // 5 minutes

  constructor() {
    this.saasMode = process.env.ORION_SAAS_MODE === "true"
    this.saasDataDir =
      process.env.ORION_SAAS_DATA_DIR ?? path.resolve(process.cwd(), "data/users")

    // Start cache cleanup interval
    setInterval(() => this.cleanupCache(), this.cacheMaxAgeMs)
  }

  /**
   * Resolve workspace for a user
   *
   * In SaaS mode:
   * - Creates isolated directory per user
   * - Provisions default files if missing
   * - Enforces tenant configuration
   *
   * In single-tenant mode:
   * - Returns shared workspace
   *
   * @param userId - User identifier
   * @param tenantConfig - Optional tenant configuration (SaaS mode)
   * @returns Workspace path
   */
  async resolve(userId: string, tenantConfig?: Partial<TenantConfig>): Promise<string> {
    if (this.saasMode) {
      return this.resolveSaasWorkspace(userId, tenantConfig)
    }

    return this.resolveSharedWorkspace()
  }

  /**
   * Get full workspace context including tenant config
   *
   * @param userId - User identifier
   * @returns Workspace context or null if not found
   */
  async getContext(userId: string): Promise<WorkspaceContext | null> {
    const cached = this.tenantCache.get(userId)
    if (cached && Date.now() - cached.lastAccessedAt.getTime() < this.cacheMaxAgeMs) {
      cached.lastAccessedAt = new Date()
      return cached
    }

    if (!this.saasMode) {
      const workspacePath = await this.resolveSharedWorkspace()
      return {
        path: workspacePath,
        tenant: this.createDefaultTenantConfig(userId),
        createdAt: new Date(),
        lastAccessedAt: new Date(),
      }
    }

    try {
      const context = await this.loadTenantContext(userId)
      if (context) {
        this.tenantCache.set(userId, context)
      }
      return context
    } catch (error) {
      log.warn("Failed to load tenant context", { userId, error })
      return null
    }
  }

  /**
   * Resolve workspace in SaaS/multi-tenant mode
   */
  private async resolveSaasWorkspace(
    userId: string,
    tenantConfig?: Partial<TenantConfig>,
  ): Promise<string> {
    const sanitizedUserId = this.sanitizeUserId(userId)
    const userDir = path.join(this.saasDataDir, sanitizedUserId, "workspace")

    // Create directory structure
    await fs.mkdir(userDir, { recursive: true })
    await fs.mkdir(path.join(userDir, "skills"), { recursive: true })
    await fs.mkdir(path.join(userDir, "memory"), { recursive: true })
    await fs.mkdir(path.join(userDir, "logs"), { recursive: true })
    await fs.mkdir(path.join(userDir, "config"), { recursive: true })

    // Provision default files if missing
    await this.provisionDefaultFiles(userDir)

    // Save tenant config if provided
    if (tenantConfig) {
      await this.saveTenantConfig(userId, {
        ...this.createDefaultTenantConfig(userId),
        ...tenantConfig,
      })
    }

    // Update cache
    const context: WorkspaceContext = {
      path: userDir,
      tenant: tenantConfig
        ? { ...this.createDefaultTenantConfig(userId), ...tenantConfig }
        : (await this.loadTenantConfig(userId)) ?? this.createDefaultTenantConfig(userId),
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }
    this.tenantCache.set(userId, context)

    return userDir
  }

  /**
   * Resolve shared workspace (single-tenant mode)
   */
  private async resolveSharedWorkspace(): Promise<string> {
    const config = getOrionConfig()
    const workspace = path.resolve(process.cwd(), config.agents.defaults.workspace)
    await fs.mkdir(workspace, { recursive: true })
    return workspace
  }

  /**
   * Provision default workspace files
   */
  private async provisionDefaultFiles(userDir: string): Promise<void> {
    const files = [
      { source: "workspace/SOUL.md", target: "SOUL.md" },
      { source: "workspace/IDENTITY.md", target: "IDENTITY.md" },
      { source: "workspace/HEARTBEAT.md", target: "HEARTBEAT.md" },
    ]

    for (const { source, target } of files) {
      const targetPath = path.join(userDir, target)
      try {
        await fs.access(targetPath)
      } catch {
        const sourcePath = path.resolve(process.cwd(), source)
        try {
          await fs.copyFile(sourcePath, targetPath)
          log.debug(`Provisioned ${target} for tenant`)
        } catch {
          // Source might not exist, skip
        }
      }
    }
  }

  /**
   * Load tenant configuration from disk
   */
  private async loadTenantConfig(userId: string): Promise<TenantConfig | null> {
    const configPath = path.join(
      this.saasDataDir,
      this.sanitizeUserId(userId),
      "config",
      "tenant.json",
    )

    try {
      const raw = await fs.readFile(configPath, "utf-8")
      return JSON.parse(raw) as TenantConfig
    } catch {
      return null
    }
  }

  /**
   * Save tenant configuration to disk
   */
  private async saveTenantConfig(userId: string, config: TenantConfig): Promise<void> {
    const configPath = path.join(
      this.saasDataDir,
      this.sanitizeUserId(userId),
      "config",
      "tenant.json",
    )

    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  }

  /**
   * Load full tenant context including workspace path
   */
  private async loadTenantContext(userId: string): Promise<WorkspaceContext | null> {
    const config = await this.loadTenantConfig(userId)
    if (!config) {
      return null
    }

    const userDir = path.join(this.saasDataDir, this.sanitizeUserId(userId), "workspace")

    return {
      path: userDir,
      tenant: config,
      createdAt: new Date(), // TODO: Read from filesystem
      lastAccessedAt: new Date(),
    }
  }

  /**
   * Create default tenant configuration
   */
  private createDefaultTenantConfig(userId: string): TenantConfig {
    return {
      tenantId: userId,
      userId,
      tier: "free",
      limits: {
        maxMessagesPerDay: 100,
        maxStorageMb: 50,
        maxSkills: 3,
        apiRateLimit: 60, // requests per minute
      },
      features: {
        enableVoice: false,
        enableVision: false,
        enableCustomSkills: false,
        enableApi: false,
      },
    }
  }

  /**
   * Sanitize user ID for filesystem safety
   */
  private sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
  }

  /**
   * Check if running in SaaS mode
   */
  isSaasMode(): boolean {
    return this.saasMode
  }

  /**
   * Check if user has access to a feature
   *
   * @param userId - User identifier
   * @param feature - Feature name
   * @returns true if feature is enabled
   */
  async hasFeature(userId: string, feature: keyof TenantConfig["features"]): Promise<boolean> {
    const context = await this.getContext(userId)
    return context?.tenant.features[feature] ?? false
  }

  /**
   * Check if user is within resource limits
   *
   * @param userId - User identifier
   * @param limit - Limit to check
   * @param currentValue - Current usage value
   * @returns true if within limits
   */
  async checkLimit(
    userId: string,
    limit: keyof TenantConfig["limits"],
    currentValue: number,
  ): Promise<boolean> {
    const context = await this.getContext(userId)
    if (!context) {
      return false
    }

    const limitValue = context.tenant.limits[limit]
    return currentValue < limitValue
  }

  /**
   * Update tenant configuration
   *
   * @param userId - User identifier
   * @param updates - Configuration updates
   */
  async updateTenantConfig(
    userId: string,
    updates: Partial<Omit<TenantConfig, "tenantId" | "userId">>,
  ): Promise<void> {
    const existing = await this.loadTenantConfig(userId)
    const updated: TenantConfig = {
      ...this.createDefaultTenantConfig(userId),
      ...existing,
      ...updates,
      tenantId: userId,
      userId,
    }

    await this.saveTenantConfig(userId, updated)

    // Update cache
    const cached = this.tenantCache.get(userId)
    if (cached) {
      cached.tenant = updated
      cached.lastAccessedAt = new Date()
    }

    log.info("Updated tenant config", { userId, tier: updated.tier })
  }

  /**
   * Get all active tenants (SaaS mode only)
   *
   * @returns Array of tenant IDs
   */
  async listTenants(): Promise<string[]> {
    if (!this.saasMode) {
      return []
    }

    try {
      const entries = await fs.readdir(this.saasDataDir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now()
    for (const [userId, context] of this.tenantCache) {
      if (now - context.lastAccessedAt.getTime() > this.cacheMaxAgeMs) {
        this.tenantCache.delete(userId)
        log.debug("Cleaned up tenant cache", { userId })
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxAge: number } {
    return {
      size: this.tenantCache.size,
      maxAge: this.cacheMaxAgeMs,
    }
  }
}

// Export singleton instance
export const workspaceResolver = new WorkspaceResolver()
