/**
 * @file marketplace.test.ts
 * @description Unit tests for SkillMarketplace (Phase 11 Atom 3).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
// Mock fs to avoid real filesystem access in unit tests
vi.mock("node:fs/promises", () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
  },
}))

import fs from "node:fs/promises"
import { SkillMarketplace } from "../marketplace.js"

function mockDirEntry(name: string, isDir = true) {
  return { name, isDirectory: () => isDir }
}

function mockManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    permissions: ["read_file"],
    ...overrides,
  })
}

describe("SkillMarketplace", () => {
  let marketplace: SkillMarketplace

  beforeEach(() => {
    marketplace = new SkillMarketplace()
    vi.clearAllMocks()
  })

  describe("discover", () => {
    it("returns 0 when all skill directories are missing (ENOENT)", async () => {
      vi.mocked(fs.readdir).mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }))

      const count = await marketplace.discover()
      expect(count).toBe(0)
    })

    it("loads a valid skill from skill.json", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce([mockDirEntry("my-skill")] as never) // system dir
        .mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }))  // user, external: not found

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(mockManifest({ name: "my-skill" }) as never)

      vi.mocked(fs.access).mockRejectedValue(new Error("no SKILL.md"))

      const count = await marketplace.discover()
      expect(count).toBe(1)
      expect(marketplace.get("my-skill")).toBeDefined()
    })

    it("skips invalid manifest files without crashing", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce([mockDirEntry("bad-skill")] as never)
        .mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }))

      // skill.json is invalid JSON
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce("not valid json" as never)
        // SKILL.md fallback also fails
        .mockRejectedValue(new Error("no SKILL.md"))

      const count = await marketplace.discover()
      expect(count).toBe(0)
    })

    it("falls back to SKILL.md when skill.json is missing", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce([mockDirEntry("md-skill")] as never)
        .mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }))

      const skillMdContent = `---
name: md-skill
version: 1.2.0
description: Skill from markdown
---

# md-skill

This skill does stuff.`

      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error("no skill.json")) // skill.json missing
        .mockResolvedValueOnce(skillMdContent as never)    // SKILL.md

      vi.mocked(fs.access).mockRejectedValue(new Error("no SKILL.md entrypoint"))

      const count = await marketplace.discover()
      expect(count).toBe(1)
      const skill = marketplace.get("md-skill")
      expect(skill).toBeDefined()
      expect(skill?.manifest.version).toBe("1.2.0")
    })

    it("generates minimal manifest from directory name when SKILL.md has no frontmatter", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce([mockDirEntry("simple-skill")] as never)
        .mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }))

      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error("no skill.json"))
        .mockResolvedValueOnce("# Simple Skill\n\nNo frontmatter here." as never)

      vi.mocked(fs.access).mockRejectedValue(new Error())

      const count = await marketplace.discover()
      expect(count).toBe(1)
      const skill = marketplace.get("simple-skill")
      expect(skill?.manifest.name).toBe("simple-skill")
    })
  })

  describe("list", () => {
    it("returns empty array before discover()", () => {
      expect(marketplace.list()).toEqual([])
    })

    it("filters by trust level", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce([mockDirEntry("sys-skill")] as never) // system
        .mockResolvedValueOnce([mockDirEntry("user-skill")] as never) // user
        .mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }))

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(mockManifest({ name: "sys-skill" }) as never)
        .mockResolvedValueOnce(mockManifest({ name: "user-skill" }) as never)

      vi.mocked(fs.access).mockRejectedValue(new Error())

      await marketplace.discover()

      const systemSkills = marketplace.list({ trustLevel: "system" })
      const userSkills = marketplace.list({ trustLevel: "user" })

      expect(systemSkills.some((s) => s.manifest.name === "sys-skill")).toBe(true)
      expect(userSkills.some((s) => s.manifest.name === "user-skill")).toBe(true)
      expect(systemSkills.some((s) => s.manifest.name === "user-skill")).toBe(false)
    })
  })

  describe("formatList", () => {
    it("returns no-skills message when empty", () => {
      const result = marketplace.formatList()
      expect(result).toContain("No skills discovered")
    })
  })

  describe("get", () => {
    it("returns undefined for unknown skill", () => {
      expect(marketplace.get("nonexistent")).toBeUndefined()
    })
  })
})
