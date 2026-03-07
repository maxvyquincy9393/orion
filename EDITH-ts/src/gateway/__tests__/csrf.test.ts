import { describe, expect, it } from "vitest"

import { __gatewayTestUtils } from "../server.js"

const {
  parseCookieHeader,
  shouldEnforceCsrfRequest,
  verifyCsrfRequest,
  buildCsrfCookie,
  CSRF_HEADER_NAME,
} = __gatewayTestUtils

const allowedOrigin = "http://127.0.0.1:8080"

describe("gateway/csrf helpers", () => {
  it("parses cookie headers into key-value pairs", () => {
    const parsed = parseCookieHeader("a=1; b=hello%20world")
    expect(parsed.a).toBe("1")
    expect(parsed.b).toBe("hello world")
  })

  it("does not enforce csrf for safe methods", () => {
    expect(
      shouldEnforceCsrfRequest({
        method: "GET",
        url: "/message",
        headers: { origin: allowedOrigin },
      }),
    ).toBe(false)
  })

  it("enforces csrf for mutating browser-origin requests", () => {
    expect(
      shouldEnforceCsrfRequest({
        method: "POST",
        url: "/message",
        headers: { origin: allowedOrigin },
      }),
    ).toBe(true)
  })

  it("skips csrf enforcement for webhook routes", () => {
    expect(
      shouldEnforceCsrfRequest({
        method: "POST",
        url: "/webhooks/whatsapp",
        headers: { origin: allowedOrigin },
      }),
    ).toBe(false)
  })

  it("rejects when csrf header is missing", () => {
    const result = verifyCsrfRequest({
      method: "POST",
      url: "/message",
      headers: {
        origin: allowedOrigin,
      },
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("missing csrf header")
  })

  it("rejects when csrf token does not match cookie", () => {
    const result = verifyCsrfRequest({
      method: "POST",
      url: "/message",
      headers: {
        origin: allowedOrigin,
        cookie: "edith_csrf_token=cookie-token",
        [CSRF_HEADER_NAME]: "header-token",
      },
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("invalid csrf token")
  })

  it("accepts valid csrf header and cookie pair", () => {
    const token = "token-123"
    const result = verifyCsrfRequest({
      method: "POST",
      url: "/message",
      headers: {
        origin: allowedOrigin,
        cookie: buildCsrfCookie(token),
        [CSRF_HEADER_NAME]: token,
      },
    })

    expect(result.ok).toBe(true)
  })

  it("rejects disallowed origins", () => {
    const result = verifyCsrfRequest({
      method: "POST",
      url: "/message",
      headers: {
        origin: "https://evil.example",
        cookie: "edith_csrf_token=abc",
        [CSRF_HEADER_NAME]: "abc",
      },
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("origin not allowed")
  })
})
