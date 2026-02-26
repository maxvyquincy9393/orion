# Orion Global CLI (OpenClaw-style Wrapper)

Date: 2026-02-26

## Goal

Provide a single command (`orion`) that feels closer to OpenClaw:

- run from any directory
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
  - `orion wa scan`
  - `orion wa cloud`
- Runs Orion commands with profile-scoped env variables:
  - `ORION_ENV_FILE`
  - `ORION_WORKSPACE`
  - `ORION_STATE_DIR`

## Install (local machine)

From your repo directory:

```bash
cd C:\Users\test\OneDrive\Desktop\orion\orion-ts
npm install -g .
```

Alternative (without global install), you can still run:

```bash
node bin/orion.js --help
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
orion status
orion dashboard
orion logs gateway
orion self-test
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

`--repo` and `--profile` are one-shot overrides for the current command. They do not rewrite your saved default link/profile unless you run `orion link`.

`--profile <name>` maps to `~/.orion/profiles/<name>`. Use a path (e.g. `--profile .tmp-profile`) if you want an explicit directory.

`--dev` is a shortcut for using the isolated `dev` profile (`~/.orion/profiles/dev`).

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
