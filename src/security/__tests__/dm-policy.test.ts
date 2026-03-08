/**
 * @file dm-policy.test.ts
 * @description Unit tests for DmPolicy access control.
 */
import { describe, it, expect } from "vitest"
import { DmPolicy } from "../dm-policy.js"

describe("DmPolicy — open mode", () => {
  const policy = new DmPolicy({ mode: "open", adminUserId: "", allowedIds: [], blockedIds: [] })
  it("allows any user", () => expect(policy.isAllowed("anyone")).toBe(true))
  it("allows empty string userId", () => expect(policy.isAllowed("")).toBe(true))
})

describe("DmPolicy — allowlist mode", () => {
  const policy = new DmPolicy({ mode: "allowlist", adminUserId: "", allowedIds: ["alice", "bob"], blockedIds: [] })
  it("allows listed user alice", () => expect(policy.isAllowed("alice")).toBe(true))
  it("allows listed user bob", () => expect(policy.isAllowed("bob")).toBe(true))
  it("blocks unlisted user", () => expect(policy.isAllowed("charlie")).toBe(false))
})

describe("DmPolicy — blocklist mode", () => {
  const policy = new DmPolicy({ mode: "blocklist", adminUserId: "", allowedIds: [], blockedIds: ["spammer"] })
  it("blocks listed user", () => expect(policy.isAllowed("spammer")).toBe(false))
  it("allows unlisted user", () => expect(policy.isAllowed("alice")).toBe(true))
})

describe("DmPolicy — admin-only mode", () => {
  const policy = new DmPolicy({ mode: "admin-only", adminUserId: "admin123", allowedIds: [], blockedIds: [] })
  it("allows admin", () => expect(policy.isAllowed("admin123")).toBe(true))
  it("blocks non-admin", () => expect(policy.isAllowed("user456")).toBe(false))
  it("blocks empty userId", () => expect(policy.isAllowed("")).toBe(false))
})
