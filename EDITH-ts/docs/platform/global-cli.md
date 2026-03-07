# Nova Global CLI (OpenClaw-style Wrapper)

Date: 2026-02-26

## Goal

Provide a single command (`nova`) that feels closer to OpenClaw:

- run from any directory
- support a smart first-run `nova` entrypoint (launch setup when profile isn't configured)
- link your Nova repo once
- use simple commands like `nova wa scan`
- validate readiness with `nova self-test`
- use OpenClaw-style aliases like `nova setup`, `nova configure`, `nova status`

This is now a **Phase 2 wrapper** (repo-linked runtime + profile state), not yet a fully repo-independent runtime.

## What it does (Phase 2)

- Stores a linked repo path in `~/.nova/cli.json`
- Stores an active profile under `~/.nova/profiles/default` (config/state/workspace)
- Proxies commands to `pnpm --dir <repo> ...`
- Removes the `pnpm setup` UX trap by exposing beginner-friendly commands:
  - `nova quickstart`
  - `nova setup`
  - `nova configure`
- `nova status`
- `nova dashboard`
- `nova logs`
- `nova channels ...`
  - `nova wa scan`
  - `nova wa cloud`
  - `nova channels status --json`
  - `nova dashboard --open`
- Runs Nova commands with profile-scoped env variables:
  - `NOVA_ENV_FILE`
  - `NOVA_WORKSPACE`
  - `NOVA_STATE_DIR`

## Install (local machine)

From your repo directory:

```bash
npm install -g C:\Users\test\OneDrive\Desktop\nova\nova-ts
nova
```

On first run, `nova` now behaves like an OpenClaw-style entrypoint:

- if a linked repo/profile is missing, it prints the shortest next step (`nova link ...`)
- if run inside an Nova repo and no link exists, it auto-detects and auto-links the repo
- if the active profile is not configured yet, it launches the setup wizard automatically
- if configured, it shows the next recommended commands (`dashboard`, `channels login`, `all`, `status`)

Alternative (without global install), you can still run:

```bash
node bin/nova.js
```

## Install (local machine, explicit)

From your repo directory:

```bash
cd C:\Users\test\OneDrive\Desktop\nova\nova-ts
npm install -g .
```

## First-time setup

Link the repo once:

```bash
nova link C:\Users\test\OneDrive\Desktop\nova\nova-ts
```

Verify:

```bash
nova repo
```

Initialize profile files (recommended once):

```bash
nova profile init
nova self-test
nova self-test --fix
```

Named profile shortcut (OpenClaw-style):

```bash
nova --profile work profile init
nova --profile work status
```

Or do both and start the wizard in one command:

```bash
nova init
```

## WhatsApp QR test (OpenClaw-style)

```bash
nova wa scan
nova all
```

Scriptable quick setup (no prompts, uses defaults + QR mode):

```bash
nova wa scan --yes --provider groq
nova all
```

OpenClaw-style channels namespace (same result, more parity):

```bash
nova channels login --channel whatsapp --non-interactive --provider groq
nova channels status --channel whatsapp
nova channels status --channel telegram
nova all
```

Dev sandbox profile (isolated state):

```bash
nova --dev setup --non-interactive --channel whatsapp --whatsapp-mode scan --provider groq
nova --dev all
```

Then scan QR from your phone:

- WhatsApp -> Linked Devices -> Link a Device
- scan the QR shown in terminal

## Useful commands

```bash
nova quickstart
nova setup
nova configure
nova
nova status
nova dashboard
nova dashboard --open
nova logs gateway
nova channels help
nova channels login --channel whatsapp
nova channels status --channel whatsapp
nova channels status --channel whatsapp --json
nova channels status --channel telegram
nova channels status --channel discord
nova channels status --channel webchat
nova self-test
nova self-test --fix
nova self-test --fix --migrate
nova self-test --json
nova doctor
nova gateway
nova wa scan
nova wa cloud
nova onboard -- --channel telegram --provider groq
```

`nova self-test` is the recommended first troubleshooting step. It checks:

- repo link + profile directories
- profile `.env` existence
- provider/WhatsApp mode basics
- `pnpm` availability on PATH (with a hint to reopen terminal if PATH is stale)

`nova self-test --fix` applies safe local fixes to the active profile:

- bootstraps profile directories if missing
- creates `permissions/permissions.yaml` template if missing
- adds baseline env keys (database path, permissions file path, default user, log level)
- enables `AUTO_START_GATEWAY=true` for WhatsApp Cloud mode if it is enabled but unset

`nova self-test --migrate` runs a profile-scoped `prisma migrate deploy` preflight (same mechanism used by `nova all` / `nova gateway`) and reports the result.

`nova self-test --json` and `nova channels status --channel <name> --json` print machine-readable status output for scripting/support tooling. Channel JSON now includes a `runtime` snapshot where available (for example WhatsApp auth/session hints and WebChat localhost reachability probe).

`nova all` and `nova gateway` now auto-run a profile-scoped `prisma migrate deploy` preflight (using your profile `DATABASE_URL`) before starting Nova, which prevents first-run `P2021` table-missing errors on fresh profiles.

`nova logs` and `nova channels logs --channel <name>` now run the same profile DB migration preflight before starting foreground logs, reducing noisy first-run `P2021` errors in log streams.

`nova dashboard --open` tries to open the dashboard URL in your default browser (best effort) and then starts gateway foreground mode.

`--repo` and `--profile` are one-shot overrides for the current command. They do not rewrite your saved default link/profile unless you run `nova link`.

`--profile <name>` maps to `~/.nova/profiles/<name>`. Use a path (e.g. `--profile .tmp-profile`) if you want an explicit directory.

`--dev` is a shortcut for using the isolated `dev` profile (`~/.nova/profiles/dev`).

`nova channels ...` is an OpenClaw-style namespace facade:
- `channels login --channel whatsapp` -> Nova WhatsApp QR/Cloud setup flow
- `channels status --channel <name>` -> channel-focused readiness checks + runtime hints (WhatsApp auth/session, Telegram/Discord token sanity, WebChat localhost reachability)
- `channels status` -> Nova global readiness/self-test
- `channels logs --channel <name>` -> best-effort filtered live logs (channel tags + fatal passthrough)
- `channels logs` -> Nova live foreground logs

## Current limitations (important)

Phase 2 is still **repo-backed**:

- Code still runs from the linked repo checkout
- Some subsystems may still rely on repo-relative defaults if not overridden in profile env
- The wrapper shells out to `pnpm` (not a bundled runtime yet)
- `pnpm` must be available on your machine PATH

## Next phase (planned)

To match OpenClaw more closely, the next step is:

- remove remaining repo-relative runtime defaults and move all state to profile by default
- support `nova init` without needing a linked repo checkout (template download/init flow)
- bundle/run without shelling out to `pnpm`
