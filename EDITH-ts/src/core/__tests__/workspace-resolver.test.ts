import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WorkspaceResolver } from "../workspace-resolver.js"

describe("WorkspaceResolver", () => {
  let tempDir: string
  let resolver: WorkspaceResolver
  let originalSaasMode: string | undefined
  let originalSaasDir: string | undefined

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edith-saas-"))
    originalSaasMode = process.env.EDITH_SAAS_MODE
    originalSaasDir = process.env.EDITH_SAAS_DATA_DIR
    process.env.EDITH_SAAS_MODE = "true"
    process.env.EDITH_SAAS_DATA_DIR = tempDir
    resolver = new WorkspaceResolver()
  })

  afterEach(async () => {
    resolver.dispose()
    if (originalSaasMode === undefined) {
      delete process.env.EDITH_SAAS_MODE
    } else {
      process.env.EDITH_SAAS_MODE = originalSaasMode
    }
    if (originalSaasDir === undefined) {
      delete process.env.EDITH_SAAS_DATA_DIR
    } else {
      process.env.EDITH_SAAS_DATA_DIR = originalSaasDir
    }
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("deep-merges nested tenant config updates without dropping defaults", async () => {
    await resolver.resolve("user-a", {
      features: { enableVoice: true },
    })

    await resolver.updateTenantConfig("user-a", {
      limits: { maxSkills: 10 },
    })

    const context = await resolver.getContext("user-a")
    expect(context).not.toBeNull()
    expect(context?.tenant.features.enableVoice).toBe(true)
    expect(context?.tenant.features.enableApi).toBe(false)
    expect(context?.tenant.limits.maxSkills).toBe(10)
    expect(context?.tenant.limits.maxMessagesPerDay).toBe(100)
  })

  it("sanitizes empty filesystem user ids to a safe fallback directory", async () => {
    const workspace = await resolver.resolve("!!!")

    expect(workspace).toContain(`${path.sep}user${path.sep}workspace`)
  })
})
