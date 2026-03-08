/**
 * @file circuit-breaker-metrics.test.ts
 * @description Tests that circuit breaker emits Prometheus metrics on state transitions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockOpenInc, mockTransitionInc } = vi.hoisted(() => ({
  mockOpenInc: vi.fn(),
  mockTransitionInc: vi.fn(),
}))

vi.mock("../../observability/metrics.js", () => ({
  edithMetrics: {
    circuitBreakerOpenTotal: { inc: mockOpenInc },
    circuitBreakerTransitions: { inc: mockTransitionInc },
  },
}))

import { ChannelCircuitBreaker } from "../circuit-breaker.js"

describe("ChannelCircuitBreaker metrics", () => {
  let cb: ChannelCircuitBreaker

  beforeEach(() => {
    cb = new ChannelCircuitBreaker({ failures: 2, cooldownMs: 50 })
    vi.clearAllMocks()
  })

  it("emits circuitBreakerOpenTotal when circuit opens", async () => {
    const fail = (): Promise<boolean> => Promise.reject(new Error("fail"))
    await cb.execute("ch1", fail).catch(() => {})
    await cb.execute("ch1", fail).catch(() => {})
    expect(mockOpenInc).toHaveBeenCalledWith({ channel: "ch1" })
  })

  it("emits circuitBreakerTransitions when circuit opens", async () => {
    const fail = (): Promise<boolean> => Promise.reject(new Error("fail"))
    await cb.execute("ch1", fail).catch(() => {})
    await cb.execute("ch1", fail).catch(() => {})
    expect(mockTransitionInc).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "ch1", to: "open" })
    )
  })

  it("emits circuitBreakerTransitions when circuit closes after probe", async () => {
    const fail = (): Promise<boolean> => Promise.reject(new Error("fail"))
    await cb.execute("ch1", fail).catch(() => {})
    await cb.execute("ch1", fail).catch(() => {})
    // Wait for cooldown to half-open
    await new Promise(r => setTimeout(r, 100))
    // Successful probe closes it
    await cb.execute("ch1", () => Promise.resolve(true))
    expect(mockTransitionInc).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "ch1", to: "closed" })
    )
  })
})
