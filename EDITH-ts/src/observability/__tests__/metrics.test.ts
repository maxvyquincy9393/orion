import { describe, expect, it } from "vitest"

import {
  incrementMemoryRetrieval,
  observeEngineCall,
  observeHttpRequest,
  renderPrometheusMetrics,
} from "../metrics.js"

describe("observability metrics", () => {
  it("records gateway, engine, and memory metrics", async () => {
    observeHttpRequest("GET", "/health", 200, 15)
    observeEngineCall("groq", "fast", true, 42)
    incrementMemoryRetrieval("pipeline_context")

    const metrics = await renderPrometheusMetrics()

    expect(metrics).toContain("edith_http_requests_total")
    expect(metrics).toContain("edith_engine_calls_total")
    expect(metrics).toContain("edith_memory_retrievals_total")
  })
})

