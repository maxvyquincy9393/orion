import { diag, DiagConsoleLogger, DiagLogLevel, type Attributes, SpanStatusCode, trace } from "@opentelemetry/api"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { NodeSDK } from "@opentelemetry/sdk-node"

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("observability.tracing")
const tracer = trace.getTracer("edith")

let sdk: NodeSDK | null = null
let started = false

export async function initializeTracing(): Promise<void> {
  if (!config.OTEL_ENABLED || started) {
    return
  }

  if (config.LOG_LEVEL === "debug") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)
  }

  sdk = new NodeSDK({
    serviceName: config.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({
      url: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    instrumentations: [
      getNodeAutoInstrumentations(),
    ],
  })

  await sdk.start()
  started = true
  log.info("OpenTelemetry tracing initialized", {
    serviceName: config.OTEL_SERVICE_NAME,
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  })
}

export async function shutdownTracing(): Promise<void> {
  if (!started || !sdk) {
    return
  }

  await sdk.shutdown()
  started = false
  sdk = null
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  if (!config.OTEL_ENABLED) {
    return fn()
  }

  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn()
    } catch (error) {
      span.recordException(error as Error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      span.end()
    }
  })
}

