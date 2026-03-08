/**
 * @file sandbox.test.ts
 * @description Unit tests for SkillSandbox (Phase 11 Atom 2).
 */

import { describe, it, expect } from "vitest"
import { SkillSandbox, PERMISSION_TOOL_MAP } from "../sandbox.js"
import type { SkillManifest } from "../sandbox.js"

function makeManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "Test skill",
    permissions: [],
    trustLevel: "user",
    ...overrides,
  }
}

describe("SkillSandbox", () => {
  const sandbox = new SkillSandbox()

  describe("check", () => {
    it("allows a tool that is covered by a declared permission", () => {
      const manifest = makeManifest({ permissions: ["read_file"] })
      const result = sandbox.check(manifest, "fileReadTool")
      expect(result.allowed).toBe(true)
    })

    it("denies a tool not in declared permissions", () => {
      const manifest = makeManifest({ permissions: ["read_file"] })
      const result = sandbox.check(manifest, "browserTool")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("network")
    })

    it("denies system tool for user-level skill even if declared", () => {
      const manifest = makeManifest({ permissions: ["system"], trustLevel: "user" })
      const result = sandbox.check(manifest, "systemTool")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("system")
    })

    it("allows system tool for system-level skill", () => {
      const manifest = makeManifest({ permissions: ["system"], trustLevel: "system" })
      const result = sandbox.check(manifest, "systemTool")
      expect(result.allowed).toBe(true)
    })

    it("denies completely unknown tool", () => {
      const manifest = makeManifest({ permissions: ["read_file", "network", "system"] })
      const result = sandbox.check(manifest, "unknownTool123")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("not registered")
    })

    it("allows execute_code when declared", () => {
      const manifest = makeManifest({ permissions: ["execute_code"] })
      const result = sandbox.check(manifest, "codeRunnerTool")
      expect(result.allowed).toBe(true)
    })

    it("denies channel_send when not declared", () => {
      const manifest = makeManifest({ permissions: ["read_file"] })
      const result = sandbox.check(manifest, "channelSendTool")
      expect(result.allowed).toBe(false)
    })
  })

  describe("filterTools", () => {
    it("returns only tools allowed by permissions", () => {
      const manifest = makeManifest({ permissions: ["read_file"] })
      const allTools = {
        fileReadTool: () => {},
        fileListTool: () => {},
        browserTool: () => {},
        systemTool: () => {},
      }

      const filtered = sandbox.filterTools(manifest, allTools)
      expect(Object.keys(filtered)).toContain("fileReadTool")
      expect(Object.keys(filtered)).toContain("fileListTool")
      expect(Object.keys(filtered)).not.toContain("browserTool")
      expect(Object.keys(filtered)).not.toContain("systemTool")
    })

    it("returns empty object when no permissions", () => {
      const manifest = makeManifest({ permissions: [] })
      const filtered = sandbox.filterTools(manifest, { fileReadTool: () => {}, browserTool: () => {} })
      expect(Object.keys(filtered)).toHaveLength(0)
    })

    it("multiple permissions combine their tool sets", () => {
      const manifest = makeManifest({ permissions: ["read_file", "network"] })
      const allTools = {
        fileReadTool: () => {},
        browserTool: () => {},
        systemTool: () => {},
      }
      const filtered = sandbox.filterTools(manifest, allTools)
      expect(Object.keys(filtered)).toContain("fileReadTool")
      expect(Object.keys(filtered)).toContain("browserTool")
      expect(Object.keys(filtered)).not.toContain("systemTool")
    })
  })

  describe("validateManifest", () => {
    it("passes valid user manifest", () => {
      const manifest = makeManifest({ permissions: ["read_file", "network"] })
      const result = sandbox.validateManifest(manifest)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it("rejects external skill requesting system permission", () => {
      const manifest = makeManifest({ permissions: ["system"], trustLevel: "external" })
      const result = sandbox.validateManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.errors.join()).toContain("system")
    })

    it("rejects external skill with execute_code + network (data exfiltration risk)", () => {
      const manifest = makeManifest({ permissions: ["execute_code", "network"], trustLevel: "external" })
      const result = sandbox.validateManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.errors.join()).toContain("exfiltration")
    })

    it("warns on more than 3 permissions", () => {
      const manifest = makeManifest({ permissions: ["read_file", "write_file", "network", "execute_code"] })
      const result = sandbox.validateManifest(manifest)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it("rejects manifest without name", () => {
      const manifest = makeManifest({ name: "" })
      const result = sandbox.validateManifest(manifest)
      expect(result.valid).toBe(false)
    })

    it("allows external skill with network only (no execute_code)", () => {
      const manifest = makeManifest({ permissions: ["network"], trustLevel: "external" })
      const result = sandbox.validateManifest(manifest)
      expect(result.valid).toBe(true)
    })
  })

  describe("PERMISSION_TOOL_MAP", () => {
    it("all permission types are mapped", () => {
      const permissions = ["read_file", "write_file", "network", "execute_code", "memory_read", "memory_write", "channel_send", "system"]
      for (const perm of permissions) {
        expect(PERMISSION_TOOL_MAP).toHaveProperty(perm)
      }
    })
  })
})
