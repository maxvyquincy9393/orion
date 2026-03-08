/**
 * @file outbox.test.ts
 * @description Unit tests for the channel message outbox.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Isolate outbox for each test by importing fresh
vi.mock("../../observability/metrics.js", () => ({
  edithMetrics: {
    errorsTotal: { inc: vi.fn() },
    channelSendsTotal: { inc: vi.fn() },
  },
}))

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
}))

import { MessageOutbox } from "../outbox.js"

describe("MessageOutbox", () => {
  let outbox: MessageOutbox

  beforeEach(() => {
    outbox = new MessageOutbox()
  })

  afterEach(() => {
    outbox.stopFlushing()
  })

  it("enqueue returns a non-empty string ID", () => {
    const id = outbox.enqueue("user1", "telegram", "hello")
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
  })

  it("getStatus reflects pending count", () => {
    outbox.enqueue("u1", "telegram", "msg1")
    outbox.enqueue("u1", "discord", "msg2")
    expect(outbox.getStatus().pending).toBe(2)
  })

  it("flush delivers due messages and removes them on success", async () => {
    outbox.enqueue("u1", "chan", "test message")
    const sendFn = vi.fn().mockResolvedValue(true)
    await outbox.flush(sendFn)
    expect(sendFn).toHaveBeenCalledOnce()
    expect(outbox.getStatus().pending).toBe(0)
  })

  it("flush retries on failure and keeps entry with increased attempts", async () => {
    outbox.enqueue("u1", "chan", "fail msg")
    const sendFn = vi.fn().mockResolvedValue(false)
    await outbox.flush(sendFn)
    // Entry still pending (not at max attempts yet)
    expect(outbox.getStatus().pending).toBe(1)
  })

  it("dead-letters entry after MAX_ATTEMPTS", async () => {
    outbox.enqueue("u1", "chan", "will fail")
    const sendFn = vi.fn().mockResolvedValue(false)

    // Exhaust all attempts
    for (let i = 0; i < 4; i++) {
      // Force nextRetryAt to past
      const entry = [...(outbox as unknown as { queue: Map<string, { nextRetryAt: number }> }).queue.values()][0]
      if (entry) entry.nextRetryAt = 0
      await outbox.flush(sendFn)
    }

    expect(outbox.getStatus().pending).toBe(0)
    expect(outbox.getStatus().deadLetters).toBeGreaterThanOrEqual(1)
    expect(outbox.getDeadLetters(1)[0]?.reason).toBe("max attempts exceeded")
  })

  it("startFlushing / stopFlushing lifecycle", () => {
    const sendFn = vi.fn().mockResolvedValue(true)
    expect(() => {
      outbox.startFlushing(sendFn)
      outbox.stopFlushing()
    }).not.toThrow()
  })

  it("does not start duplicate timers", () => {
    const sendFn = vi.fn().mockResolvedValue(true)
    outbox.startFlushing(sendFn)
    outbox.startFlushing(sendFn) // second call should be no-op
    outbox.stopFlushing()
  })

  it("getDeadLetters returns limited results", () => {
    expect(outbox.getDeadLetters(5)).toHaveLength(0)
  })
})
