import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { CamelGuard, inferToolResultTaintSources, type TaintSource } from "../camel-guard"

const TEST_SECRET = "a]1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" // 34 chars > 32 min

describe("CamelGuard", () => {
  let originalSecret: string | undefined

  beforeEach(() => {
    originalSecret = process.env.EDITH_CAPABILITY_SECRET
    process.env.EDITH_CAPABILITY_SECRET = TEST_SECRET
  })

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.EDITH_CAPABILITY_SECRET = originalSecret
    } else {
      delete process.env.EDITH_CAPABILITY_SECRET
    }
  })

  describe("issueCapabilityToken", () => {
    it("should return a base64url token with signature", () => {
      const guard = new CamelGuard()
      const token = guard.issueCapabilityToken({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      expect(token).toBeDefined()
      expect(typeof token).toBe("string")
      // Token format: base64url_payload.base64url_signature
      const parts = token.split(".")
      expect(parts).toHaveLength(2)
      expect(parts[0]!.length).toBeGreaterThan(0)
      expect(parts[1]!.length).toBeGreaterThan(0)
    })
  })

  describe("readCapabilityToken", () => {
    it("should read back a valid token", () => {
      const guard = new CamelGuard()
      const token = guard.issueCapabilityToken({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      const payload = guard.readCapabilityToken(token)

      expect(payload).not.toBeNull()
      expect(payload!.actorId).toBe("user-a")
      expect(payload!.toolName).toBe("fileAgent")
      expect(payload!.action).toBe("write")
      expect(payload!.taintedSources).toEqual(["web_content"])
      expect(payload!.version).toBe(1)
      expect(payload!.issuedAt).toBeLessThanOrEqual(Date.now())
      expect(payload!.expiresAt).toBeGreaterThan(Date.now())
    })

    it("should return null for an invalid signature", () => {
      const guard = new CamelGuard()
      const token = guard.issueCapabilityToken({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      // Tamper with the signature
      const [payload] = token.split(".")
      const tamperedToken = `${payload}.INVALID_SIGNATURE_HERE`

      const result = guard.readCapabilityToken(tamperedToken)
      expect(result).toBeNull()
    })

    it("should return null for malformed token", () => {
      const guard = new CamelGuard()
      expect(guard.readCapabilityToken("not-a-valid-token")).toBeNull()
      expect(guard.readCapabilityToken("")).toBeNull()
    })
  })

  describe("validateCapabilityToken", () => {
    it("should return allowed for a valid token matching all fields", () => {
      const guard = new CamelGuard()
      const input = {
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"] as TaintSource[],
      }

      const token = guard.issueCapabilityToken(input)
      const result = guard.validateCapabilityToken(token, input)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it("should reject token with actor mismatch", () => {
      const guard = new CamelGuard()
      const token = guard.issueCapabilityToken({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      const result = guard.validateCapabilityToken(token, {
        actorId: "user-b", // different actor
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("actor mismatch")
    })

    it("should reject expired token", () => {
      const guard = new CamelGuard()
      const token = guard.issueCapabilityToken({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      // Read the real expiry, then mock Date.now past it
      const payload = guard.readCapabilityToken(token)
      expect(payload).not.toBeNull()

      const originalNow = Date.now
      try {
        Date.now = () => payload!.expiresAt + 1000

        const result = guard.validateCapabilityToken(token, {
          actorId: "user-a",
          toolName: "fileAgent",
          action: "write",
          taintedSources: ["web_content"],
        })

        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("expired")
      } finally {
        Date.now = originalNow
      }
    })

    it("should reject token with scope mismatch (different tool)", () => {
      const guard = new CamelGuard()
      const token = guard.issueCapabilityToken({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      const result = guard.validateCapabilityToken(token, {
        actorId: "user-a",
        toolName: "codeRunner", // different tool
        action: "write",
        taintedSources: ["web_content"],
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("scope mismatch")
    })

    it("should reject token with taint scope mismatch", () => {
      const guard = new CamelGuard()
      const token = guard.issueCapabilityToken({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      const result = guard.validateCapabilityToken(token, {
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content", "code_output"], // extra taint source
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("taint scope mismatch")
    })
  })

  describe("check", () => {
    it("should allow when no taint sources", () => {
      const guard = new CamelGuard()
      const result = guard.check({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: [],
      })

      expect(result.allowed).toBe(true)
    })

    it("should allow read-only tool actions without token", () => {
      const guard = new CamelGuard()

      // Browser is always read-only
      const browserResult = guard.check({
        actorId: "user-a",
        toolName: "browser",
        action: "navigate",
        taintedSources: ["web_content"],
      })
      expect(browserResult.allowed).toBe(true)

      // fileAgent read is read-only
      const fileReadResult = guard.check({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "read",
        taintedSources: ["file_content"],
      })
      expect(fileReadResult.allowed).toBe(true)
    })

    it("should block tainted write actions without capability token", () => {
      const guard = new CamelGuard()
      const result = guard.check({
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"],
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("without capability token")
    })

    it("should allow tainted write actions with valid capability token", () => {
      const guard = new CamelGuard()
      const input = {
        actorId: "user-a",
        toolName: "fileAgent",
        action: "write",
        taintedSources: ["web_content"] as TaintSource[],
      }

      const token = guard.issueCapabilityToken(input)
      const result = guard.check({ ...input, capabilityToken: token })

      expect(result.allowed).toBe(true)
    })
  })

  describe("inferToolResultTaintSources", () => {
    it("should return web_content for browser", () => {
      expect(inferToolResultTaintSources("browser", "navigate")).toEqual(["web_content"])
    })

    it("should return file_content for fileAgent read actions", () => {
      expect(inferToolResultTaintSources("fileAgent", "read")).toEqual(["file_content"])
      expect(inferToolResultTaintSources("fileAgent", "info")).toEqual(["file_content"])
      expect(inferToolResultTaintSources("fileAgent", "list")).toEqual(["file_content"])
    })

    it("should return code_output for codeRunner", () => {
      expect(inferToolResultTaintSources("codeRunner", "run")).toEqual(["code_output"])
    })

    it("should return empty array for unknown tools", () => {
      expect(inferToolResultTaintSources("unknown", "action")).toEqual([])
    })
  })
})
