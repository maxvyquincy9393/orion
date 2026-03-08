/**
 * @file memory-guard.test.ts
 * @description Tests for the memory pressure guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCleanup, mockShutdown, mockInc } = vi.hoisted(() => ({
  mockCleanup: vi.fn().mockReturnValue(5),
  mockShutdown: vi.fn().mockResolvedValue(undefined),
  mockInc: vi.fn(),
}))

vi.mock("../../sessions/session-store.js", () => ({
  sessionStore: { cleanupInactiveSessions: mockCleanup },
}))
vi.mock("../shutdown.js", () => ({ performShutdown: mockShutdown }))
vi.mock("../../observability/metrics.js", () => ({
  edithMetrics: { errorsTotal: { inc: mockInc } },
}))
vi.mock("../../config.js", () => ({
  default: { MEMORY_WARN_THRESHOLD: 0.8, MEMORY_CRITICAL_THRESHOLD: 0.95 },
}))

import { MemoryGuard } from "../memory-guard.js"

describe("MemoryGuard", () => {
  let guard: MemoryGuard

  beforeEach(() => {
    guard = new MemoryGuard()
    vi.clearAllMocks()
  })

  it("does nothing when heap ratio is below warn threshold", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValue(
      { heapUsed: 700, heapTotal: 1000, rss: 0, external: 0, arrayBuffers: 0 }
    )
    await guard.check()
    expect(mockCleanup).not.toHaveBeenCalled()
    expect(mockShutdown).not.toHaveBeenCalled()
  })

  it("evicts sessions when heap ratio >= warn threshold", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValue(
      { heapUsed: 850, heapTotal: 1000, rss: 0, external: 0, arrayBuffers: 0 }
    )
    await guard.check()
    expect(mockCleanup).toHaveBeenCalled()
    expect(mockShutdown).not.toHaveBeenCalled()
  })

  it("calls performShutdown when heap ratio >= critical threshold", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValue(
      { heapUsed: 960, heapTotal: 1000, rss: 0, external: 0, arrayBuffers: 0 }
    )
    await guard.check()
    expect(mockShutdown).toHaveBeenCalled()
  })

  it("start() and stop() do not throw", () => {
    guard.start()
    guard.stop()
  })
})
