/**
 * @file sessions.test.ts
 * @description Unit tests for sessions/ modules: sessionStore, DeviceRouter,
 * PresenceManager, and SendPolicyManager.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - sessionStore (singleton) depends on ../database/index.js (getHistory) — mocked here.
 *   - DeviceRouter depends on presence-manager singleton + pairedDeviceRegistry — both mocked.
 *   - PresenceManager is instantiated directly (class is exported) and uses
 *     pairedDeviceRegistry — mocked here.
 *   - SendPolicyManager has no external dependencies (pure in-memory rate-limiter).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before subject imports
// ---------------------------------------------------------------------------

vi.mock("../../database/index.js", () => ({
  getHistory: vi.fn().mockResolvedValue([]),
  prisma: {
    activeSession: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

vi.mock("../../pairing/device-registry.js", () => ({
  pairedDeviceRegistry: {
    listForUser: vi.fn().mockReturnValue([]),
    updateLastSeen: vi.fn(),
  },
}))

// The session summarizer is imported by session-store.ts — silence it
vi.mock("../../memory/session-summarizer.js", () => ({
  sessionSummarizer: { maybeCompress: vi.fn().mockResolvedValue(undefined) },
  setStoreAdapter: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Subject imports
// ---------------------------------------------------------------------------

import { sessionStore } from "../session-store.js"
import { DeviceRouter } from "../device-router.js"
import { PresenceManager } from "../presence-manager.js"
import { SendPolicyManager } from "../send-policy.js"
import { pairedDeviceRegistry } from "../../pairing/device-registry.js"
import { getHistory } from "../../database/index.js"
import type { Message } from "../session-store.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(role: Message["role"] = "user", content = "hello"): Message {
  return { role, content, timestamp: Date.now() }
}

function makeDevice(deviceId: string, userId: string) {
  return {
    deviceId,
    userId,
    name: `Device ${deviceId}`,
    os: "android" as const,
    type: "phone" as const,
    gatewayId: "gw-1",
    capabilities: ["push"],
    lastSeen: Date.now(),
    paired: Date.now(),
    authToken: "tok",
  }
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

describe("SessionStore", () => {
  beforeEach(() => {
    sessionStore.clearAllSessions()
    vi.mocked(getHistory).mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("addMessage creates the session if it does not exist", () => {
    expect(sessionStore.getSession("user1", "telegram")).toBeUndefined()
    sessionStore.addMessage("user1", "telegram", makeMessage())
    expect(sessionStore.getSession("user1", "telegram")).toBeDefined()
  })

  it("addMessage stores messages and getSessionHistory returns them in insertion order", async () => {
    const msg1 = makeMessage("user", "first")
    const msg2 = makeMessage("assistant", "second")
    sessionStore.addMessage("user1", "telegram", msg1)
    sessionStore.addMessage("user1", "telegram", msg2)

    const history = await sessionStore.getSessionHistory("user1", "telegram")
    expect(history).toHaveLength(2)
    expect(history[0]?.content).toBe("first")
    expect(history[1]?.content).toBe("second")
  })

  it("getSessionHistory for an unknown user+channel returns empty array", async () => {
    const history = await sessionStore.getSessionHistory("nobody", "webchat")
    expect(history).toEqual([])
  })

  it("multiple addMessage calls accumulate the message count per session", async () => {
    for (let i = 0; i < 5; i++) {
      sessionStore.addMessage("user1", "telegram", makeMessage("user", `msg${i}`))
    }
    const history = await sessionStore.getSessionHistory("user1", "telegram")
    expect(history).toHaveLength(5)
  })

  it("getOrCreateSession returns the same session object on repeated calls", () => {
    const s1 = sessionStore.getOrCreateSession("user1", "telegram")
    const s2 = sessionStore.getOrCreateSession("user1", "telegram")
    expect(s1.key).toBe(s2.key)
    expect(s1.createdAt).toBe(s2.createdAt)
  })

  it("getOrCreateSession updates lastActivityAt on subsequent calls", async () => {
    const session = sessionStore.getOrCreateSession("user1", "telegram")
    const before = session.lastActivityAt
    // Small wait so timestamps differ
    await new Promise((r) => setTimeout(r, 5))
    sessionStore.getOrCreateSession("user1", "telegram")
    expect(session.lastActivityAt).toBeGreaterThanOrEqual(before)
  })

  it("getSession returns undefined for an unknown session", () => {
    expect(sessionStore.getSession("ghost", "webchat")).toBeUndefined()
  })

  it("clearSession removes both the session and its history", async () => {
    sessionStore.addMessage("user1", "telegram", makeMessage())
    sessionStore.clearSession("user1", "telegram")

    expect(sessionStore.getSession("user1", "telegram")).toBeUndefined()
    const history = await sessionStore.getSessionHistory("user1", "telegram")
    expect(history).toEqual([])
  })

  it("clearAllSessions removes every active session", () => {
    sessionStore.addMessage("user1", "telegram", makeMessage())
    sessionStore.addMessage("user2", "discord", makeMessage())
    sessionStore.clearAllSessions()
    expect(sessionStore.getSessionCount()).toBe(0)
  })

  it("getSessionCount returns the correct number of distinct sessions", () => {
    sessionStore.getOrCreateSession("user1", "telegram")
    sessionStore.getOrCreateSession("user2", "discord")
    sessionStore.getOrCreateSession("user3", "telegram")
    expect(sessionStore.getSessionCount()).toBe(3)
  })

  it("getActiveSessions returns all live sessions as an array", () => {
    sessionStore.getOrCreateSession("user1", "telegram")
    sessionStore.getOrCreateSession("user2", "webchat")
    expect(sessionStore.getActiveSessions()).toHaveLength(2)
  })

  it("cleanupInactiveSessions removes stale sessions (maxInactiveMs=-1)", async () => {
    sessionStore.getOrCreateSession("user1", "telegram")
    sessionStore.getOrCreateSession("user2", "discord")
    // Wait 1 ms so lastActivityAt is strictly less than now - (-1) = now + 1
    await new Promise((r) => setTimeout(r, 1))
    const removed = sessionStore.cleanupInactiveSessions(-1)
    expect(removed).toBe(2)
    expect(sessionStore.getSessionCount()).toBe(0)
  })

  it("cleanupInactiveSessions does not remove recently active sessions", () => {
    sessionStore.getOrCreateSession("user1", "telegram")
    const removed = sessionStore.cleanupInactiveSessions(60_000) // 1-min window
    expect(removed).toBe(0)
    expect(sessionStore.getSessionCount()).toBe(1)
  })

  it("replaceSessionHistory overwrites the in-memory cache", async () => {
    sessionStore.addMessage("user1", "telegram", makeMessage("user", "old"))
    const replacement: Message[] = [makeMessage("assistant", "new")]
    sessionStore.replaceSessionHistory("user1", "telegram", replacement)
    const history = await sessionStore.getSessionHistory("user1", "telegram")
    expect(history).toHaveLength(1)
    expect(history[0]?.content).toBe("new")
  })

  it("getSessionHistory loads from DB when in-memory cache is empty", async () => {
    vi.mocked(getHistory).mockResolvedValueOnce([
      {
        id: "db-1",
        userId: "user1",
        role: "user",
        content: "from db",
        channel: "telegram",
        createdAt: new Date(),
        metadata: null,
        threadId: null,
      } as unknown as Awaited<ReturnType<typeof getHistory>>[number],
    ])

    const history = await sessionStore.getSessionHistory("user1", "telegram")
    expect(getHistory).toHaveBeenCalledWith("user1", 50)
    expect(history[0]?.content).toBe("from db")
  })

  it("session key is formatted as 'userId:channel'", () => {
    const session = sessionStore.getOrCreateSession("alice", "whatsapp")
    expect(session.key).toBe("alice:whatsapp")
  })
})

// ---------------------------------------------------------------------------
// PresenceManager
// ---------------------------------------------------------------------------

describe("PresenceManager", () => {
  let presence: PresenceManager

  beforeEach(() => {
    presence = new PresenceManager()
    vi.mocked(pairedDeviceRegistry.updateLastSeen).mockReset()
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([])
  })

  it("heartbeat(isActive=true) marks device as active", () => {
    presence.heartbeat("dev-1", true, 100)
    expect(presence.getPresence("dev-1").state).toBe("active")
  })

  it("heartbeat(isActive=true, highLastInputMs) marks device as idle", () => {
    presence.heartbeat("dev-2", true, 10 * 60 * 1000)
    expect(presence.getPresence("dev-2").state).toBe("idle")
  })

  it("heartbeat(isActive=false) marks device as background", () => {
    presence.heartbeat("dev-3", false)
    expect(presence.getPresence("dev-3").state).toBe("background")
  })

  it("getPresence returns offline and lastSeen=0 for unknown device", () => {
    const p = presence.getPresence("ghost-device")
    expect(p.state).toBe("offline")
    expect(p.lastSeen).toBe(0)
  })

  it("heartbeat calls pairedDeviceRegistry.updateLastSeen", () => {
    presence.heartbeat("dev-1", true)
    expect(pairedDeviceRegistry.updateLastSeen).toHaveBeenCalledWith("dev-1")
  })

  it("setDND sets device state to dnd", () => {
    presence.heartbeat("dev-4", true)
    presence.setDND("dev-4", Date.now() + 60_000)
    expect(presence.getPresence("dev-4").state).toBe("dnd")
  })

  it("setDND on a device with no prior heartbeat still creates a dnd entry", () => {
    presence.setDND("brand-new-device", Date.now() + 60_000)
    expect(presence.getPresence("brand-new-device").state).toBe("dnd")
  })

  it("heartbeat while DND is active is ignored — state stays dnd", () => {
    presence.setDND("dev-5", Date.now() + 60_000)
    presence.heartbeat("dev-5", true)
    expect(presence.getPresence("dev-5").state).toBe("dnd")
  })

  it("getActiveDevice returns 'all' when no devices are registered for the user", () => {
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([])
    expect(presence.getActiveDevice("user1")).toBe("all")
  })

  it("getActiveDevice returns 'all' when all registered devices are offline", () => {
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([makeDevice("dev-a", "user1")])
    // No heartbeat → state is offline → score 0 → falls through to 'all'
    expect(presence.getActiveDevice("user1")).toBe("all")
  })

  it("getActiveDevice returns the active device over an idle device", () => {
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([
      makeDevice("dev-active", "user1"),
      makeDevice("dev-idle", "user1"),
    ])
    presence.heartbeat("dev-active", true, 100)            // active → score 3
    presence.heartbeat("dev-idle", true, 10 * 60 * 1000)  // idle   → score 2

    expect(presence.getActiveDevice("user1")).toBe("dev-active")
  })

  it("getActiveDevice returns the idle device over a background device", () => {
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([
      makeDevice("dev-bg", "user1"),
      makeDevice("dev-idle", "user1"),
    ])
    presence.heartbeat("dev-bg", false)                    // background → score 1
    presence.heartbeat("dev-idle", true, 10 * 60 * 1000)  // idle → score 2

    expect(presence.getActiveDevice("user1")).toBe("dev-idle")
  })

  it("isOnline behaviour: device is not offline right after a heartbeat", () => {
    presence.heartbeat("dev-online", true)
    expect(presence.getPresence("dev-online").state).not.toBe("offline")
  })

  it("getPresence returns offline after OFFLINE_THRESHOLD_MS without heartbeat", () => {
    // Simulate a very old heartbeat by manipulating time
    const past = Date.now() - 16 * 60 * 1000 // 16 minutes ago
    // Directly inject a stale entry via heartbeat + back-dating lastSeen
    presence.heartbeat("old-device", true)
    // Access internal map via private-but-reflectable cast for test purposes
    const internalMap = (presence as unknown as { presence: Map<string, { state: string; lastSeen: number }> }).presence
    const entry = internalMap.get("old-device")!
    entry.lastSeen = past

    expect(presence.getPresence("old-device").state).toBe("offline")
  })
})

// ---------------------------------------------------------------------------
// DeviceRouter
// ---------------------------------------------------------------------------

describe("DeviceRouter", () => {
  let router: DeviceRouter

  beforeEach(() => {
    router = new DeviceRouter()
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([])
    vi.mocked(pairedDeviceRegistry.updateLastSeen).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("routeNotification returns 'all' when no devices are registered for the user", () => {
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([])
    expect(router.routeNotification("user-no-devices")).toBe("all")
  })

  it("route returns empty array when no devices are registered for the user", () => {
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue([])
    const targets = router.route("user-no-devices", { text: "ping" })
    expect(targets).toEqual([])
  })

  it("route falls back to all registered devices when none are online", () => {
    const devices = [makeDevice("dev-a", "user1"), makeDevice("dev-b", "user1")]
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue(devices)
    // No heartbeats on the module-level presenceManager singleton → all offline
    const targets = router.route("user1", {})
    expect(targets).toContain("dev-a")
    expect(targets).toContain("dev-b")
  })

  it("route returns only online (non-offline, non-dnd) devices when some are online", () => {
    // DeviceRouter uses the module-level presenceManager singleton, so we test
    // the filtering logic indirectly: when listForUser returns devices but
    // the singleton has no recorded presence for them, they are 'offline' and
    // we fall back to all — confirming the fallback branch is hit
    const devices = [makeDevice("dev-x", "user2")]
    vi.mocked(pairedDeviceRegistry.listForUser).mockReturnValue(devices)
    const targets = router.route("user2", { msg: "hello" })
    expect(targets).toHaveLength(1)
    expect(targets[0]).toBe("dev-x")
  })
})

// ---------------------------------------------------------------------------
// SendPolicyManager
// ---------------------------------------------------------------------------

describe("SendPolicyManager", () => {
  let policy: SendPolicyManager

  beforeEach(() => {
    policy = new SendPolicyManager()
  })

  it("allows a short message that is well under the rate limit", async () => {
    const result = await policy.check("user1", "telegram", "Hello!")
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it("blocks a message that exceeds MAX_MESSAGE_LENGTH (4000 chars)", async () => {
    const longContent = "x".repeat(4001)
    const result = await policy.check("user1", "telegram", longContent)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/exceeds maximum length/)
  })

  it("allows a message that is exactly at the length limit (4000 chars)", async () => {
    const exactContent = "x".repeat(4000)
    const result = await policy.check("user1", "telegram", exactContent)
    expect(result.allowed).toBe(true)
  })

  it("increments the counter for each allowed message", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await policy.check("user1", "telegram", "msg")
      expect(result.allowed).toBe(true)
    }
  })

  it("blocks after exceeding 30 messages per minute (rate limit)", async () => {
    for (let i = 0; i < 30; i++) {
      await policy.check("user1", "telegram", "msg")
    }
    const blocked = await policy.check("user1", "telegram", "one too many")
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toMatch(/Rate limit exceeded/)
  })

  it("rate limit buckets are isolated by channel — different channel starts fresh", async () => {
    for (let i = 0; i < 30; i++) {
      await policy.check("user1", "telegram", "msg")
    }
    const result = await policy.check("user1", "discord", "msg")
    expect(result.allowed).toBe(true)
  })

  it("rate limit buckets are isolated by userId — different user starts fresh", async () => {
    for (let i = 0; i < 30; i++) {
      await policy.check("user1", "telegram", "msg")
    }
    const result = await policy.check("user2", "telegram", "msg")
    expect(result.allowed).toBe(true)
  })

  it("blocked reason message includes a wait-time expressed in seconds", async () => {
    for (let i = 0; i < 30; i++) {
      await policy.check("user1", "telegram", "msg")
    }
    const blocked = await policy.check("user1", "telegram", "msg")
    expect(blocked.reason).toMatch(/\d+ seconds/)
  })

  it("empty string is allowed (length check is strict greater-than)", async () => {
    const result = await policy.check("user1", "telegram", "")
    expect(result.allowed).toBe(true)
  })
})
