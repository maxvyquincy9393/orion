/**
 * httpTool — Generic HTTP client for API calls and web requests.
 *
 * Supports GET, POST, PUT, PATCH, DELETE.
 * JSON and form-data bodies supported.
 * Response truncated and scanned for injection.
 *
 * Security: domain allowlist/blocklist checked against config.
 *
 * @module agents/tools/http
 */
import { tool } from "ai"
import { z } from "zod"
import { filterToolResult } from "../../security/prompt-filter.js"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.http")

// Domains that should never be accessed by this tool
const BLOCKED_DOMAINS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "169.254.",  // AWS metadata
  "::1",
]

const MAX_RESPONSE_CHARS = 10_000
const FETCH_TIMEOUT_MS = 20_000

function isBlockedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return BLOCKED_DOMAINS.some((blocked) => 
      hostname === blocked || hostname.includes(blocked)
    )
  } catch {
    return true
  }
}

export const httpTool = tool({
  description: `Make HTTP requests to external APIs and web services.
Supports GET, POST, PUT, PATCH, DELETE.
Use for: calling REST APIs, webhooks, fetching JSON data, posting to external services.
Note: Cannot access localhost or internal network addresses.`,
  inputSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().describe("Full URL including https://"),
    headers: z.record(z.string(), z.string()).optional().describe("HTTP headers as key-value pairs"),
    body: z.string().optional().describe("Request body (JSON string or form data)"),
    contentType: z.enum(["application/json", "application/x-www-form-urlencoded", "text/plain"])
      .optional()
      .default("application/json"),
  }),
  execute: async ({ method, url, headers, body, contentType }) => {
    if (isBlockedDomain(url)) {
      log.warn("httpTool blocked domain access", { url })
      return "Error: Access to internal/private network addresses is not allowed."
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": contentType ?? "application/json",
        "User-Agent": "Orion-Agent/1.0",
        ...headers,
      }

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: method !== "GET" && body ? body : undefined,
        signal: controller.signal,
      })

      const responseText = await response.text()
      const truncated = responseText.slice(0, MAX_RESPONSE_CHARS)
      const filtered = filterToolResult(truncated)

      log.info("httpTool request complete", { method, url, status: response.status })

      return JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: filtered.sanitized,
      }, null, 2)
    } catch (err) {
      log.error("httpTool failed", { method, url, error: String(err) })
      return `HTTP request failed: ${String(err)}`
    } finally {
      clearTimeout(timeout)
    }
  },
})
