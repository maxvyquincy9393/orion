# Orion Global CLI (OpenClaw-style Wrapper)

Date: 2026-02-26

## Goal

Provide a single command (`orion`) that feels closer to OpenClaw:

- run from any directory
- support a smart first-run `orion` entrypoint (launch setup when profile isn't configured)
- link your Orion repo once
- use simple commands like `orion wa scan`
- validate readiness with `orion self-test`
- use OpenClaw-style aliases like `orion setup`, `orion configure`, `orion status`

This is now a **Phase 2 wrapper** (repo-linked runtime + profile state), not yet a fully repo-independent runtime.

## What it does (Phase 2)

- Stores a linked repo path in `~/.orion/cli.json`
- Stores an active profile under `~/.orion/profiles/default` (config/state/workspace)
- Proxies commands to `pnpm --dir <repo> ...`
- Removes the `pnpm setup` UX trap by exposing beginner-friendly commands:
  - `orion quickstart`
  - `orion setup`
  - `orion configure`
- `orion status`
- `orion dashboard`
- `orion logs`
- `orion channels ...`
  - `orion wa scan`
  - `orion wa cloud`
  - `orion channels status --json`
  - `orion dashboard --open`
- Runs Orion commands with profile-scoped env variables:
  - `ORION_ENV_FILE`
  - `ORION_WORKSPACE`
  - `ORION_STATE_DIR`

## Install (local machine)

From your repo directory:

```bash
npm install -g C:\Users\test\OneDrive\Desktop\orion\orion-ts
orion
```

On first run, `orion` now behaves like an OpenClaw-style entrypoint:

- if a linked repo/profile is missing, it prints the shortest next step (`orion link ...`)
- if run inside an Orion repo and no link exists, it auto-detects and auto-links the repo
- if the active profile is not configured yet, it launches the setup wizard automatically
- if configured, it shows the next recommended commands (`dashboard`, `channels login`, `all`, `status`)

Alternative (without global install), you can still run:

```bash
node bin/orion.js
```

## Install (local machine, explicit)

From your repo directory:

```bash
cd C:\Users\test\OneDrive\Desktop\orion\orion-ts
npm install -g .
```

## First-time setup

Link the repo once:

```bash
orion link C:\Users\test\OneDrive\Desktop\orion\orion-ts
```

Verify:

```bash
orion repo
```

Initialize profile files (recommended once):

```bash
orion profile init
orion self-test
orion self-test --fix
```

Named profile shortcut (OpenClaw-style):

```bash
orion --profile work profile init
orion --profile work status
```

Or do both and start the wizard in one command:

```bash
orion init
```

## WhatsApp QR test (OpenClaw-style)

```bash
orion wa scan
orion all
```

Scriptable quick setup (no prompts, uses defaults + QR mode):

```bash
orion wa scan --yes --provider groq
orion all
```

OpenClaw-style channels namespace (same result, more parity):

```bash
orion channels login --channel whatsapp --non-interactive --provider groq
orion channels status --channel whatsapp
orion channels status --channel telegram
orion all
```

Dev sandbox profile (isolated state):

```bash
orion --dev setup --non-interactive --channel whatsapp --whatsapp-mode scan --provider groq
orion --dev all
```

Then scan QR from your phone:

- WhatsApp -> Linked Devices -> Link a Device
- scan the QR shown in terminal

## Useful commands

```bash
orion quickstart
orion setup
orion configure
orion
orion status
orion dashboard
orion dashboard --open
orion logs gateway
orion channels help
orion channels login --channel whatsapp
orion channels status --channel whatsapp
orion channels status --channel whatsapp --json
orion channels status --channel telegram
orion channels status --channel discord
orion channels status --channel webchat
orion self-test
orion self-test --fix
orion self-test --fix --migrate
orion self-test --json
orion doctor
orion gateway
orion wa scan
orion wa cloud
orion onboard -- --channel telegram --provider groq
```

`orion self-test` is the recommended first troubleshooting step. It checks:

- repo link + profile directories
- profile `.env` existence
- provider/WhatsApp mode basics
- `pnpm` availability on PATH (with a hint to reopen terminal if PATH is stale)

`orion self-test --fix` applies safe local fixes to the active profile:

- bootstraps profile directories if missing
- creates `permissions/permissions.yaml` template if missing
- adds baseline env keys (database path, permissions file path, default user, log level)
- enables `AUTO_START_GATEWAY=true` for WhatsApp Cloud mode if it is enabled but unset

`orion self-test --migrate` runs a profile-scoped `prisma migrate deploy` preflight (same mechanism used by `orion all` / `orion gateway`) and reports the result.

`orion self-test --json` and `orion channels status --channel <name> --json` print machine-readable status output for scripting/support tooling. Channel JSON now includes a `runtime` snapshot where available (for example WhatsApp auth/session hints and WebChat localhost reachability probe).

`orion all` and `orion gateway` now auto-run a profile-scoped `prisma migrate deploy` preflight (using your profile `DATABASE_URL`) before starting Orion, which prevents first-run `P2021` table-missing errors on fresh profiles.

`orion dashboard --open` tries to open the dashboard URL in your default browser (best effort) and then starts gateway foreground mode.

`--repo` and `--profile` are one-shot overrides for the current command. They do not rewrite your saved default link/profile unless you run `orion link`.

`--profile <name>` maps to `~/.orion/profiles/<name>`. Use a path (e.g. `--profile .tmp-profile`) if you want an explicit directory.

`--dev` is a shortcut for using the isolated `dev` profile (`~/.orion/profiles/dev`).

`orion channels ...` is an OpenClaw-style namespace facade:
- `channels login --channel whatsapp` -> Orion WhatsApp QR/Cloud setup flow
- `channels status --channel <name>` -> channel-focused readiness checks + runtime hints (WhatsApp auth/session, Telegram/Discord token sanity, WebChat localhost reachability)
- `channels status` -> Orion global readiness/self-test
- `channels logs` -> Orion live foreground logs today

## Current limitations (important)

Phase 2 is still **repo-backed**:

- Code still runs from the linked repo checkout
- Some subsystems may still rely on repo-relative defaults if not overridden in profile env
- The wrapper shells out to `pnpm` (not a bundled runtime yet)
- `pnpm` must be available on your machine PATH

## Next phase (planned)

To match OpenClaw more closely, the next step is:

- remove remaining repo-relative runtime defaults and move all state to profile by default
- support `orion init` without needing a linked repo checkout (template download/init flow)
- bundle/run without shelling out to `pnpm`
