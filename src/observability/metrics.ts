/**
 * @file metrics.ts
 * @description Prometheus-compatible metrics registry for EDITH.
 *   Zero external dependencies — implements the Prometheus text exposition
 *   format (version 0.0.4) natively.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - metrics.ts exports the global `registry` singleton and pre-registered
 *     `edithMetrics` counters/gauges/histograms.
 *   - gateway/server.ts exposes GET /metrics (admin-protected) for scraping.
 *   - message-pipeline.ts records message latency and LLM call durations.
 *   - session-store.ts calls edithMetrics.activeSessions.set() on mutation.
 *
 * METRIC NAMING:
 *   All metrics follow Prometheus conventions:
 *     edith_<subsystem>_<name>[_total|_bytes|_seconds]
 *
 * @module observability/metrics
 */

import { createLogger } from "../logger.js"

const log = createLogger("observability.metrics")

// ─── Types ────────────────────────────────────────────────────────────────────

/** Prometheus label set. Values must not contain unescaped quotes or newlines. */
export type Labels = Record<string, string>

/** Default histogram latency buckets in milliseconds. */
const DEFAULT_MS_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, Infinity]

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape a Prometheus label value per the exposition format spec. */
function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
}

/**
 * Serialize a Labels object into Prometheus label selector syntax.
 * Keys are sorted for a stable cache key.
 */
function serializeLabels(labels: Labels): string {
  const pairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
  return pairs.length > 0 ? `{${pairs.join(",")}}` : ""
}

/** Build a stable string key for a Labels object (used as Map key). */
function labelKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\x00")
}

// ─── Counter ─────────────────────────────────────────────────────────────────

/** Monotonically increasing counter. Thread-safe for single-process Node.js. */
export class Counter {
  private readonly data = new Map<string, { labels: Labels; value: number }>()

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {}

  /**
   * Increment the counter by the given amount (default 1).
   * @param labels - Label set (must match registered labelNames)
   * @param amount - Increment amount (must be ≥ 0)
   */
  inc(labels: Labels = {}, amount = 1): void {
    if (amount < 0) {
      log.warn("counter.inc received negative amount — ignored", { name: this.name, amount })
      return
    }
    const key = labelKey(labels)
    const existing = this.data.get(key)
    if (existing) {
      existing.value += amount
    } else {
      this.data.set(key, { labels, value: amount })
    }
  }

  /** Serialize this metric to Prometheus text format lines. */
  serialize(): string {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n`
    for (const { labels, value } of this.data.values()) {
      out += `${this.name}${serializeLabels(labels)} ${value}\n`
    }
    return out
  }
}

// ─── Gauge ───────────────────────────────────────────────────────────────────

/** A metric that can arbitrarily go up or down. */
export class Gauge {
  private readonly data = new Map<string, { labels: Labels; value: number }>()

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {}

  /** Set the gauge to an absolute value. */
  set(value: number, labels: Labels = {}): void {
    const key = labelKey(labels)
    const existing = this.data.get(key)
    if (existing) {
      existing.value = value
    } else {
      this.data.set(key, { labels, value })
    }
  }

  /** Increment the gauge. */
  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels)
    const existing = this.data.get(key)
    if (existing) {
      existing.value += amount
    } else {
      this.data.set(key, { labels, value: amount })
    }
  }

  /** Decrement the gauge. */
  dec(labels: Labels = {}, amount = 1): void {
    this.inc(labels, -amount)
  }

  /** Serialize this metric to Prometheus text format lines. */
  serialize(): string {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n`
    for (const { labels, value } of this.data.values()) {
      out += `${this.name}${serializeLabels(labels)} ${value}\n`
    }
    return out
  }
}

// ─── Histogram ───────────────────────────────────────────────────────────────

interface HistogramEntry {
  labels: Labels
  /** Cumulative count per bucket (index matches buckets array). */
  bucketCounts: number[]
  sum: number
  count: number
}

/**
 * Cumulative histogram for tracking latency distributions.
 * Buckets are cumulative (≤ boundary), matching Prometheus convention.
 */
export class Histogram {
  private readonly data = new Map<string, HistogramEntry>()

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
    /** Upper bounds in the same unit as observed values. Last bucket should be Infinity. */
    readonly buckets: readonly number[] = DEFAULT_MS_BUCKETS,
  ) {}

  /**
   * Record an observed value.
   * @param value - The observed measurement (e.g. latency in ms)
   * @param labels - Label set
   */
  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels)
    let entry = this.data.get(key)
    if (!entry) {
      entry = {
        labels,
        bucketCounts: new Array<number>(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      }
      this.data.set(key, entry)
    }

    entry.sum += value
    entry.count++

    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) {
        entry.bucketCounts[i]!++
      }
    }
  }

  /** Serialize this metric to Prometheus text format lines (cumulative). */
  serialize(): string {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} histogram\n`

    for (const entry of this.data.values()) {
      const baseLabels = entry.labels

      // Cumulative bucket lines
      for (let i = 0; i < this.buckets.length; i++) {
        const le = this.buckets[i] === Infinity ? "+Inf" : String(this.buckets[i])
        const merged: Labels = { ...baseLabels, le }
        out += `${this.name}_bucket${serializeLabels(merged)} ${entry.bucketCounts[i]}\n`
      }

      out += `${this.name}_sum${serializeLabels(baseLabels)} ${entry.sum}\n`
      out += `${this.name}_count${serializeLabels(baseLabels)} ${entry.count}\n`
    }

    return out
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** Global metrics registry — holds all registered metric instances. */
export class Registry {
  private readonly metrics: Array<Counter | Gauge | Histogram> = []

  /** Register and return a new Counter. */
  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    const m = new Counter(name, help, labelNames)
    this.metrics.push(m)
    return m
  }

  /** Register and return a new Gauge. */
  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    const m = new Gauge(name, help, labelNames)
    this.metrics.push(m)
    return m
  }

  /** Register and return a new Histogram. */
  histogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_MS_BUCKETS,
  ): Histogram {
    const m = new Histogram(name, help, labelNames, buckets)
    this.metrics.push(m)
    return m
  }

  /**
   * Serialize all registered metrics to Prometheus text exposition format.
   * Also injects live process metrics (heap, uptime) before returning.
   *
   * @returns UTF-8 text in Prometheus exposition format 0.0.4
   */
  serialize(): string {
    // Refresh live gauges before serializing
    const mem = process.memoryUsage()
    edithMetrics.heapUsedBytes.set(mem.heapUsed)
    edithMetrics.heapTotalBytes.set(mem.heapTotal)
    edithMetrics.rssBytes.set(mem.rss)
    edithMetrics.processUptimeSeconds.set(Math.floor(process.uptime()))

    return this.metrics.map((m) => m.serialize()).join("") + "# EOF\n"
  }
}

// ─── Global singleton ────────────────────────────────────────────────────────

/** Global Prometheus registry — all modules register metrics here. */
export const registry = new Registry()

// ─── Pre-registered EDITH metrics ────────────────────────────────────────────

/**
 * Canonical EDITH metric set.
 * Import `edithMetrics` from this file to record observations anywhere.
 *
 * @example
 *   import { edithMetrics } from "../observability/metrics.js"
 *   const t0 = Date.now()
 *   // ... process message ...
 *   edithMetrics.messageLatency.observe(Date.now() - t0, { channel: "telegram" })
 *   edithMetrics.messagesTotal.inc({ channel: "telegram", status: "ok" })
 */
export const edithMetrics = {
  // ── Messages ──────────────────────────────────────────────────────
  /** Total messages processed by the pipeline. */
  messagesTotal: registry.counter(
    "edith_messages_total",
    "Total messages processed by the EDITH pipeline.",
    ["channel", "status"],
  ),

  /** End-to-end message processing latency in milliseconds. */
  messageLatency: registry.histogram(
    "edith_message_latency_ms",
    "End-to-end message pipeline latency in milliseconds.",
    ["channel"],
  ),

  // ── LLM ───────────────────────────────────────────────────────────
  /** Total LLM generation calls. */
  llmCallsTotal: registry.counter(
    "edith_llm_calls_total",
    "Total LLM generation API calls.",
    ["provider", "status"],
  ),

  /** LLM generation latency in milliseconds. */
  llmLatency: registry.histogram(
    "edith_llm_latency_ms",
    "LLM generation call latency in milliseconds.",
    ["provider"],
  ),

  // ── Channels ──────────────────────────────────────────────────────
  /** Total outbound channel sends (after pipeline). */
  channelSendsTotal: registry.counter(
    "edith_channel_sends_total",
    "Total outbound channel send attempts.",
    ["channel", "status"],
  ),

  /** Channel send latency in milliseconds. */
  channelSendLatency: registry.histogram(
    "edith_channel_send_latency_ms",
    "Channel outbound send latency in milliseconds.",
    ["channel"],
  ),

  // ── Sessions ──────────────────────────────────────────────────────
  /** Current number of in-memory active sessions. */
  activeSessions: registry.gauge(
    "edith_active_sessions",
    "Number of active in-memory user sessions.",
  ),

  // ── Gateway ───────────────────────────────────────────────────────
  /** Current number of open WebSocket connections. */
  activeConnections: registry.gauge(
    "edith_active_websocket_connections",
    "Number of currently open WebSocket connections on the gateway.",
  ),

  /** Total gateway HTTP requests by method and status. */
  gatewayRequestsTotal: registry.counter(
    "edith_gateway_requests_total",
    "Total HTTP requests handled by the gateway.",
    ["method", "status"],
  ),

  // ── Errors ────────────────────────────────────────────────────────
  /** Total errors by source subsystem. */
  errorsTotal: registry.counter(
    "edith_errors_total",
    "Total errors encountered, labelled by source subsystem.",
    ["source"],
  ),

  // ── Memory / Vector store ─────────────────────────────────────────
  /** Total vector store retrieval operations. */
  memoryRetrievalsTotal: registry.counter(
    "edith_memory_retrievals_total",
    "Total LanceDB vector retrieval calls.",
    ["status"],
  ),

  /** Memory retrieval latency in milliseconds. */
  memoryRetrievalLatency: registry.histogram(
    "edith_memory_retrieval_latency_ms",
    "LanceDB vector retrieval latency in milliseconds.",
  ),

  // ── Process ───────────────────────────────────────────────────────
  /** Node.js heap used in bytes (refreshed on each /metrics scrape). */
  heapUsedBytes: registry.gauge(
    "edith_process_heap_used_bytes",
    "Node.js heap used memory in bytes.",
  ),

  /** Node.js heap total in bytes (refreshed on each /metrics scrape). */
  heapTotalBytes: registry.gauge(
    "edith_process_heap_total_bytes",
    "Node.js heap total memory in bytes.",
  ),

  /** Node.js RSS in bytes (refreshed on each /metrics scrape). */
  rssBytes: registry.gauge(
    "edith_process_rss_bytes",
    "Node.js resident set size in bytes.",
  ),

  /** Process uptime in seconds (refreshed on each /metrics scrape). */
  processUptimeSeconds: registry.gauge(
    "edith_process_uptime_seconds",
    "EDITH process uptime in seconds.",
  ),

  // ── Rate limiting ──────────────────────────────────────────────────
  /** Total messages rate-limited by the channel rate limiter. */
  channelRateLimitedTotal: registry.counter(
    "edith_channel_rate_limited_total",
    "Total messages dropped by the per-channel rate limiter.",
    ["channel"],
  ),

  /** Total number of times a channel circuit breaker transitioned to open state. */
  circuitBreakerOpenTotal: registry.counter(
    "edith_circuit_breaker_open_total",
    "Total times a channel circuit breaker opened.",
    ["channel"],
  ),

  /** Total circuit breaker state transitions by channel, from-state, and to-state. */
  circuitBreakerTransitions: registry.counter(
    "edith_circuit_breaker_transitions_total",
    "Total circuit breaker state transitions.",
    ["channel", "from", "to"],
  ),
}
