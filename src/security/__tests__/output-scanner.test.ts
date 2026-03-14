import { describe, it, expect } from "vitest"

import { OutputScanner } from "../output-scanner"

describe("OutputScanner", () => {
  const scanner = new OutputScanner()

  describe("API key detection", () => {
    it("should redact OpenAI API keys (sk-...)", () => {
      const result = scanner.scan("Your key is sk-abc123def456ghi789jkl012mno345")
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[OPENAI_KEY_REDACTED]")
      expect(result.sanitized).not.toContain("sk-abc123")
      expect(result.issues).toContain("OpenAI / generic API key in output")
    })

    it("should redact GitHub personal access tokens (ghp_...)", () => {
      const token = "ghp_" + "a".repeat(40)
      const result = scanner.scan(`Use this token: ${token}`)
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[GITHUB_TOKEN_REDACTED]")
      expect(result.issues).toContain("GitHub personal access token in output")
    })

    it("should redact AWS access key IDs", () => {
      const result = scanner.scan("AWS key: AKIAIOSFODNN7EXAMPLE")
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[AWS_ACCESS_KEY_REDACTED]")
    })

    it("should redact Stripe live keys", () => {
      const result = scanner.scan("sk_live_" + "a".repeat(30))
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[STRIPE_LIVE_KEY_REDACTED]")
    })

    it("should redact Stripe test keys", () => {
      const result = scanner.scan("sk_test_" + "b".repeat(30))
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[STRIPE_TEST_KEY_REDACTED]")
    })

    it("should redact Slack bot tokens", () => {
      const token = "xoxb-" + "1234567890-" + "a".repeat(30)
      const result = scanner.scan(token)
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[SLACK_BOT_TOKEN_REDACTED]")
    })
  })

  describe("credential detection", () => {
    it("should redact PostgreSQL connection URLs", () => {
      const result = scanner.scan("postgres://admin:secret123@db.example.com:5432/mydb")
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[POSTGRES_URL_REDACTED]")
    })

    it("should redact MongoDB connection URLs", () => {
      const result = scanner.scan("mongodb://user:pass@cluster.mongodb.net/db")
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[MONGODB_URL_REDACTED]")
    })

    it("should redact password key-value pairs", () => {
      const result = scanner.scan('password=mysecretpass123')
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[REDACTED]")
    })

    it("should redact SSH private keys", () => {
      const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAH...long-key-data\n-----END RSA PRIVATE KEY-----"
      const result = scanner.scan(key)
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[SSH_PRIVATE_KEY_REDACTED]")
    })

    it("should redact JWT tokens", () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      const result = scanner.scan(`Token: ${jwt}`)
      expect(result.safe).toBe(false)
      expect(result.sanitized).toContain("[JWT_REDACTED]")
    })
  })

  describe("clean text handling", () => {
    it("should return safe for normal text", () => {
      const result = scanner.scan("Hello! How can I help you today?")
      expect(result.safe).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(result.sanitized).toBe("Hello! How can I help you today?")
    })

    it("should handle empty input", () => {
      const result = scanner.scan("")
      expect(result.safe).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(result.sanitized).toBe("")
    })

    it("should handle very long safe input", () => {
      const longText = "This is a safe sentence. ".repeat(500)
      const result = scanner.scan(longText)
      expect(result.safe).toBe(true)
      expect(result.sanitized).toBe(longText)
    })

    it("should not flag short strings that look like prefixes", () => {
      // "sk-" alone is too short (< 20 chars) to trigger the OpenAI key pattern
      const result = scanner.scan("Use the sk-short key")
      expect(result.safe).toBe(true)
    })
  })

  describe("warning patterns", () => {
    it("should flag harmful instruction patterns", () => {
      const result = scanner.scan("Step 1: First you need to steal the credentials")
      expect(result.safe).toBe(false)
      expect(result.issues).toContain("Potentially harmful instructions in output")
      // Warning patterns don't redact — content is preserved
      expect(result.sanitized).toContain("steal")
    })
  })
})
