import fs from "node:fs/promises"
import path from "node:path"

import { getOrionConfig } from "../config/orion-config.js"

export class WorkspaceResolver {
  private readonly saasMode: boolean
  private readonly saasDataDir: string

  constructor() {
    this.saasMode = process.env.ORION_SAAS_MODE === "true"
    this.saasDataDir =
      process.env.ORION_SAAS_DATA_DIR ?? path.resolve(process.cwd(), "data/users")
  }

  async resolve(userId: string): Promise<string> {
    if (this.saasMode) {
      const userDir = path.join(this.saasDataDir, this.sanitizeUserId(userId), "workspace")
      await fs.mkdir(userDir, { recursive: true })
      await fs.mkdir(path.join(userDir, "skills"), { recursive: true })
      await fs.mkdir(path.join(userDir, "memory"), { recursive: true })

      const soulPath = path.join(userDir, "SOUL.md")
      try {
        await fs.access(soulPath)
      } catch {
        const defaultSoul = path.resolve(process.cwd(), "workspace/SOUL.md")
        try {
          await fs.copyFile(defaultSoul, soulPath)
        } catch {
          // noop
        }
      }

      return userDir
    }

    const config = getOrionConfig()
    const workspace = path.resolve(process.cwd(), config.agents.defaults.workspace)
    await fs.mkdir(workspace, { recursive: true })
    return workspace
  }

  private sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
  }

  isSaasMode(): boolean {
    return this.saasMode
  }
}

export const workspaceResolver = new WorkspaceResolver()
