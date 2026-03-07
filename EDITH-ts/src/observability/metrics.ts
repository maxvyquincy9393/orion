import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type LabelValues,
} from "prom-client"

import config from "../config.js"

const registry = new Registry()
const METRICS_PREFIX = config.METRICS_PREFIX || "edith_"
const METRICS_ENABLED = config.METRICS_ENABLED

let defaultsInitialized = false

const HTTP_REQUEST_LABELS = ["method", "route", "status"] as const
const ENGINE_CALL_LABELS = ["engine", "task", "success"] as const
const MEMORY_LABELS = ["source"] as const

function metricName(name: string): string {
  return `${METRICS_PREFIX}${name}`
}

function initDefaultMetrics(): void {
  if (defaultsInitialized || !METRICS_ENABLED) {
    return
  }
  collectDefaultMetrics({
    register: registry,
    prefix: METRICS_PREFIX,
  })
  defaultsInitialized = true
}

function getOrCreateCounter<T extends string>(
  name: string,
  help: string,
  labelNames: readonly T[],
): Counter<T> {
  const existing = registry.getSingleMetric(name)
  if (existing) {
    return existing as Counter<T>
  }

  return new Counter<T>({
    name,
    help,
    labelNames: [...labelNames],
    registers: [registry],
  })
}

function getOrCreateHistogram<T extends string>(
  name: string,
  help: string,
  labelNames: readonly T[],
  buckets: number[],
): Histogram<T> {
  const existing = registry.getSingleMetric(name)
  if (existing) {
    return existing as Histogram<T>
  }

  return new Histogram<T>({
    name,
    help,
    labelNames: [...labelNames],
    buckets,
    registers: [registry],
  })
}

const httpRequestsTotal = getOrCreateCounter(
  metricName("http_requests_total"),
  "Total number of HTTP requests handled by gateway",
  HTTP_REQUEST_LABELS,
)
const httpRequestDurationSeconds = getOrCreateHistogram(
  metricName("http_request_duration_seconds"),
  "Gateway HTTP request latency in seconds",
  HTTP_REQUEST_LABELS,
  [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
)
const engineCallsTotal = getOrCreateCounter(
  metricName("engine_calls_total"),
  "Total number of engine calls",
  ENGINE_CALL_LABELS,
)
const engineLatencySeconds = getOrCreateHistogram(
  metricName("engine_latency_seconds"),
  "Engine generation latency in seconds",
  ENGINE_CALL_LABELS,
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
)
const memoryRetrievalsTotal = getOrCreateCounter(
  metricName("memory_retrievals_total"),
  "Total memory retrieval operations",
  MEMORY_LABELS,
)

function toLabels<T extends string>(values: Record<T, string>): LabelValues<T> {
  return values as LabelValues<T>
}

export function observeHttpRequest(
  method: string,
  route: string,
  status: number,
  durationMs: number,
): void {
  if (!METRICS_ENABLED) {
    return
  }

  initDefaultMetrics()
  const labels = toLabels({
    method: method.toUpperCase(),
    route,
    status: String(status),
  })
  httpRequestsTotal.inc(labels)
  httpRequestDurationSeconds.observe(labels, Math.max(0, durationMs) / 1000)
}

export function observeEngineCall(
  engine: string,
  task: string,
  success: boolean,
  durationMs: number,
): void {
  if (!METRICS_ENABLED) {
    return
  }

  initDefaultMetrics()
  const labels = toLabels({
    engine,
    task,
    success: success ? "true" : "false",
  })
  engineCallsTotal.inc(labels)
  engineLatencySeconds.observe(labels, Math.max(0, durationMs) / 1000)
}

export function incrementMemoryRetrieval(source = "pipeline"): void {
  if (!METRICS_ENABLED) {
    return
  }

  initDefaultMetrics()
  memoryRetrievalsTotal.inc(toLabels({ source }))
}

export async function renderPrometheusMetrics(): Promise<string> {
  if (!METRICS_ENABLED) {
    return "# metrics disabled\n"
  }
  initDefaultMetrics()
  return registry.metrics()
}

export function metricsContentType(): string {
  return registry.contentType
}

export const __metricsTestUtils = {
  registry,
}

