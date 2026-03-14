# ADR-003: Fastify for Gateway Server

## Status
Accepted

## Context
EDITH needs an HTTP + WebSocket gateway to serve the webchat UI, handle webhook callbacks from channels (Telegram, WhatsApp, Discord), expose REST APIs for admin operations, and provide real-time streaming via WebSockets.

Options evaluated: Express, Fastify, Hono, bare `node:http`.

## Decision
Use **Fastify** with `@fastify/websocket` for the unified gateway.

## Consequences
**Positive:**
- Schema-first validation via JSON Schema (aligns with Zod integration)
- Plugin architecture enables clean separation (auth, CSRF, health, metrics as plugins)
- ~2x throughput vs Express in benchmarks for JSON serialization workloads
- First-class TypeScript support with typed route handlers
- Built-in request/response lifecycle hooks for middleware

**Negative:**
- Smaller community than Express — fewer third-party middleware options
- `@fastify/websocket` wraps `ws` but adds Fastify-specific API patterns
- Plugin registration order matters — subtle bugs if order is wrong

## Alternatives Considered
- **Express:** Largest ecosystem but slower, callback-heavy, weaker TypeScript support
- **Hono:** Lightweight and fast but designed for edge/serverless, not long-lived server processes
- **bare node:http:** Maximum control but requires reimplementing routing, body parsing, CORS, etc.
