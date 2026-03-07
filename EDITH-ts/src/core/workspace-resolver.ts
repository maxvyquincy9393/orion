/**
 * Workspace Resolver - OC-12 Implementation
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

import { getEdithConfig } from "../config/edith-config.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.workspace-resolver")

const TENANT_CACHE_MAX_AGE_MS = 5 * 60 * 1000

/**
 * Tenant configuration interface
 */
export interface TenantConfig {
  tenantId: string
  userId: string
  displayName?: string
  tier: "free" | "pro" | "enterprise"
  limits: {
    maxMessagesPerDay: number
    maxStorageMb: number
    maxSkills: number
    apiRateLimit: number
  }
  features: {
    enableVoice: boolean
    enableVision: boolean
    enableCustomSkills: boolean
    enableApi: boolean
  }
  customConfig?: Record<string, unknown>
}

/**
 * Workspace context for a tenant
 */
export interface WorkspaceContext {
  path: string
  tenant: TenantConfig
  createdAt: Date
  lastAccessedAt: Date
}

type TenantConfigOverrides = Partial<Omit<TenantConfig, "tenantId" | "userId" | "limits" | "features">> & {
  limits?: Partial<TenantConfig["limits"]>
  features?: Partial<TenantConfig["features"]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function safeDateFromUnknown(value: unknown, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  const parsed = new Date(String(value ?? ""))
  if (Number.isNaN(parsed.getTime())) {
    return fallback
  }
  return parsed
}

/**
 * Multi-tenant workspace resolver
 */
export class WorkspaceResolver {
  private readonly saasMode: boolean
  private readonly saasDataDir: string
  private readonly tenantCache = new Map<string, WorkspaceContext>()
  private readonly cacheMaxAgeMs = TENANT_CACHE_MAX_AGE_MS
  private readonly cacheCleanupTimer: NodeJS.Timeout

  constructor() {
    this.saasMode = process.env.EDITH_SAAS_MODE === "true"
    this.saasDataDir =
      process.env.EDITH_SAAS_DATA_DIR ?? path.resolve(process.cwd(), "data/users")

    this.cacheCleanupTimer = setInterval(() => this.cleanupCache(), this.cacheMaxAgeMs)
    this.cacheCleanupTimer.unref?.()
  }

  async resolve(userId: string, tenantConfig?: TenantConfigOverrides): Promise<string> {
    if (this.saasMode) {
      return this.resolveSaasWorkspace(userId, tenantConfig)
    }

    return this.resolveSharedWorkspace()
  }

  async getContext(userId: string): Promise<WorkspaceContext | null> {
    const cacheKey = this.sanitizeUserId(userId)
    const cached = this.tenantCache.get(cacheKey)
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
        this.tenantCache.set(cacheKey, context)
      }
      return context
    } catch (error) {
      log.warn("Failed to load tenant context", { userId, error })
      return null
    }
  }

  private async resolveSaasWorkspace(
    userId: string,
    tenantConfig?: TenantConfigOverrides,
  ): Promise<string> {
    const workspaceDir = this.getTenantWorkspaceDir(userId)
    await this.ensureTenantWorkspaceDirectories(workspaceDir)
    await this.provisionDefaultFiles(workspaceDir)

    const baseConfig = (await this.loadTenantConfig(userId)) ?? this.createDefaultTenantConfig(userId)
    const resolvedTenantConfig = tenantConfig
      ? this.mergeTenantConfig(baseConfig, tenantConfig)
      : baseConfig

    if (tenantConfig) {
      await this.saveTenantConfig(userId, resolvedTenantConfig)
    }

    const now = new Date()
    const context: WorkspaceContext = {
      path: workspaceDir,
      tenant: resolvedTenantConfig,
      createdAt: now,
      lastAccessedAt: now,
    }
    this.tenantCache.set(this.sanitizeUserId(userId), context)

    return workspaceDir
  }

  private async resolveSharedWorkspace(): Promise<string> {
    const config = getEdithConfig()
    const workspace = path.resolve(process.cwd(), config.agents.defaults.workspace)
    await fs.mkdir(workspace, { recursive: true })
    return workspace
  }

  private getTenantRootDir(userId: string): string {
    return path.join(this.saasDataDir, this.sanitizeUserId(userId))
  }

  private getTenantWorkspaceDir(userId: string): string {
    return path.join(this.getTenantRootDir(userId), "workspace")
  }

  private getTenantConfigPath(userId: string): string {
    return path.join(this.getTenantRootDir(userId), "config", "tenant.json")
  }

  private async ensureTenantWorkspaceDirectories(workspaceDir: string): Promise<void> {
    await fs.mkdir(workspaceDir, { recursive: true })
    await Promise.all([
      fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true }),
      fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true }),
      fs.mkdir(path.join(workspaceDir, "logs"), { recursive: true }),
      fs.mkdir(path.join(workspaceDir, "config"), { recursive: true }),
    ])
  }

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
        continue
      } catch {
        // File missing - provision from shared template if available.
      }

      const sourcePath = path.resolve(process.cwd(), source)
      try {
        await fs.copyFile(sourcePath, targetPath)
        log.debug("Provisioned tenant workspace file", { target })
      } catch {
        // Source template may not exist in all deployments.
      }
    }
  }

  private async loadTenantConfig(userId: string): Promise<TenantConfig | null> {
    const configPath = this.getTenantConfigPath(userId)

    try {
      const raw = await fs.readFile(configPath, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) {
        return null
      }

      return this.mergeTenantConfig(
        this.createDefaultTenantConfig(userId),
        parsed as TenantConfigOverrides,
      )
    } catch {
      return null
    }
  }

  private async saveTenantConfig(userId: string, config: TenantConfig): Promise<void> {
    const configPath = this.getTenantConfigPath(userId)
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")
  }

  private async loadTenantContext(userId: string): Promise<WorkspaceContext | null> {
    const tenant = await this.loadTenantConfig(userId)
    if (!tenant) {
      return null
    }

    const workspaceDir = this.getTenantWorkspaceDir(userId)
    const configPath = this.getTenantConfigPath(userId)
    let createdAt = new Date()
    let lastAccessedAt = new Date()

    try {
      const [workspaceStat, configStat] = await Promise.all([
        fs.stat(workspaceDir),
        fs.stat(configPath).catch(() => null),
      ])

      createdAt = safeDateFromUnknown(workspaceStat.birthtime ?? workspaceStat.ctime, createdAt)
      const latestActivity = configStat?.mtime && configStat.mtime > workspaceStat.mtime
        ? configStat.mtime
        : workspaceStat.mtime
      lastAccessedAt = safeDateFromUnknown(latestActivity, lastAccessedAt)
    } catch {
      // If stats are unavailable, return a valid context with current timestamps.
    }

    return {
      path: workspaceDir,
      tenant,
      createdAt,
      lastAccessedAt,
    }
  }

  private createDefaultTenantConfig(userId: string): TenantConfig {
    return {
      tenantId: userId,
      userId,
      tier: "free",
      limits: {
        maxMessagesPerDay: 100,
        maxStorageMb: 50,
        maxSkills: 3,
        apiRateLimit: 60,
      },
      features: {
        enableVoice: false,
        enableVision: false,
        enableCustomSkills: false,
        enableApi: false,
      },
    }
  }

  private mergeTenantConfig(base: TenantConfig, overrides: TenantConfigOverrides): TenantConfig {
    const merged: TenantConfig = {
      ...base,
      ...overrides,
      tenantId: base.tenantId,
      userId: base.userId,
      limits: {
        ...base.limits,
        ...(overrides.limits ?? {}),
      },
      features: {
        ...base.features,
        ...(overrides.features ?? {}),
      },
    }

    if (base.customConfig || overrides.customConfig) {
      merged.customConfig = {
        ...(base.customConfig ?? {}),
        ...(overrides.customConfig ?? {}),
      }
    }

    return merged
  }

  private sanitizeUserId(userId: string): string {
    const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
    if (sanitized.length === 0) {
      return "user"
    }
    // Avoid opaque directories like "___" when the raw id has no usable identifier chars.
    return /[a-zA-Z0-9]/.test(sanitized) ? sanitized : "user"
  }

  isSaasMode(): boolean {
    return this.saasMode
  }

  async hasFeature(userId: string, feature: keyof TenantConfig["features"]): Promise<boolean> {
    const context = await this.getContext(userId)
    return context?.tenant.features[feature] ?? false
  }

  async checkLimit(
    userId: string,
    limit: keyof TenantConfig["limits"],
    currentValue: number,
  ): Promise<boolean> {
    const context = await this.getContext(userId)
    if (!context) {
      return false
    }

    return currentValue < context.tenant.limits[limit]
  }

  async updateTenantConfig(
    userId: string,
    updates: TenantConfigOverrides,
  ): Promise<void> {
    const existing = await this.loadTenantConfig(userId)
    const base = existing ?? this.createDefaultTenantConfig(userId)
    const updated = this.mergeTenantConfig(base, updates)

    await this.saveTenantConfig(userId, updated)

    const cacheKey = this.sanitizeUserId(userId)
    const cached = this.tenantCache.get(cacheKey)
    if (cached) {
      cached.tenant = updated
      cached.lastAccessedAt = new Date()
    }

    log.info("Updated tenant config", { userId, tier: updated.tier })
  }

  async listTenants(): Promise<string[]> {
    if (!this.saasMode) {
      return []
    }

    try {
      const entries = await fs.readdir(this.saasDataDir, { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      return []
    }
  }

  private cleanupCache(): void {
    const now = Date.now()
    for (const [userId, context] of this.tenantCache) {
      if (now - context.lastAccessedAt.getTime() > this.cacheMaxAgeMs) {
        this.tenantCache.delete(userId)
        log.debug("Cleaned up tenant cache", { userId })
      }
    }
  }

  getCacheStats(): { size: number; maxAge: number } {
    return {
      size: this.tenantCache.size,
      maxAge: this.cacheMaxAgeMs,
    }
  }

  dispose(): void {
    clearInterval(this.cacheCleanupTimer)
    this.tenantCache.clear()
  }
}

export const workspaceResolver = new WorkspaceResolver()
