# EDITH Global CLI (EDITH-style Wrapper)

Date: 2026-02-26

## Goal

Provide a single command (`edith`) that feels closer to EDITH:

- run from any directory
- support a smart first-run `edith` entrypoint (launch setup when profile isn't configured)
- link your EDITH repo once
- use simple commands like `edith wa scan`
- validate readiness with `edith self-test`
- use EDITH-style aliases like `edith setup`, `edith configure`, `edith status`

This is now a **Phase 2 wrapper** (repo-linked runtime + profile state), not yet a fully repo-independent runtime.

## What it does (Phase 2)

- Stores a linked repo path in `~/.edith/cli.json`
- Stores an active profile under `~/.edith/profiles/default` (config/state/workspace)
- Proxies commands to `pnpm --dir <repo> ...`
- Removes the `pnpm setup` UX trap by exposing beginner-friendly commands:
  - `edith quickstart`
  - `edith setup`
  - `edith configure`
- `edith status`
- `edith dashboard`
- `edith logs`
- `edith channels ...`
  - `edith wa scan`
  - `edith wa cloud`
  - `edith channels status --json`
  - `edith dashboard --open`
- Runs EDITH commands with profile-scoped env variables:
  - `EDITH_ENV_FILE`
  - `EDITH_WORKSPACE`
  - `EDITH_STATE_DIR`

## Install (local machine)

From your repo directory:

```bash
npm install -g C:\Users\test\OneDrive\Desktop\edith\EDITH-ts
edith
```

On first run, `edith` now behaves like an EDITH-style entrypoint:

- if a linked repo/profile is missing, it prints the shortest next step (`edith link ...`)
- if run inside an EDITH repo and no link exists, it auto-detects and auto-links the repo
- if the active profile is not configured yet, it launches the setup wizard automatically
- if configured, it shows the next recommended commands (`dashboard`, `channels login`, `all`, `status`)

Alternative (without global install), you can still run:

```bash
node bin/edith.js
```

## Install (local machine, explicit)

From your repo directory:

```bash
cd C:\Users\test\OneDrive\Desktop\edith\EDITH-ts
npm install -g .
```

## First-time setup

Link the repo once:

```bash
edith link C:\Users\test\OneDrive\Desktop\edith\EDITH-ts
```

Verify:

```bash
edith repo
```

Initialize profile files (recommended once):

```bash
edith profile init
edith self-test
edith self-test --fix
```

Named profile shortcut (EDITH-style):

```bash
edith --profile work profile init
edith --profile work status
```

Or do both and start the wizard in one command:

```bash
edith init
```

## WhatsApp QR test (EDITH-style)

```bash
edith wa scan
edith all
```

Scriptable quick setup (no prompts, uses defaults + QR mode):

```bash
edith wa scan --yes --provider groq
edith all
```

EDITH-style channels namespace (same result, more parity):

```bash
edith channels login --channel whatsapp --non-interactive --provider groq
edith channels status --channel whatsapp
edith channels status --channel telegram
edith all
```

Dev sandbox profile (isolated state):

```bash
edith --dev setup --non-interactive --channel whatsapp --whatsapp-mode scan --provider groq
edith --dev all
```

Then scan QR from your phone:

- WhatsApp -> Linked Devices -> Link a Device
- scan the QR shown in terminal

## Useful commands

```bash
edith quickstart
edith setup
edith configure
edith
edith status
edith dashboard
edith dashboard --open
edith logs gateway
edith channels help
edith channels login --channel whatsapp
edith channels status --channel whatsapp
edith channels status --channel whatsapp --json
edith channels status --channel telegram
edith channels status --channel discord
edith channels status --channel webchat
edith self-test
edith self-test --fix
edith self-test --fix --migrate
edith self-test --json
edith doctor
edith gateway
edith wa scan
edith wa cloud
edith onboard -- --channel telegram --provider groq
```

`edith self-test` is the recommended first troubleshooting step. It checks:

- repo link + profile directories
- profile `.env` existence
- provider/WhatsApp mode basics
- `pnpm` availability on PATH (with a hint to reopen terminal if PATH is stale)

`edith self-test --fix` applies safe local fixes to the active profile:

- bootstraps profile directories if missing
- creates `permissions/permissions.yaml` template if missing
- adds baseline env keys (database path, permissions file path, default user, log level)
- enables `AUTO_START_GATEWAY=true` for WhatsApp Cloud mode if it is enabled but unset

`edith self-test --migrate` runs a profile-scoped `prisma migrate deploy` preflight (same mechanism used by `edith all` / `edith gateway`) and reports the result.

`edith self-test --json` and `edith channels status --channel <name> --json` print machine-readable status output for scripting/support tooling. Channel JSON now includes a `runtime` snapshot where available (for example WhatsApp auth/session hints and WebChat localhost reachability probe).

`edith all` and `edith gateway` now auto-run a profile-scoped `prisma migrate deploy` preflight (using your profile `DATABASE_URL`) before starting EDITH, which prevents first-run `P2021` table-missing errors on fresh profiles.

`edith logs` and `edith channels logs --channel <name>` now run the same profile DB migration preflight before starting foreground logs, reducing noisy first-run `P2021` errors in log streams.

`edith dashboard --open` tries to open the dashboard URL in your default browser (best effort) and then starts gateway foreground mode.

`--repo` and `--profile` are one-shot overrides for the current command. They do not rewrite your saved default link/profile unless you run `edith link`.

`--profile <name>` maps to `~/.edith/profiles/<name>`. Use a path (e.g. `--profile .tmp-profile`) if you want an explicit directory.

`--dev` is a shortcut for using the isolated `dev` profile (`~/.edith/profiles/dev`).

`edith channels ...` is an EDITH-style namespace facade:
- `channels login --channel whatsapp` -> EDITH WhatsApp QR/Cloud setup flow
- `channels status --channel <name>` -> channel-focused readiness checks + runtime hints (WhatsApp auth/session, Telegram/Discord token sanity, WebChat localhost reachability)
- `channels status` -> EDITH global readiness/self-test
- `channels logs --channel <name>` -> best-effort filtered live logs (channel tags + fatal passthrough)
- `channels logs` -> EDITH live foreground logs

## Current limitations (important)

Phase 2 is still **repo-backed**:

- Code still runs from the linked repo checkout
- Some subsystems may still rely on repo-relative defaults if not overridden in profile env
- The wrapper shells out to `pnpm` (not a bundled runtime yet)
- `pnpm` must be available on your machine PATH

## Next phase (planned)

To match EDITH more closely, the next step is:

- remove remaining repo-relative runtime defaults and move all state to profile by default
- support `edith init` without needing a linked repo checkout (template download/init flow)
- bundle/run without shelling out to `pnpm`
