/**
 * @file metrics.test.ts
 * @description Unit tests for the Prometheus metrics module.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Counter, Gauge, Histogram, Registry } from "../metrics.js"

// Re-export private classes for testing by importing the module
// (Registry and metric classes are exported from metrics.ts)


describe("Counter", () => {
  let counter: Counter

  beforeEach(() => {
    counter = new Counter("test_total", "Test counter", ["status"])
  })

  it("starts at zero", () => {
    counter.inc({ status: "ok" }, 0)
    const out = counter.serialize()
    expect(out).toContain("test_total")
  })

  it("increments correctly", () => {
    counter.inc({ status: "ok" })
    counter.inc({ status: "ok" })
    counter.inc({ status: "ok" }, 3)
    const out = counter.serialize()
    expect(out).toContain('test_total{status="ok"} 5')
  })

  it("tracks separate label sets independently", () => {
    counter.inc({ status: "ok" }, 10)
    counter.inc({ status: "error" }, 3)
    const out = counter.serialize()
    expect(out).toContain('test_total{status="ok"} 10')
    expect(out).toContain('test_total{status="error"} 3')
  })

  it("ignores negative increments", () => {
    counter.inc({ status: "ok" }, 5)
    counter.inc({ status: "ok" }, -2) // should be ignored
    expect(counter.serialize()).toContain('test_total{status="ok"} 5')
  })

  it("emits HELP and TYPE lines", () => {
    const out = counter.serialize()
    expect(out).toContain("# HELP test_total Test counter")
    expect(out).toContain("# TYPE test_total counter")
  })

  it("escapes quotes in label values", () => {
    counter.inc({ status: 'has"quote' })
    expect(counter.serialize()).toContain('\\"quote')
  })
})

describe("Gauge", () => {
  let gauge: Gauge

  beforeEach(() => {
    gauge = new Gauge("test_gauge", "Test gauge")
  })

  it("set() records a value", () => {
    gauge.set(42)
    expect(gauge.serialize()).toContain("test_gauge 42")
  })

  it("inc() adds to current value", () => {
    gauge.set(10)
    gauge.inc({}, 5)
    expect(gauge.serialize()).toContain("test_gauge 15")
  })

  it("dec() subtracts from current value", () => {
    gauge.set(10)
    gauge.dec({}, 3)
    expect(gauge.serialize()).toContain("test_gauge 7")
  })

  it("can go negative", () => {
    gauge.set(0)
    gauge.dec({}, 5)
    expect(gauge.serialize()).toContain("test_gauge -5")
  })

  it("emits correct TYPE", () => {
    expect(gauge.serialize()).toContain("# TYPE test_gauge gauge")
  })
})

describe("Histogram", () => {
  let hist: Histogram

  beforeEach(() => {
    hist = new Histogram("test_latency", "Test histogram", ["method"], [10, 100, 1_000, Infinity])
  })

  it("records observations and emits bucket lines", () => {
    hist.observe(50, { method: "GET" })
    hist.observe(500, { method: "GET" })
    const out = hist.serialize()
    // Labels are serialized in alphabetical order: le < method
    // le=10: 0 (50 > 10, 500 > 10)
    expect(out).toContain('test_latency_bucket{le="10",method="GET"} 0')
    // le=100: 1 (50 ≤ 100, 500 > 100)
    expect(out).toContain('test_latency_bucket{le="100",method="GET"} 1')
    // le=1000: 2 (both ≤ 1000)
    expect(out).toContain('test_latency_bucket{le="1000",method="GET"} 2')
    // le=+Inf: 2
    expect(out).toContain('test_latency_bucket{le="+Inf",method="GET"} 2')
  })

  it("emits _sum and _count", () => {
    hist.observe(50, { method: "POST" })
    hist.observe(150, { method: "POST" })
    const out = hist.serialize()
    expect(out).toContain('test_latency_sum{method="POST"} 200')
    expect(out).toContain('test_latency_count{method="POST"} 2')
    // Bucket labels: le < method alphabetically
    expect(out).toContain('test_latency_bucket{le="+Inf",method="POST"} 2')
  })

  it("handles multiple label sets", () => {
    hist.observe(10, { method: "GET" })
    hist.observe(20, { method: "POST" })
    const out = hist.serialize()
    expect(out).toContain('method="GET"')
    expect(out).toContain('method="POST"')
  })

  it("emits HELP and TYPE lines", () => {
    const out = hist.serialize()
    expect(out).toContain("# HELP test_latency Test histogram")
    expect(out).toContain("# TYPE test_latency histogram")
  })
})

describe("Registry", () => {
  let reg: Registry

  beforeEach(() => {
    reg = new Registry()
  })

  it("serializes all registered metrics", () => {
    const c = reg.counter("reg_requests", "Requests", ["status"])
    const g = reg.gauge("reg_sessions", "Sessions")
    const h = reg.histogram("reg_latency", "Latency")

    c.inc({ status: "ok" }, 7)
    g.set(3)
    h.observe(100)

    const out = reg.serialize()
    expect(out).toContain("reg_requests")
    expect(out).toContain("reg_sessions")
    expect(out).toContain("reg_latency")
    expect(out).toContain("# EOF")
  })

  it("ends with EOF marker", () => {
    const out = reg.serialize()
    expect(out.trim().endsWith("# EOF")).toBe(true)
  })

  it("multiple metrics are all present in output", () => {
    const names = ["alpha", "beta", "gamma"]
    for (const n of names) {
      reg.counter(n, `Help for ${n}`)
    }
    const out = reg.serialize()
    for (const n of names) {
      expect(out).toContain(n)
    }
  })

  it("label key stability — same labels produce same key regardless of insertion order", () => {
    const c = reg.counter("stability_test", "Test", ["a", "b"])
    c.inc({ a: "1", b: "2" })
    c.inc({ b: "2", a: "1" }) // same logical labels, different insertion order
    const out = c.serialize()
    // Should have a single entry with value 2
    const valueMatch = out.match(/stability_test\{.*\} (\d+)/)
    expect(valueMatch?.[1]).toBe("2")
  })
})
