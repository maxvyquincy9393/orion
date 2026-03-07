import { describe, expect, it } from "vitest"

import { __gatewayTestUtils } from "../server.js"

const { extractAdminToken } = __gatewayTestUtils
const { extractWebSocketToken } = __gatewayTestUtils

describe("gateway/auth – extractAdminToken", () => {
  it("returns token from Authorization Bearer header", () => {
    const req = {
      headers: { authorization: "Bearer my-secret-token" },
      query: {},
    }
    expect(extractAdminToken(req)).toBe("my-secret-token")
  })

  it("is case-insensitive for Bearer prefix", () => {
    const req = {
      headers: { authorization: "bearer My-Token" },
      query: {},
    }
    expect(extractAdminToken(req)).toBe("My-Token")
  })

  it("falls back to query string adminToken", () => {
    const req = {
      headers: {} as Record<string, string | undefined>,
      query: { adminToken: "legacy-token" },
    }
    expect(extractAdminToken(req)).toBe("legacy-token")
  })

  it("prefers Authorization header over query string", () => {
    const req = {
      headers: { authorization: "Bearer header-token" },
      query: { adminToken: "query-token" },
    }
    expect(extractAdminToken(req)).toBe("header-token")
  })

  it("returns null when no token is provided", () => {
    const req = {
      headers: {} as Record<string, string | undefined>,
      query: {},
    }
    expect(extractAdminToken(req)).toBeNull()
  })

  it("returns null for empty Bearer header", () => {
    const req = {
      headers: { authorization: "Bearer   " },
      query: {},
    }
    expect(extractAdminToken(req)).toBeNull()
  })

  it("returns null for empty query string token", () => {
    const req = {
      headers: {} as Record<string, string | undefined>,
      query: { adminToken: "   " },
    }
    expect(extractAdminToken(req)).toBeNull()
  })

  it("returns null for non-Bearer auth scheme", () => {
    const req = {
      headers: { authorization: "Basic abc123" },
      query: {},
    }
    expect(extractAdminToken(req)).toBeNull()
  })
})

describe("gateway/auth – extractWebSocketToken", () => {
  it("prefers Authorization header token over query token", () => {
    const req = {
      headers: { authorization: "Bearer header-token" },
      query: { token: "query-token" },
    }
    expect(extractWebSocketToken(req)).toBe("header-token")
  })

  it("falls back to query token when header is missing", () => {
    const req = {
      headers: {} as Record<string, string | undefined>,
      query: { token: "query-token" },
    }
    expect(extractWebSocketToken(req)).toBe("query-token")
  })

  it("returns null when no token is provided", () => {
    const req = {
      headers: {} as Record<string, string | undefined>,
      query: {},
    }
    expect(extractWebSocketToken(req)).toBeNull()
  })
})
