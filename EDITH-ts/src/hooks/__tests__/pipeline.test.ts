import { describe, expect, it, beforeEach } from "vitest"

import { HookPipeline } from "../pipeline.js"
import { HookRegistry, type HookContext } from "../registry.js"

describe("HookPipeline", () => {
  let registry: HookRegistry
  let pipeline: HookPipeline

  beforeEach(() => {
    registry = new HookRegistry()
    pipeline = new HookPipeline(registry)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Basic execution
  // ───────────────────────────────────────────────────────────────────────────

  it("passes context through when no hooks are registered", async () => {
    const context: HookContext = {
      userId: "u1",
      channel: "cli",
      content: "hello",
      metadata: {},
    }

    const result = await pipeline.run("pre_message", context)
    expect(result.content).toBe("hello")
    expect(result.userId).toBe("u1")
  })

  it("runs hooks in priority order and applies transformations", async () => {
    const executionOrder: string[] = []

    registry.register({
      name: "add-exclamation",
      type: "pre_message",
      priority: 10,
      handler: async (ctx) => {
        executionOrder.push("add-exclamation")
        return { ...ctx, content: ctx.content + "!" }
      },
    })

    registry.register({
      name: "uppercase",
      type: "pre_message",
      priority: 20, // Higher priority runs first
      handler: async (ctx) => {
        executionOrder.push("uppercase")
        return { ...ctx, content: ctx.content.toUpperCase() }
      },
    })

    const context: HookContext = {
      userId: "u1",
      channel: "cli",
      content: "hello",
      metadata: {},
    }

    const result = await pipeline.run("pre_message", context)

    // uppercase (priority 20) runs first, then add-exclamation (priority 10)
    expect(executionOrder).toEqual(["uppercase", "add-exclamation"])
    expect(result.content).toBe("HELLO!")
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Abort behavior
  // ───────────────────────────────────────────────────────────────────────────

  it("stops executing hooks when abort flag is set", async () => {
    const executionOrder: string[] = []

    registry.register({
      name: "blocker",
      type: "pre_message",
      priority: 100,
      handler: async (ctx) => {
        executionOrder.push("blocker")
        return { ...ctx, abort: true, abortReason: "blocked by policy" }
      },
    })

    registry.register({
      name: "should-not-run",
      type: "pre_message",
      priority: 1,
      handler: async (ctx) => {
        executionOrder.push("should-not-run")
        return ctx
      },
    })

    const context: HookContext = {
      userId: "u1",
      channel: "cli",
      content: "test",
      metadata: {},
    }

    const result = await pipeline.run("pre_message", context)

    expect(executionOrder).toEqual(["blocker"])
    expect(result.abort).toBe(true)
    expect(result.abortReason).toBe("blocked by policy")
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Error handling
  // ───────────────────────────────────────────────────────────────────────────

  it("continues processing if a hook throws an error", async () => {
    const executionOrder: string[] = []

    registry.register({
      name: "failing-hook",
      type: "pre_message",
      priority: 100,
      handler: async () => {
        executionOrder.push("failing-hook")
        throw new Error("hook crashed")
      },
    })

    registry.register({
      name: "recovery-hook",
      type: "pre_message",
      priority: 1,
      handler: async (ctx) => {
        executionOrder.push("recovery-hook")
        return { ...ctx, content: ctx.content + "-recovered" }
      },
    })

    const context: HookContext = {
      userId: "u1",
      channel: "cli",
      content: "test",
      metadata: {},
    }

    const result = await pipeline.run("pre_message", context)

    expect(executionOrder).toEqual(["failing-hook", "recovery-hook"])
    expect(result.content).toBe("test-recovered")
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Context immutability
  // ───────────────────────────────────────────────────────────────────────────

  it("does not mutate the original context object", async () => {
    registry.register({
      name: "mutator",
      type: "pre_message",
      priority: 1,
      handler: async (ctx) => {
        return { ...ctx, content: "modified", metadata: { ...ctx.metadata, added: true } }
      },
    })

    const original: HookContext = {
      userId: "u1",
      channel: "cli",
      content: "original",
      metadata: { key: "value" },
    }

    const result = await pipeline.run("pre_message", original)

    expect(original.content).toBe("original")
    expect(original.metadata).toEqual({ key: "value" })
    expect(result.content).toBe("modified")
    expect(result.metadata).toEqual({ key: "value", added: true })
  })
})
