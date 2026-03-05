import { describe, expect, it } from "vitest"

import { __daemonTestUtils } from "../daemon.js"

describe("daemon trigger controls", () => {
  it("builds stable dedup keys per user and trigger", () => {
    const key = __daemonTestUtils.buildTriggerDedupKey("user-1", "daily-checkin")
    expect(key).toBe("user-1::daily-checkin")
  })

  it("computes target users from owner plus registered users", () => {
    const users = __daemonTestUtils.computeTargetUserIds("owner", [
      { userId: "alice" },
      { userId: "bob" },
      { userId: "alice" },
    ])

    expect(new Set(users)).toEqual(new Set(["owner", "alice", "bob"]))
  })

  it("enforces cooldown window for persisted trigger logs", () => {
    const now = Date.now()
    const cooldownMs = 30 * 60 * 1000

    expect(__daemonTestUtils.isTriggerWithinCooldown(now - 5 * 60 * 1000, now, cooldownMs)).toBe(true)
    expect(__daemonTestUtils.isTriggerWithinCooldown(now - 40 * 60 * 1000, now, cooldownMs)).toBe(false)
  })
})

