import { describe, expect, it } from "vitest"

import { OutputScanner } from "../output-scanner.js"

describe("OutputScanner", () => {
  const scanner = new OutputScanner()

  // ───────────────────────────────────────────────────────────────────────────
  // Clean output
  // ───────────────────────────────────────────────────────────────────────────

  describe("clean output", () => {
    it("passes benign text through unchanged", () => {
      const result = scanner.scan("Hello, how can I help you today?")
      expect(result.safe).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(result.sanitized).toBe("Hello, how can I help you today?")
    })

    it("passes code snippets without secrets", () => {
      const code = "const x = 42;\nfunction hello() { return 'world'; }"
      const result = scanner.scan(code)
      expect(result.safe).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // API key detection
  // ───────────────────────────────────────────────────────────────────────────

  describe("API key detection", () => {
    it("redacts OpenAI-style API keys", () => {
      const text = "Your key is sk-abcdefghijklmnopqrstuvwxyz1234567890"
      const result = scanner.scan(text)
      expect(result.safe).toBe(false)
      expect(result.issues).toContain("API key in output")
      expect(result.sanitized).toContain("[API_KEY_REDACTED]")
      expect(result.sanitized).not.toContain("sk-")
    })

    it("redacts GitHub tokens", () => {
      const text = "Use token ghp_abcdefghijklmnopqrstuvwxyz1234567890"
      const result = scanner.scan(text)
      expect(result.safe).toBe(false)
      expect(result.issues).toContain("GitHub token in output")
      expect(result.sanitized).toContain("[GITHUB_TOKEN_REDACTED]")
    })

    it("redacts JWT tokens", () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
      const result = scanner.scan(`Token: ${jwt}`)
      expect(result.safe).toBe(false)
      expect(result.issues).toContain("JWT token in output")
      expect(result.sanitized).toContain("[JWT_REDACTED]")
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Password detection
  // ───────────────────────────────────────────────────────────────────────────

  describe("password detection", () => {
    it("redacts password assignments", () => {
      const text = 'password = "mysecretpassword123"'
      const result = scanner.scan(text)
      expect(result.safe).toBe(false)
      expect(result.issues).toContain("Password in output")
      expect(result.sanitized).toContain("[REDACTED]")
    })

    it("redacts password in config format", () => {
      const text = "password: SuperSecret123!"
      const result = scanner.scan(text)
      expect(result.safe).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Harmful content detection
  // ───────────────────────────────────────────────────────────────────────────

  describe("harmful content warnings", () => {
    it("flags step-by-step harmful instructions", () => {
      const text = "Step 1: hack into the system. Step 2: steal data."
      const result = scanner.scan(text)
      expect(result.safe).toBe(false)
      expect(result.issues).toContain("Potentially harmful instructions in output")
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Multiple issues
  // ───────────────────────────────────────────────────────────────────────────

  describe("multiple issues", () => {
    it("detects multiple secrets in one output", () => {
      const text = "API key: sk-abcdefghijklmnopqrstuvwxyz1234567890\nGitHub: ghp_abcdefghijklmnopqrstuvwxyz1234567890"
      const result = scanner.scan(text)
      expect(result.safe).toBe(false)
      expect(result.issues.length).toBeGreaterThanOrEqual(2)
      expect(result.sanitized).not.toMatch(/sk-[a-zA-Z0-9]{32,}/)
      expect(result.sanitized).not.toMatch(/ghp_[a-zA-Z0-9]{36}/)
    })
  })
})
