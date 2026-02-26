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

## Follow-up Notes (pass 8)

- Added Stage-3 Prisma schema + migration scaffold for causal-graph dedupe constraints:
  - `prisma/migrations/20260225163000_enforce_causal_graph_dedupe_keys_stage3/migration.sql`
  - enforces non-null `CausalNode.eventKey` and `HyperEdge.memberSetHash`
  - adds unique constraints for `(userId, eventKey)` and `(userId, relation, memberSetHash)`
- Dedupe CLI summary now prints explicit Stage-3 readiness checks:
  - missing `eventKey` row count
  - missing `memberSetHash` row count
  - remaining duplicate node/hyperedge group counts
  - final `Ready for Stage-3 migration: YES|NO`

## Follow-up Notes (pass 9)

- Stage-3 migration verified on local SQLite (empty graph dataset):
  - `pnpm exec prisma migrate deploy` applied `20260225163000_enforce_causal_graph_dedupe_keys_stage3`
- Dedupe CLI dry-run re-verified after Stage-3 migration:
  - readiness summary prints all zero counts locally and `Ready for Stage-3 migration: YES`
- Regression verification after Stage-3 schema/CLI patch:
  - `pnpm test:ci` => `15` test files passed / `45` tests passed
- Remaining rollout caveat:
  - real environments still must run dedupe/backfill dry-run and review counts before applying Stage-3 migration

## Follow-up Notes (pass 10)

- Hardened `causal-graph` write paths for Stage-3 unique-constraint races (`P2002`):
  - `CausalNode` create conflict now reloads canonical row by `event`/`eventKey`
  - `CausalEdge` create conflict now retries via read/update merge path
  - `HyperEdge` create conflict now reloads keyed row and updates weight/context
  - existing/conflict hyperedge paths now ensure missing memberships are backfilled
- Added mocked regression tests for concurrent create conflict recovery in:
  - `src/memory/__tests__/causal-graph.integration.test.ts`
- Regression verification after race hardening:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `15` test files passed / `47` tests passed

## Follow-up Notes (pass 11)

- Fixed causal-graph read-path lookup mismatch after dedupe-key rollout:
  - `getDownstreamEffects()` previously matched only exact `event` string
  - queries with different casing/trim (e.g. `" late sleep "`) could miss existing nodes
  - now reuses normalized event/eventKey lookup helper used by write paths
- Added regression test covering eventKey fallback for downstream effect lookup in:
  - `src/memory/__tests__/causal-graph.integration.test.ts`
- Regression verification after read-path fix:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `15` test files passed / `48` tests passed

## Follow-up Notes (pass 12)

- Added Telegram HP-test channel (`src/channels/telegram.ts`) with:
  - long polling (`getUpdates`) + `deleteWebhook` startup reset
  - private-chat-safe default (group chats require explicit `TELEGRAM_CHAT_ID` allowlist)
  - `/start`, `/help`, `/id`, `/ping`
  - per-chat serialized processing to avoid overlapping responses
- Extracted shared incoming-message runtime path from gateway into:
  - `src/core/incoming-message-service.ts`
  - keeps hooks, usage tracking, and MemRL feedback consistent across gateway + Telegram
- Fixed Telegram formatting reliability bug:
  - Telegram HTML output now escapes raw `<`, `>`, `&` before sending
  - code spans/blocks are protected from accidental italic/bold replacement
  - plain-text fallback added on Telegram entity parse failures
- Added tests:
  - `src/channels/__tests__/telegram.test.ts`
  - `src/markdown/__tests__/processor.test.ts`
- Regression verification:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `17` test files passed / `55` tests passed

## Follow-up Notes (pass 13)

- Added Discord HP-test channel adapter (`src/channels/discord.ts`) with:
  - DM-only default when `DISCORD_CHANNEL_ID` is unset
  - explicit allowlist support for guild channels
  - `!help`/`/help`, `!id`/`/id`, `!ping`/`/ping`
  - per-channel serialized processing using shared incoming-message service
- Integrated Discord channel into `ChannelManager` startup + proactive send priority.
- Added Discord channel helper tests:
  - `src/channels/__tests__/discord.test.ts`
- Added Discord quickstart + references doc:
  - `docs/channels/discord.md`
- Regression verification:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `18` test files passed / `60` tests passed

## Follow-up Notes (pass 14)

- Added OpenClaw-inspired onboarding/setup flow:
  - `pnpm onboard` / `pnpm setup`
  - guided quickstart for Telegram / Discord / WebChat + provider selection
  - `.env` merge writer preserves comments and appends missing keys safely
- Extracted/tested onboarding helper logic:
  - `src/cli/onboard.ts`
  - `src/cli/__tests__/onboard.test.ts`
- Added onboarding docs + command shortcuts:
  - `docs/platform/onboarding.md`
  - `package.json` scripts: `all`, `gateway`, `gateway:watch`, `onboard`, `setup`
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `19` test files passed / `63` tests passed
  - `pnpm onboard --help` renders expected quickstart usage text (verified outside sandbox)

## Follow-up Notes (pass 15)

- Added WhatsApp Cloud API mode (official Meta API) alongside existing Baileys mode in:
  - `src/channels/whatsapp.ts`
  - new env knobs: `WHATSAPP_MODE`, `WHATSAPP_CLOUD_*`
- Added gateway webhook endpoints for Meta verification + inbound message ingestion:
  - `GET /webhooks/whatsapp`
  - `POST /webhooks/whatsapp`
- Inbound WhatsApp Cloud messages now reuse shared incoming pipeline path (`hooks`, `usage`, `MemRL`) and support:
  - `/help`, `/id`, `/ping` (also `!help`, `!id`, `!ping`)
  - per-sender serialized processing
  - best-effort webhook duplicate suppression by `message.id`
- Bug fix:
  - `ChannelManager.send()` proactive priority now prefers `whatsapp` before `webchat` (prevents webchat from stealing sends when both are connected)
- Added tests/docs:
  - `src/channels/__tests__/whatsapp.test.ts`
  - `docs/channels/whatsapp.md`
  - onboarding wizard/docs updated to include WhatsApp Cloud API quickstart
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `20` test files passed / `68` tests passed
  - `pnpm onboard --help` shows `--channel ...whatsapp...`

## Follow-up Notes (pass 16)

- Adjusted onboarding UX for WhatsApp to be QR-first (OpenClaw-style quick test):
  - wizard now asks `Scan QR (Baileys)` vs `Cloud API`
  - default/recommended path is QR scan
  - Cloud API remains available as advanced/official mode
- Added `--whatsapp-mode scan|cloud` CLI flag for scripted onboarding runs.
- Updated WhatsApp docs to lead with QR scan quickstart and move Cloud API under advanced section.

## Follow-up Notes (pass 17)

- Fixed beginner onboarding UX issue with pnpm command collisions:
  - `pnpm setup` conflicts with pnpm built-in `setup`
  - added beginner-safe aliases:
    - `pnpm quickstart`
    - `pnpm wa:scan`
    - `pnpm wa:cloud`
- Updated onboarding help/docs to use `pnpm onboard -- <args>` when passing script flags.

## Follow-up Notes (pass 18)

- Added Phase-1 global-style `orion` CLI wrapper (`bin/orion.js`) with OpenClaw-like command ergonomics:
  - `orion link <repo>`
  - `orion quickstart`
  - `orion wa scan`
  - `orion wa cloud`
  - `orion all`, `orion doctor`, `orion gateway`
- Wrapper stores linked repo path in `~/.orion/cli.json` and proxies to `pnpm --dir <repo> ...`.
- Added `package.json` bin entry for npm global install (`orion`).
- Added helper tests for CLI parsing/repo detection and docs:
  - `src/cli/__tests__/orion-global.test.ts`
  - `docs/platform/global-cli.md`
- Validation:
  - `node bin/orion.js --help` prints expected OpenClaw-style wrapper commands
  - `node bin/orion.js repo --repo .` resolves current repo path
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `73` tests passed

## Follow-up Notes (pass 19)

- Phase-2 global wrapper improvements (`bin/orion.js`):
  - added profile bootstrap + runtime env forwarding (`ORION_ENV_FILE`, `ORION_WORKSPACE`, `ORION_STATE_DIR`)
  - new commands: `orion profile`, `orion profile init`, `orion init`
  - wrapper now auto-bootstraps profile env/workspace/state before running Orion commands
- `src/config.ts` now honors `ORION_ENV_FILE` so onboarding/runtime can use profile-scoped `.env`.
- `src/cli/onboard.ts` now writes to `ORION_ENV_FILE` target when provided (global wrapper path).
- `src/channels/whatsapp.ts` now stores Baileys auth under `ORION_STATE_DIR` (profile-scoped) when set.
- Added/extended tests/docs:
  - `src/cli/__tests__/orion-global.test.ts`
  - `docs/platform/global-cli.md`
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `74` tests passed
  - `node bin/orion.js profile init --repo .` creates `%USERPROFILE%\\.orion\\profiles\\default` (`.env`, `workspace`, `.orion` state dir)
  - sandbox-only smoke with local profile path also validated profile bootstrap logic before global config write (`EPERM` on home write without escalation)
