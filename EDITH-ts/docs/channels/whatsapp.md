# WhatsApp Channel (QR Scan + Cloud API)

Date: 2026-02-26

## Which mode should you use?

For a fast test (EDITH-style), use **QR Scan mode** first.

- `WHATSAPP_MODE=baileys` -> scan QR in WhatsApp app (quickest)
- `WHATSAPP_MODE=cloud` -> Meta Cloud API + webhook (official, more setup)

If your goal is "I just want to test from my phone right now", choose **QR Scan**.

## Mode A (recommended for quick test): QR Scan / Baileys

This matches the "tinggal scan" flow you expect from tools like EDITH.

### Environment (QR scan)

```env
WHATSAPP_ENABLED=true
WHATSAPP_MODE=baileys
```

### Quick start (QR scan)

Fastest command (recommended):

```bash
pnpm wa:scan
```

If you installed the global wrapper:

```bash
edith profile init
edith self-test
edith self-test --fix
edith wa scan
```

EDITH-style namespace equivalent:

```bash
edith channels login --channel whatsapp
edith channels status --channel whatsapp
edith channels status --channel whatsapp --json
edith channels logs --channel whatsapp
```

`edith channels status --channel whatsapp` now reports runtime auth/session hints for QR mode (for example: auth dir missing, `creds.json` unreadable, or paired session detected), not just env readiness. The same CLI status command also adds lightweight runtime hints for other channels (for example WebChat localhost reachability and token-format sanity hints for Telegram/Discord).

`edith channels logs --channel whatsapp` now does best-effort live filtering for WhatsApp logs (including Baileys JSON logs) while still passing through fatal process errors. It also runs profile DB migration preflight before starting logs, so fresh profiles are less likely to spam `P2021` table-missing errors.

Non-interactive (scriptable) variant:

```bash
edith wa scan --yes --provider groq
```

Namespace variant:

```bash
edith channels login --channel whatsapp --non-interactive --provider groq
```

This keeps WhatsApp auth/session files under your EDITH profile state dir (for example `~/.edith/profiles/default/.edith/whatsapp-auth`) instead of the repo root.

or use the general wizard:

```bash
pnpm quickstart
```

1. Run EDITH:
   - repo mode: `pnpm all`
   - global wrapper mode: `edith all`
2. Wait for WhatsApp QR code in terminal.
3. On your phone:
   - WhatsApp -> Linked Devices -> Link a Device
   - scan the terminal QR
4. Send:
   - `/help`
   - `/id`
   - `/ping`
   - then a normal message

### QR scan troubleshooting

- QR does not appear:
  - check `WHATSAPP_ENABLED=true`
  - check `WHATSAPP_MODE=baileys`
  - ensure `baileys` dependency is installed
  - if you see `WhatsApp QR payload (renderer missing)`, install a terminal QR renderer:
    - `pnpm add qrcode-terminal`
    - then restart `edith all`
- Connected then disconnects:
  - check logs for `whatsapp-channel`
  - delete local auth cache only if you intentionally want to re-pair (`.edith/whatsapp-auth`)

## Mode B (advanced / official): WhatsApp Cloud API

## Why WhatsApp Cloud API for phone testing

WhatsApp is often the most natural channel for real phone usage. This MVP supports the official Meta WhatsApp Cloud API so you can test without QR pairing or a local device bridge.

Implementation goals:

- official API path (token + phone number id)
- webhook-based inbound messages
- same EDITH pipeline path used by web/Telegram/Discord
- safe defaults with optional sender allowlist

## Research-informed behavior (same first-principles defaults)

### 1. Fast acknowledgment for webhook reliability

Webhook providers retry on slow responses. To reduce duplicate deliveries and timeout loops:

- EDITH webhook ingestion parses messages quickly
- webhook route responds immediately
- message processing continues via serialized async tasks inside the channel adapter
- duplicate `message.id` deliveries are deduped in-memory (best-effort)

### 2. Better repair and debuggability

Instead of opaque failures, the channel provides:

- `/help`, `!help`
- `/id`, `!id`
- `/ping`, `!ping`
- explicit failure reply if EDITH pipeline processing fails

### 3. Optional sender allowlist

By default, Cloud API inbound accepts messages from any sender that can reach the business number.

For safer testing:

- set `WHATSAPP_CLOUD_ALLOWED_WA_IDS`
- use `/id` to capture `wa_id`

## Implemented behavior

- Dual mode support in `src/channels/whatsapp.ts`
  - `WHATSAPP_MODE=baileys` (existing QR/Baileys mode)
  - `WHATSAPP_MODE=cloud` (new official Meta Cloud API mode)
- Cloud API outbound send via Graph API `/{phone-number-id}/messages`
- Gateway webhook routes:
  - `GET /webhooks/whatsapp` (verification)
  - `POST /webhooks/whatsapp` (inbound messages)
- Inbound messages reuse shared processing runtime (`hooks`, `usage tracking`, `MemRL`) through:
  - `src/core/incoming-message-service.ts`
- Per-sender serialized processing (prevents overlapping replies)
- Best-effort duplicate webhook delivery suppression using inbound message ids

## Environment variables (Cloud API mode)

Required:

- `WHATSAPP_ENABLED=true`
- `WHATSAPP_MODE=cloud`
- `WHATSAPP_CLOUD_ACCESS_TOKEN`
- `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
- `WHATSAPP_CLOUD_VERIFY_TOKEN`

Optional:

- `WHATSAPP_CLOUD_ALLOWED_WA_IDS`
  - comma/newline-separated `wa_id` list
  - if empty: any sender is accepted (good for quick testing, less strict)
- `WHATSAPP_CLOUD_API_VERSION`
  - default `v20.0`

Example:

```env
WHATSAPP_ENABLED=true
WHATSAPP_MODE=cloud
WHATSAPP_CLOUD_ACCESS_TOKEN=EAAG...
WHATSAPP_CLOUD_PHONE_NUMBER_ID=123456789012345
WHATSAPP_CLOUD_VERIFY_TOKEN=edith-wh-verify-123
WHATSAPP_CLOUD_ALLOWED_WA_IDS=628123456789
WHATSAPP_CLOUD_API_VERSION=v20.0
AUTO_START_GATEWAY=true
```

## Quick start (local + public webhook)

Fastest command:

```bash
pnpm wa:cloud
```

Global wrapper equivalent:

```bash
edith wa cloud
```

1. Create/configure a Meta app and WhatsApp Cloud API phone number.
2. Set the Cloud API env vars above (`WHATSAPP_MODE=cloud`).
3. Run EDITH with gateway + channels:
   - `pnpm all`
4. Expose the gateway publicly (example):
   - `cloudflared tunnel --url http://127.0.0.1:18789`
   - or `ngrok http 18789`
5. In Meta webhook configuration:
   - Callback URL: `https://<public-host>/webhooks/whatsapp`
   - Verify token: value of `WHATSAPP_CLOUD_VERIFY_TOKEN`
   - Subscribe to message events
6. Message your WhatsApp test number from your phone:
   - `/help`
   - `/id`
   - `/ping`
   - then send a normal message

## Troubleshooting

- Webhook verification fails:
  - check `WHATSAPP_CLOUD_VERIFY_TOKEN`
  - confirm callback path is exactly `/webhooks/whatsapp`
  - ensure gateway is reachable publicly (not only localhost)
- Messages arrive but no EDITH reply:
  - check `WHATSAPP_CLOUD_ACCESS_TOKEN` and `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
  - check logs for `whatsapp-channel` and `gateway`
  - confirm `WHATSAPP_ENABLED=true` and `WHATSAPP_MODE=cloud`
- Number is ignored:
  - if `WHATSAPP_CLOUD_ALLOWED_WA_IDS` is set, make sure sender `wa_id` is included
  - use `/id` from an allowed sender to inspect `wa_id`

## References (official docs + supporting UX research)

- Meta WhatsApp Cloud API (official): https://developers.facebook.com/docs/whatsapp/cloud-api/
- Meta Graph Webhooks (official): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- Fuehrer & Bittner (2024), response timing and chatbot UX (BISE / Springer): https://link.springer.com/article/10.1007/s12599-024-00992-2
- Galbraith et al. (2024), dialogue repair in popular virtual assistants (Frontiers / PubMed record): https://pubmed.ncbi.nlm.nih.gov/38693812/
- Wang et al. (2024), collaborative repair strategies for conversational AI (IBM Research): https://research.ibm.com/publications/effectiveness-of-collaborative-repair-strategies-in-conversational-ai-communications
