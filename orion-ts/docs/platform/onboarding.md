# Orion Onboarding (OpenClaw-inspired)

Date: 2026-02-26

## Goal

Provide a fast local onboarding flow similar to OpenClaw's "setup + onboard" experience:

- guided quickstart command
- channel-first setup (Telegram / Discord / WhatsApp Cloud API / WebChat)
- provider selection (Groq, OpenRouter, Anthropic, OpenAI, Gemini, Ollama)
- explicit next steps for phone testing

## Commands

```bash
pnpm quickstart
```

Alias for:

```bash
pnpm onboard
```

Compatibility note:

- `pnpm setup` can collide with pnpm's built-in `setup` command.
- Use `pnpm quickstart` (recommended) or `pnpm run setup`.

Optional flags:

```bash
pnpm onboard -- --channel telegram --provider groq
pnpm onboard -- --channel discord --provider openrouter
pnpm onboard -- --channel whatsapp --whatsapp-mode scan --provider openrouter
pnpm onboard -- --print-only
pnpm onboard -- --yes
pnpm onboard -- --non-interactive
```

Beginner shortcuts:

```bash
pnpm wa:scan
pnpm wa:cloud
```

OpenClaw-style global wrapper (Phase 2):

```bash
orion link <path-to-orion-ts>
orion profile init
orion self-test
orion wa scan
```

OpenClaw-style scriptable variant (no prompts):

```bash
orion setup --non-interactive --channel whatsapp --whatsapp-mode scan --provider groq
```

See:

- `docs/platform/global-cli.md`

## What the wizard does

1. Chooses a first test channel (`telegram`, `discord`, `whatsapp`, or `webchat`).
2. Chooses a primary model provider.
3. Collects minimal required env values.
   - For WhatsApp, the wizard asks whether you want `Scan QR (Baileys)` or `Cloud API`.
4. Writes `.env` (preserving comments and existing keys where possible).
5. Prints channel-specific next steps and docs references.

## Run modes (quick shortcuts)

```bash
pnpm all
pnpm gateway
pnpm gateway:watch
```

## Notes

- The wizard writes `.env` in the repo root (`orion-ts/.env`).
- When launched via global `orion` wrapper, the wizard writes the active profile env file (`~/.orion/profiles/<name>/.env` or your explicit `--profile` path).
- Channel adapters are safe-by-default:
  - Telegram: private chat only if `TELEGRAM_CHAT_ID` is unset
  - Discord: DM only if `DISCORD_CHANNEL_ID` is unset
  - WhatsApp Cloud API: accepts inbound senders by default, but supports `WHATSAPP_CLOUD_ALLOWED_WA_IDS` allowlist for stricter testing
- For production rollout, continue using `pnpm doctor`, migrations, and dedupe checks as documented in `docs/operations/maintenance-hardening-log-2026-02-25.md`.

## Related docs

- `docs/channels/telegram.md`
- `docs/channels/discord.md`
- `docs/channels/whatsapp.md`
- `docs/platform/global-cli.md`
- `docs/platform/doctor.md`
