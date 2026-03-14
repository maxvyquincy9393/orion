# Staff Engineer Hardening — Design Document

> Date: 2026-03-14
> Status: Approved
> Scope: P0–P3 (13 items across 25+ files)

## Summary

Comprehensive hardening pass implementing all items from the Senior Staff Engineer system prompt.
Organized in 4 sequential waves that each ship independently.

## Wave 1: Security Hardening

| Item | File | Change |
|------|------|--------|
| 1a. LanceDB filter builder | `src/memory/lance-filter.ts` (new) | Safe parameterized filter builder replacing string concat |
| 1b. CaMeL secret length | `src/security/camel-guard.ts` | Min 16→32, read from vault |
| 1c. Gateway Zod validation | `src/gateway/gateway-utils.ts` | Replace manual normalization with Zod schema |
| 1d. Audit logger | `src/observability/audit-logger.ts` (new) | Structured audit events, separate from operational logger |

## Wave 2: Reliability

| Item | File | Change |
|------|------|--------|
| 2a. Outbox wiring | `src/core/startup.ts`, `src/main.ts` | Flush outbox AFTER channelManager.init() with real sendFn |
| 2b. /ready endpoint | `src/gateway/health.ts` | New GET /ready with DB+engine+memory checks |
| 2c. Voice debounce | `src/gateway/server.ts` | 400ms debounce on transcript callback |
| 2d. Shutdown improvements | `src/core/shutdown.ts` | In-flight drain, async queue flush |

## Wave 3: Engines + Observability

| Item | File | Change |
|------|------|--------|
| 3a. Engine streaming interface | `src/engines/types.ts` | Optional `generateStream` + `generateStructured` |
| 3b. Adaptive router persistence | `src/engines/adaptive-router.ts` | Save/load routing scores to SQLite |
| 3c. Circuit breaker persistence | `src/engines/orchestrator.ts` | Persist CB state, add jitter, per-task thresholds |
| 3d. JSON logger | `src/logger.ts` | JSON format when EDITH_ENV=production |
| 3e. Embedding version guard | `src/memory/store.ts` | Store+check embedding model name |
| 3f. Per-user rate limiting | `src/gateway/rate-limiter.ts` | User-level rate limit alongside IP-level |
| 3g. Pipeline tracing | `src/core/message-pipeline.ts` | traceId propagation through all stages |

## Wave 4: Tests + Docs

| Item | File | Change |
|------|------|--------|
| 4a. Security tests | 5 new test files | camel-guard, output-scanner, vault, dual-agent-reviewer, tool-guard |
| 4b. Legion coordinator test | `src/agents/legion/__tests__/coordinator.test.ts` | DAG wave execution, depth guard, synthesis |
| 4c. ADR documents | `docs/decisions/001-006` | LanceDB, Prisma, Fastify, MemRL, CaMeL, SQLite→PG |

## Execution

Waves execute sequentially. Each wave is committed atomically.
Estimated: ~2000 lines of new/modified code.
