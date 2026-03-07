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

- Added EDITH-inspired onboarding/setup flow:
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

- Adjusted onboarding UX for WhatsApp to be QR-first (EDITH-style quick test):
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

- Added Phase-1 global-style `edith` CLI wrapper (`bin/edith.js`) with EDITH-like command ergonomics:
  - `edith link <repo>`
  - `edith quickstart`
  - `edith wa scan`
  - `edith wa cloud`
  - `edith all`, `edith doctor`, `edith gateway`
- Wrapper stores linked repo path in `~/.edith/cli.json` and proxies to `pnpm --dir <repo> ...`.
- Added `package.json` bin entry for npm global install (`edith`).
- Added helper tests for CLI parsing/repo detection and docs:
  - `src/cli/__tests__/edith-global.test.ts`
  - `docs/platform/global-cli.md`
- Validation:
  - `node bin/edith.js --help` prints expected EDITH-style wrapper commands
  - `node bin/edith.js repo --repo .` resolves current repo path
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `73` tests passed

## Follow-up Notes (pass 19)

- Phase-2 global wrapper improvements (`bin/edith.js`):
  - added profile bootstrap + runtime env forwarding (`EDITH_ENV_FILE`, `EDITH_WORKSPACE`, `EDITH_STATE_DIR`)
  - new commands: `edith profile`, `edith profile init`, `edith init`
  - wrapper now auto-bootstraps profile env/workspace/state before running EDITH commands
- `src/config.ts` now honors `EDITH_ENV_FILE` so onboarding/runtime can use profile-scoped `.env`.
- `src/cli/onboard.ts` now writes to `EDITH_ENV_FILE` target when provided (global wrapper path).
- `src/channels/whatsapp.ts` now stores Baileys auth under `EDITH_STATE_DIR` (profile-scoped) when set.
- Added/extended tests/docs:
  - `src/cli/__tests__/edith-global.test.ts`
  - `docs/platform/global-cli.md`
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `74` tests passed
  - `node bin/edith.js profile init --repo .` creates `%USERPROFILE%\\.edith\\profiles\\default` (`.env`, `workspace`, `.edith` state dir)
  - sandbox-only smoke with local profile path also validated profile bootstrap logic before global config write (`EPERM` on home write without escalation)

## Follow-up Notes (pass 20)

- Added `edith self-test` (beginner-friendly readiness report) to global wrapper:
  - checks repo/profile bootstrap, profile `.env`, workspace/state dirs
  - checks provider presence + WhatsApp mode readiness
  - checks `pnpm` on PATH and prints reopen-terminal hint for stale PATH (`ENOENT`)
- Added helper tests for self-test parsing/check logic:
  - `src/cli/__tests__/edith-global.test.ts`
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `77` tests passed
  - `node bin/edith.js self-test --repo . --profile .tmp-edith-profile` prints actionable report (sandbox: `EPERM`; escalated run reports `ENOENT` when `pnpm` is not on PATH in that shell)

## Follow-up Notes (pass 21)

- Global `edith` CLI Windows hardening + bug fixes from real end-to-end testing:
  - fixed Windows direct-execution detection for npm shim/symlink/casing edge cases (`edith --help` no longer silently exits)
  - wrapper now uses `pnpm.cmd` on Windows and plain `pnpm` elsewhere
  - wrapper/self-test spawn helpers now enable `shell` only for Windows `.cmd/.bat` commands (fixes false `pnpm` failure in `edith self-test`)
  - `edith profile init --repo ... --profile ...` and `edith init` with overrides no longer force-write `~/.edith/cli.json` (override stays per-command)
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (Windows invoke path, `pnpm.cmd`, shell-for-cmd rule)
- Global CLI flow verified on Windows:
  - `npm install -g .`
  - `edith --help`
  - `edith repo`
  - `edith profile init --repo ... --profile .tmp-edith-profile`
  - `edith self-test --repo ... --profile .tmp-edith-profile` (outside sandbox: `OK pnpm`)
  - `edith doctor --repo ... --profile .tmp-edith-profile`
  - `edith wa scan --repo ... --profile .tmp-edith-profile` starts WhatsApp QR wizard and shows provider prompt (interactive smoke)
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `80` tests passed

## Follow-up Notes (pass 22)

- Improved beginner/non-interactive WhatsApp QR onboarding for EDITH-style global CLI usage:
  - `edith wa scan --yes --provider groq` is now truly non-interactive (skips optional prompts, uses defaults, writes env directly).
  - global wrapper now forwards extra args after `edith wa scan` / `edith wa cloud` to underlying onboarding scripts.
- Fixed onboarding UX mismatch when called from global `edith` wrapper:
  - next-step instructions now suggest `edith doctor` / `edith all` / `edith onboard` when wrapper env is detected.
  - removed duplicated/conflicting `pnpm all` QR step wording in WhatsApp QR next steps.
- Added tests/docs:
  - `src/cli/__tests__/onboard.test.ts` (global-wrapper command hints).
  - `docs/platform/global-cli.md` (scriptable `edith wa scan --yes --provider groq` example).
  - `docs/channels/whatsapp.md` (non-interactive variant + repo vs global wrapper start commands).
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `81` tests passed
  - real command smoke (outside sandbox): `edith wa scan --yes --provider groq --repo ... --profile .tmp-edith-profile` exits 0 and writes WhatsApp QR config without prompts

## Follow-up Notes (pass 23)

- EDITH-alignment tranche 1 + 2 (CLI surface + flag parity):
  - added wrapper command surface parity aliases:
    - `edith setup`, `edith configure`, `edith dashboard`, `edith status`, `edith logs`
  - `edith status` now aliases readiness/self-test flow (EDITH-like status entrypoint)
  - `edith logs` provides a foreground live-log fallback (`all` / `gateway`) and clear guidance when daemon-style log storage is unavailable
  - `edith dashboard` prints dashboard URL (`http://127.0.0.1:<gateway-port>`) then starts gateway foreground mode
- Added global flag parity primitives:
  - `--profile <name>` now maps to `~/.edith/profiles/<name>` (while explicit paths still work)
  - `--dev` uses isolated `~/.edith/profiles/dev` profile
  - `edith quickstart/setup/configure/init` now forward extra onboarding args (e.g. `--non-interactive`, `--provider`, `--channel`)
- Onboarding parser parity:
  - added `--non-interactive` alias for `--yes`
  - accepted `--wizard` as compatibility no-op
  - non-interactive banner now references both `--yes` and `--non-interactive`
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (`--dev`, profile-name mapping, profile selector path/tilde handling)
  - `src/cli/__tests__/onboard.test.ts` (`--non-interactive`, `--wizard` compatibility parse path)
- Documentation updates:
  - `docs/platform/global-cli.md` (command parity, named profiles, `--dev`, scriptable setup examples)
  - `docs/platform/onboarding.md` (`--non-interactive`, global wrapper setup examples)
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `84` tests passed
  - real command smoke:
    - `edith --help`
    - `edith profile --repo ... --profile work` => resolves `~/.edith/profiles/work`
    - `edith --dev profile --repo ...` => resolves `~/.edith/profiles/dev`
    - `edith setup --non-interactive --provider groq --channel whatsapp --whatsapp-mode scan --repo ... --profile .tmp-edith-profile`
    - `edith status --repo ... --profile .tmp-edith-profile`
    - `edith logs foo --repo ... --profile .tmp-edith-profile` (guidance path)

## Follow-up Notes (pass 24)

- EDITH-alignment tranche 3 (channels namespace facade):
  - added `edith channels help|login|status|logs` namespace commands to global wrapper
  - `edith channels login --channel whatsapp` maps to existing WhatsApp setup flow (`wa:scan` by default, `--mode cloud` supported)
  - `edith channels status` currently reuses readiness/self-test (best available status surface today)
  - `edith channels logs` currently reuses live foreground EDITH logs / guidance path (no daemon log store yet)
  - supports positional or flag channel selection (`whatsapp`, `telegram`, `discord`, `webchat`) and login mode normalization (`qr`/`baileys` => `scan`)
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (`parseChannelsArgs`, channel/mode normalization)
- Documentation updates:
  - `docs/platform/global-cli.md` (channels namespace examples and behavior notes)
  - `docs/channels/whatsapp.md` (namespace equivalents for QR login)
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `86` tests passed
  - real command smoke:
    - `edith channels help`
    - `edith channels login --channel whatsapp --non-interactive --provider groq --repo ... --profile .tmp-edith-profile`
    - `edith channels status --channel whatsapp --repo ... --profile .tmp-edith-profile`
    - `edith channels logs foo --repo ... --profile .tmp-edith-profile` (guidance path)

## Follow-up Notes (pass 25)

- EDITH-alignment tranche 4a (readiness polish for global CLI):
  - added `edith self-test --fix` safe fix mode:
    - bootstraps active profile directories
    - creates profile `permissions/permissions.yaml` template if missing
    - backfills baseline profile env keys (`DATABASE_URL`, `PERMISSIONS_FILE`, `DEFAULT_USER_ID`, `LOG_LEVEL`)
    - auto-adds `AUTO_START_GATEWAY=true` when WhatsApp Cloud mode is enabled and missing
  - `edith status --fix` now behaves the same as `edith self-test --fix`
- Improved `edith channels status`:
  - `edith channels status --channel <name>` now prints channel-focused readiness checks for:
    - `whatsapp`
    - `telegram`
    - `discord`
    - `webchat`
  - channel status now exits non-zero when it reports channel errors (matching `edith self-test` exit-code behavior)
- Improved `edith channels logs` UX:
  - clearer note when channel-specific filtering is not implemented yet
  - safer target forwarding (`all`/`gateway`) without duplicating target args
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (`parseSelfTestArgs`, Telegram/Discord/WebChat channel checks)
- Documentation updates:
  - `docs/platform/global-cli.md` (`self-test --fix`, channel-specific status examples)
  - `docs/channels/whatsapp.md` (`self-test --fix`, `channels logs --channel whatsapp`)
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `89` tests passed

## Follow-up Notes (pass 26)

- WhatsApp Baileys QR startup bugfix (runtime regression found from real user log):
  - fixed Baileys auth state wiring in `src/channels/whatsapp.ts`
    - `makeWASocket({ auth })` now receives the raw `state` from `useMultiFileAuthState()`
    - previous code incorrectly passed `{ state, saveCreds }` wrapper as `auth`, causing Baileys `auth.creds` to be `undefined` and crashing with `TypeError` (`creds.me`)
  - added `creds.update` listener to persist auth credential updates via `saveCreds()`
- WhatsApp QR UX hardening for newer Baileys versions:
  - stopped relying on deprecated `printQRInTerminal`
  - now listens for `connection.update.qr` and attempts terminal rendering via optional `qrcode-terminal`
  - falls back to explicit warning + raw QR payload if renderer package is missing
- Added regression test:
  - `src/channels/__tests__/whatsapp.test.ts` verifies Baileys socket auth config preview uses raw auth state (not nested wrapper)
- Documentation update:
  - `docs/channels/whatsapp.md` troubleshooting notes how to install `qrcode-terminal` if QR renderer is missing
- Validation:
  - `pnpm typecheck` passes
  - `pnpm test:ci` => `21` test files passed / `90` tests passed
  - local `edith all` smoke remains blocked in sandbox by `tsx/esbuild spawn EPERM` (environment limitation)

## Follow-up Notes (pass 27)

- EDITH-style CLI focus (first-run entrypoint UX):
  - bare `edith` now acts as a smart entrypoint instead of always printing help
  - if no linked repo exists but command is run inside/near an EDITH repo, wrapper auto-detects and auto-links it
  - if the active profile is not configured (no provider/channel setup), bare `edith` launches the setup wizard automatically (`quickstart`)
  - if profile is already configured, bare `edith` prints concise next actions (`dashboard`, `channels login`, `all`, `status`)
- CLI startup hardening for fresh profiles:
  - `edith all` and `edith gateway` now auto-run profile-scoped `prisma migrate deploy` preflight before starting
  - uses the active profile `DATABASE_URL` so fresh profile DBs do not fail with `P2021` missing-table errors on first run
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (`isProfileEnvLikelyConfigured` helper for smart entrypoint heuristics)
- Documentation updates:
  - `docs/platform/global-cli.md` (bare `edith` smart entrypoint + auto-migrate preflight notes)

## Follow-up Notes (pass 28)

- CLI support/automation parity improvements:
  - added `--json` output mode for:
    - `edith self-test`
    - `edith status`
    - `edith channels status --channel <name>`
  - added `--migrate` option to `edith self-test` / `edith status`
    - runs profile-scoped `prisma migrate deploy` preflight and includes result in output
    - combines cleanly with `--fix` and `--json` (support-friendly repair workflow)
- Channel status behavior:
  - `edith channels status --json` now forwards JSON mode to global self-test when no explicit channel is selected
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (`parseSelfTestArgs` and `parseChannelsArgs` coverage for `--migrate` / `--json`)
- Documentation updates:
  - `docs/platform/global-cli.md` (`--json`, `--migrate`, machine-readable status examples)

## Follow-up Notes (pass 29)

- EDITH-style dashboard-first CLI polish:
  - added `edith dashboard --open` / `--no-open`
  - `--open` best-effort opens the dashboard URL in the default browser, then starts gateway foreground mode
  - `edith dashboard --help` now documents dashboard-specific flags
- Added tests:
  - `src/cli/__tests__/edith-global.test.ts` (`parseDashboardArgs`)
- Documentation updates:
  - `docs/platform/global-cli.md` (`edith dashboard --open` examples)

## Follow-up Notes (pass 30)

- EDITH-style CLI status parity (channel runtime hints):
  - `edith channels status --channel whatsapp` now augments readiness checks with runtime auth-state inspection for Baileys QR mode:
    - auth dir existence / file count
    - `creds.json` presence + parseability
    - paired-session hint via masked WhatsApp JID (without exposing raw account id)
    - machine-readable `runtime` payload in `--json` output
  - Cloud mode status now also reports allowlist posture (`WHATSAPP_CLOUD_ALLOWED_WA_IDS`) in channel status output
- Windows profile `.env` parsing hardening:
  - `parseEnvContentLoose()` now strips UTF-8 BOM at file start / line start (common when users edit with PowerShell `Set-Content` or some editors)
  - prevents false negatives in CLI readiness/status checks (e.g. `WHATSAPP_ENABLED=true` being ignored)
- Help text polish:
  - `edith channels help` now clarifies `channels status --channel ...` is channel-focused status with runtime hints where supported, while bare `channels status` remains global self-test
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (WhatsApp auth-state inspection + creds summary helpers)

## Follow-up Notes (pass 31)

- EDITH-style CLI status parity expanded beyond WhatsApp:
  - `edith channels status --channel telegram` now includes token-format sanity hints + masked preview in runtime JSON (best-effort, no network call)
  - `edith channels status --channel discord` now includes token-format sanity hints + masked preview in runtime JSON (best-effort, no network call)
  - `edith channels status --channel webchat` now probes localhost WebChat port reachability and reports runtime probe results (`reachable`, `latencyMs`, error)
- CLI UX regression guard:
  - added explicit test ensuring global flags like `--repo` / `--profile` still parse correctly after subcommands (EDITH-style muscle memory)
- Added/extended tests:
  - `src/cli/__tests__/edith-global.test.ts` (Telegram/Discord token summaries + local TCP probe helper)

## Follow-up Notes (pass 32)

- EDITH-style `channels logs` parity improvement:
  - `edith channels logs --channel <name>` now runs live foreground logs with best-effort line filtering instead of always falling back to unfiltered global logs
  - supported filters:
    - WhatsApp (`[whatsapp-channel]`, `[channels.whatsapp]`, Baileys JSON `"class":"baileys"`)
    - Telegram (`[channels.telegram]`)
    - Discord (`[channels.discord]`)
    - WebChat (`[webchat-channel]`)
  - fatal process/runtime lines (e.g. `ELIFECYCLE`, `TypeError`, Prisma fatal errors) are still passed through even if they don't match channel tags, to avoid hiding startup failures
- Help/docs polish:
  - `edith channels help` now describes channel-filtered logs behavior
  - `docs/platform/global-cli.md` and `docs/channels/whatsapp.md` updated accordingly
- Added tests:
  - `src/cli/__tests__/edith-global.test.ts` (`lineMatchesChannelLogFilter` coverage for channel tags + fatal passthrough)

## Follow-up Notes (pass 33)

- `channels logs` UX hardening (user-feedback driven):
  - `edith logs` and `edith channels logs --channel <name>` now run profile DB migration preflight before starting foreground logs (same safety behavior as `edith all` / `edith gateway`)
  - reduces noisy first-run Prisma `P2021` missing-table errors when users jump straight into log streaming
  - channel-filtered logs now emit one-time actionable hints for common patterns:
    - Prisma missing-table errors (`P2021`) -> suggest `edith status --fix --migrate`
    - WhatsApp Baileys disconnect `statusCode=405` / connection failures during registration -> suggest clock sync, network check, clearing auth state, retry QR pairing
- Added tests:
  - `src/cli/__tests__/edith-global.test.ts` (`getChannelLogHints` coverage for `P2021` + WhatsApp 405`)
