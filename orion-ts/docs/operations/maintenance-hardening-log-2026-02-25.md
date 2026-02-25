# Maintenance Hardening Log (2026-02-25)

Scope: production maintainability + bug hunting across core pipeline, engines, security, gateway, skills, observability, and memory stack.

## What Changed (high impact)

- Refactored `src/core/message-pipeline.ts` into stage helpers with explicit boundaries (context build, compaction, persona context, output scan, persistence, async side effects).
- Hardened `src/engines/orchestrator.ts` routing and fallback behavior:
  - `openrouter` now routable.
  - fallback chain retries next engine on throw or empty output.
- Reduced duplication and clarified policy in:
  - `src/security/prompt-filter.ts`
  - `src/security/affordance-checker.ts`
- Hardened memory/graph/retrieval behavior in:
  - `src/memory/store.ts`
  - `src/memory/memrl.ts`
  - `src/memory/hybrid-retriever.ts`
  - `src/memory/causal-graph.ts`
- Hardened transport and validation in `src/gateway/server.ts`.
- Improved tenant config merge/lifecycle handling in `src/core/workspace-resolver.ts`.
- Hardened flush lifecycle and summary correctness in `src/observability/usage-tracker.ts`.
- Refactored parser/security/cache handling in `src/skills/loader.ts`.

## Bug Fixes (not exhaustive, most critical)

- Engine routing:
  - `OpenRouter` missing from priority map.
  - no real fallback chain in `generate()`.
  - empty engine output treated as success.
- Gateway:
  - admin usage endpoint auth bypass when `ADMIN_TOKEN` unset.
  - unsafe/fragile payload parsing for HTTP + WebSocket messages.
  - voice transcript path bypassed normal message pipeline hooks.
- Memory:
  - embeddings fallback skipped OpenAI.
  - embedding requests had no timeout.
  - pending MemRL feedback could go stale/leak.
  - MemRL retrieval/update paths now tolerate malformed runtime data better.
- hybrid FTS query incorrectly filtered by sanitized Prisma `userId`.
- hybrid FTS join used `m.id = fts.rowid` (string PK vs SQLite rowid mismatch).
- hybrid FTS builder dropped short technical tokens (`go`, `js`, `ts`, `io`, etc.) and reduced lexical recall for developer queries.
- causal hyperedge extraction weight was parsed but never persisted.
- hyperedges could duplicate aggressively for repeated extractions (best-effort dedupe added).
- causal graph retrieval could broad-scan on empty query (`contains: ""`) and traverse duplicate edges repeatedly.
- Workspace/bootstrap:
  - nested tenant config updates were shallow-merged.
  - `updateUserMd()` replacement corrupted values containing `$1`, `$&`, etc.
  - `appendMemory()` allowed multiline markdown injection.

## Validation Status

- `pnpm typecheck` passes (`tsc --noEmit`)
- Vitest remains blocked in current Windows sandbox due `spawn EPERM` / Vite realpath import path restrictions

## Local Docs Ignore Convention

Use `docs/_local/` for scratch notes, temporary research logs, or one-off investigation writeups.
That directory is intentionally ignored in `.gitignore` so tracked docs stay clean.

## Next Recommended Tranche

1. Integration tests for memory graph/hybrid retrieval with mocked Prisma + orchestrator.
2. Split `src/memory/causal-graph.ts` into parser/persistence/retrieval modules.
3. Add schema-level dedupe strategy for graph nodes/hyperedges (migration plan).
4. Run full Vitest suite in host/CI (non-sandbox) and fix assertion regressions.

## Follow-up Notes (pass 2)

- `hybrid-retriever` FTS join now uses SQLite `rowid` (`m.rowid = fts.rowid`) to match FTS5 semantics.
- `causal-graph` retrieval now trims/clips query input and skips keyword graph scans for empty queries.
- Graph traversal suppresses duplicate edge processing during BFS to reduce repeated edge candidates.

## Follow-up Notes (pass 3)

- Added integration-style mocked tests for `causal-graph` and `hybrid-retriever` to lock regressions around:
  - hyperedge weight persistence + dedupe update behavior
  - raw Prisma `userId` parameter and short-token FTS query generation
- Added schema migration plan for DB-level graph dedupe constraints:
  - `docs/migrations/causal-graph-dedupe-plan.md`

## Follow-up Notes (pass 4)

- Added executable maintenance CLI for graph dedupe (dry-run by default):
  - `src/cli/causal-graph-dedupe.ts`
  - `pnpm dedupe:causal-graph:dry-run`
  - `pnpm dedupe:causal-graph`
- Added pure dedupe utility module + unit tests:
  - `src/memory/causal-graph-dedupe-utils.ts`
  - `src/memory/__tests__/causal-graph-dedupe-utils.test.ts`
- Added CI workflow (Ubuntu + Windows) to run `typecheck` and `test:ci` outside sandbox:
  - `.github/workflows/ci.yml`

## Follow-up Notes (pass 5)

- Added Stage-1 Prisma schema + migration scaffold for graph dedupe keys (nullable, non-breaking):
  - `prisma/schema.prisma` (`CausalNode.eventKey`, `HyperEdge.memberSetHash`)
  - `prisma/migrations/20260225133000_add_causal_graph_dedupe_keys_stage1/migration.sql`
- Backfill + unique constraint enforcement still follows the staged plan in:
  - `docs/migrations/causal-graph-dedupe-plan.md`

## Follow-up Notes (pass 6)

- Runtime verification succeeded outside sandbox:
  - `pnpm test:ci` => `15` test files passed / `45` tests passed
- Local rollout steps executed:
  - `pnpm exec prisma migrate deploy` applied `20260225133000_add_causal_graph_dedupe_keys_stage1`
  - `pnpm dedupe:causal-graph:dry-run` completed successfully (local DB summary: `0` scanned graph rows)
- Post-verification fixes:
  - `workspace-resolver` now falls back to `user` when sanitized ID contains no alphanumeric chars (e.g. `!!!`)
  - prompt-filter delimiter-abuse test now asserts stable contract (`injection pattern detected`) instead of brittle rule-order exact reason

## Follow-up Notes (pass 7)

- `causal-graph` writer now populates Stage-1 dedupe keys:
  - `CausalNode.eventKey`
  - `HyperEdge.memberSetHash`
- Node resolution now also matches by normalized `eventKey` (reduces duplicates across casing/spacing variants).
- Dedupe CLI now backfills dedupe key columns during run:
  - node `eventKey` backfill phase
  - hyperedge `memberSetHash` backfill phase (after node dedupe repoints memberships)
- Runtime verification re-run after writer/backfill patch:
  - `pnpm test:ci` => `15` test files passed / `45` tests passed
