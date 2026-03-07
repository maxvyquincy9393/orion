import { describe, expect, it, beforeEach } from "vitest"

import { HookRegistry, type Hook, type HookContext } from "../registry.js"

describe("HookRegistry", () => {
  let registry: HookRegistry

  beforeEach(() => {
    registry = new HookRegistry()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Registration
  // ───────────────────────────────────────────────────────────────────────────

  describe("register / unregister", () => {
    it("registers and retrieves hooks by type", () => {
      const hook: Hook = {
        name: "test-hook",
        type: "pre_message",
        priority: 10,
        handler: async (ctx) => ctx,
      }

      registry.register(hook)
      const hooks = registry.getHooks("pre_message")
      expect(hooks).toHaveLength(1)
      expect(hooks[0].name).toBe("test-hook")
    })

    it("unregisters hooks by name", () => {
      registry.register({
        name: "removable",
        type: "post_message",
        priority: 5,
        handler: async (ctx) => ctx,
      })

      expect(registry.getHooks("post_message")).toHaveLength(1)

      registry.unregister("removable")
      expect(registry.getHooks("post_message")).toHaveLength(0)
    })

    it("overwrites hooks with the same name", () => {
      registry.register({
        name: "hook-a",
        type: "pre_message",
        priority: 1,
        handler: async (ctx) => ctx,
      })

      registry.register({
        name: "hook-a",
        type: "pre_message",
        priority: 99,
        handler: async (ctx) => ctx,
      })

      const hooks = registry.getHooks("pre_message")
      expect(hooks).toHaveLength(1)
      expect(hooks[0].priority).toBe(99)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Filtering and priority
  // ───────────────────────────────────────────────────────────────────────────

  describe("getHooks filtering and sorting", () => {
    it("only returns hooks matching the requested type", () => {
      registry.register({
        name: "pre",
        type: "pre_message",
        priority: 1,
        handler: async (ctx) => ctx,
      })
      registry.register({
        name: "post",
        type: "post_message",
        priority: 1,
        handler: async (ctx) => ctx,
      })
      registry.register({
        name: "tool",
        type: "pre_tool",
        priority: 1,
        handler: async (ctx) => ctx,
      })

      expect(registry.getHooks("pre_message")).toHaveLength(1)
      expect(registry.getHooks("post_message")).toHaveLength(1)
      expect(registry.getHooks("pre_tool")).toHaveLength(1)
      expect(registry.getHooks("post_tool")).toHaveLength(0)
    })

    it("sorts hooks by priority descending (highest first)", () => {
      registry.register({
        name: "low",
        type: "pre_message",
        priority: 1,
        handler: async (ctx) => ctx,
      })
      registry.register({
        name: "high",
        type: "pre_message",
        priority: 100,
        handler: async (ctx) => ctx,
      })
      registry.register({
        name: "mid",
        type: "pre_message",
        priority: 50,
        handler: async (ctx) => ctx,
      })

      const hooks = registry.getHooks("pre_message")
      expect(hooks.map((h) => h.name)).toEqual(["high", "mid", "low"])
    })

    it("returns empty array for unknown hook types", () => {
      expect(registry.getHooks("pre_send")).toHaveLength(0)
      expect(registry.getHooks("post_send")).toHaveLength(0)
    })
  })
})
