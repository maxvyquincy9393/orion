import { describe, expect, it, beforeEach } from "vitest"

import { eventBus } from "../event-bus.js"

/**
 * NOTE: eventBus is a singleton. We use .removeAllListeners() in beforeEach
 * to ensure test isolation. Tests validate dispatch/on/error-handling behavior.
 */

describe("EdithEventBus", () => {
  beforeEach(() => {
    eventBus.removeAllListeners()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // dispatch + on
  // ───────────────────────────────────────────────────────────────────────────

  describe("dispatch and on", () => {
    it("delivers dispatched events to listeners", async () => {
      const received: unknown[] = []

      eventBus.on("user.message.received", (data) => {
        received.push(data)
      })

      eventBus.dispatch("user.message.received", {
        userId: "u1",
        content: "hello",
        channel: "cli",
        timestamp: 1000,
      })

      // Sync delivery
      expect(received).toHaveLength(1)
      const event = received[0] as Record<string, unknown>
      expect(event.userId).toBe("u1")
      expect(event.content).toBe("hello")
      expect(event.type).toBe("user.message.received")
    })

    it("does not deliver events to unrelated listeners", () => {
      const received: unknown[] = []

      eventBus.on("channel.connected", (data) => {
        received.push(data)
      })

      eventBus.dispatch("user.message.received", {
        userId: "u1",
        content: "test",
        channel: "cli",
        timestamp: 1000,
      })

      expect(received).toHaveLength(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Multiple listeners
  // ───────────────────────────────────────────────────────────────────────────

  describe("multiple listeners", () => {
    it("delivers events to multiple listeners", () => {
      let count = 0

      eventBus.on("system.heartbeat", () => { count++ })
      eventBus.on("system.heartbeat", () => { count++ })

      eventBus.dispatch("system.heartbeat", { timestamp: Date.now() })

      expect(count).toBe(2)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Error handling in listeners
  // ───────────────────────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("catches synchronous errors in handlers without crashing", () => {
      eventBus.on("system.heartbeat", () => {
        throw new Error("sync error")
      })

      // Should not throw
      expect(() => {
        eventBus.dispatch("system.heartbeat", { timestamp: Date.now() })
      }).not.toThrow()
    })

    it("catches async errors in handlers without crashing", () => {
      eventBus.on("system.heartbeat", async () => {
        throw new Error("async error")
      })

      // Should not throw
      expect(() => {
        eventBus.dispatch("system.heartbeat", { timestamp: Date.now() })
      }).not.toThrow()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Type field injection
  // ───────────────────────────────────────────────────────────────────────────

  describe("dispatch injects type field", () => {
    it("automatically adds type field from eventType argument", () => {
      let receivedType: string | undefined

      eventBus.on("channel.connected", (data) => {
        receivedType = (data as Record<string, unknown>).type as string
      })

      eventBus.dispatch("channel.connected", { channelName: "whatsapp" })
      expect(receivedType).toBe("channel.connected")
    })
  })
})
