# Stability & Security Hardening Design

**Date:** 2026-03-09
**Status:** Auto-approved
**Context:** Continuation of production hardening — fills remaining gaps across all areas.

---

## Atom A — Error Boundaries (Process Stability → 10/10)

`src/core/error-boundaries.ts` — register global handlers at startup:
- `process.on("unhandledRejection")` → log.error + increment errorsTotal metric, do NOT crash
- `process.on("uncaughtException")` → log.error + call performShutdown() (exception = unrecoverable)
- Wire into `startup.ts` before any async work

---

## Atom B — DB Retention + Vacuum (DB Durability → 10/10)

`src/database/retention.ts` — weekly cleanup job via daemon:
- Delete `Message` rows older than `MESSAGE_RETENTION_DAYS` (default 365)
- Delete `AuditRecord` rows older than `AUDIT_RETENTION_DAYS` (default 90)
- Run `PRAGMA incremental_vacuum` after deletion to reclaim space
- Config: `MESSAGE_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`
- Safe: uses `prisma.message.deleteMany({ where: { createdAt: { lt: cutoff } } })`

---

## Atom C — Startup Migration (DB Durability: correctness)

Modify `src/core/startup.ts` `initialize()`:
- After `prisma.$connect()`, call `prisma.$executeRaw` to check pending migrations
- Actually run `exec("pnpm exec prisma migrate deploy")` as a child process
- On failure: log.warn and continue (graceful degradation, don't block startup)
- Config: `RUN_MIGRATIONS_ON_STARTUP` (default `true`)

---

## Atom D — Webhook Signature Verification (Security → 9/10)

`src/gateway/webhook-verifier.ts`:
- `verifyTelegramWebhook(body, secret)` — HMAC-SHA256 of body with `TELEGRAM_WEBHOOK_SECRET`
- `verifyDiscordWebhook(body, signature, timestamp)` — Ed25519 via `DISCORD_PUBLIC_KEY`
- `verifyWhatsAppWebhook(body, signature, secret)` — HMAC-SHA256 with `WHATSAPP_APP_SECRET`
- Wire as middleware in `server.ts` on `/webhooks/*` routes
- Config: `TELEGRAM_WEBHOOK_SECRET`, `DISCORD_PUBLIC_KEY`, `WHATSAPP_APP_SECRET`
- Skip verification if secret not configured (graceful degradation)

---

## Atom E — Circuit Breaker Metrics (Observability → 10/10)

`src/observability/metrics.ts` — add:
- `circuitBreakerOpenTotal` counter — incremented when circuit opens
- `circuitBreakerStateChanges` counter — label: `{channel, from, to}`

`src/channels/circuit-breaker.ts` — emit metrics on state transitions:
- `onSuccess()`: if was open/half-open → emit state change metric
- `onFailure()`: when circuit opens → emit open metric

---

## Atom F — Session Persistence (Process Stability: resilience)

`src/sessions/session-persistence.ts`:
- On shutdown: serialize active sessions to `.edith/sessions.json` (top 50 by last activity)
- On startup: load from disk if file exists, inject into SessionStore
- Wire into `shutdown.ts` (save) and `startup.ts` (load)
- Config: `SESSION_PERSIST_ENABLED` (default `true`), `SESSION_PERSIST_MAX` (default 50)

---

## Atom G — Memory Pressure Guard (Process Stability)

`src/core/memory-guard.ts`:
- Check `process.memoryUsage().heapUsed / process.memoryUsage().heapTotal` every 60 seconds
- If > 80%: log.warn + trigger session eviction (clear oldest 20% of sessions)
- If > 95%: log.error + trigger `performShutdown()` (prevent OOM crash)
- Wire into startup.ts

---

## Implementation Order

| Atom | Files | Priority |
|------|-------|----------|
| A | `src/core/error-boundaries.ts`, `startup.ts` | P0 |
| B | `src/database/retention.ts`, `daemon.ts`, `config.ts` | P1 |
| C | `src/core/startup.ts`, `config.ts` | P1 |
| D | `src/gateway/webhook-verifier.ts`, `server.ts`, `config.ts` | P1 |
| E | `src/observability/metrics.ts`, `src/channels/circuit-breaker.ts` | P2 |
| F | `src/sessions/session-persistence.ts`, `shutdown.ts`, `startup.ts` | P2 |
| G | `src/core/memory-guard.ts`, `startup.ts` | P2 |
