import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { BootstrapLoader } from "../bootstrap.js"

describe("BootstrapLoader", () => {
  let tempDir: string
  let loader: BootstrapLoader

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edith-bootstrap-"))
    loader = new BootstrapLoader(tempDir)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("updateUserMd preserves literal '$' values and flattens newlines", async () => {
    await loader.updateUserMd({
      plan: "Tier $1\npriority",
    })

    const userMd = await fs.readFile(path.join(tempDir, "USER.md"), "utf-8")

    expect(userMd).toContain("plan: Tier $1 priority")
    expect(userMd).not.toContain("Tier  priority")
  })

  it("appendMemory writes one normalized bullet per fact", async () => {
    await loader.appendMemory("first line\n- injected bullet\n# heading")

    const memoryMd = await fs.readFile(path.join(tempDir, "MEMORY.md"), "utf-8")
    const bullets = memoryMd.split(/\r?\n/).filter((line) => line.startsWith("- ["))

    expect(bullets).toHaveLength(1)
    expect(bullets[0]).toContain("first line | - injected bullet | # heading")
  })
})
