# Discord Channel (HP Test MVP)

Date: 2026-02-26

## Why Discord as the next test channel

Discord is practical for phone-based testing after Telegram because:

- mobile app is widely available
- `discord.js` supports local development without a public webhook
- good fit for both DMs and a single private test channel in a guild

## Research-informed defaults (same principles as Telegram)

### 1. Show progress, do not fake latency

Users generally prefer responsive systems; artificial delays hurt experienced users.

Implementation choice:
- no artificial delay
- immediate lightweight feedback (`typing…`) in-channel before EDITH response

### 2. Better repair messages beat vague failures

Repair-focused dialog behavior improves recovery and trust.

Implementation choice:
- clear command-based setup/debug path (`!help`, `!id`, `!ping`)
- explicit error reply when processing fails

### 3. Safe default scope

Bots should not answer across all guild channels by default.

Implementation choice:
- if `DISCORD_CHANNEL_ID` is empty, only DMs are allowed
- guild channels require explicit allowlist in `DISCORD_CHANNEL_ID`

## Implemented behavior

- `discord.js` channel adapter: `src/channels/discord.ts`
- inbound message processing reuses shared runtime path (`hooks`, `usage`, `MemRL`) via:
  - `src/core/incoming-message-service.ts`
- supports both command styles:
  - `!help` / `/help`
  - `!id` / `/id`
  - `!ping` / `/ping`
- per-channel serialized processing to avoid overlapping replies
- outbound sends chunked below Discord message limit

## Environment variables

Required:

- `DISCORD_BOT_TOKEN`

Optional (recommended):

- `DISCORD_CHANNEL_ID`
  - single id or comma/newline-separated ids
  - if empty: adapter responds only in DMs

Examples:

```env
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
DISCORD_CHANNEL_ID=123456789012345678
```

## Quick start (local)

1. Create a Discord bot in the Developer Portal.
2. Enable intents for:
   - `Server Members Intent` not required for this MVP
   - `Message Content Intent` required for text content processing
3. Invite the bot to your server (or just use DMs).
4. Set `.env`:
   - `DISCORD_BOT_TOKEN=...`
   - optional `DISCORD_CHANNEL_ID=...`
5. Run EDITH:
   - `pnpm dev -- --mode all`
6. In Discord mobile/desktop:
   - DM the bot or use your allowlisted channel
   - run `!help`, `!id`, `!ping`
   - send a normal message

## Troubleshooting

- Bot is online but EDITH does not reply:
  - verify `Message Content Intent` is enabled in Discord Developer Portal
  - verify channel is DM or included in `DISCORD_CHANNEL_ID`
- Guild channel ignored:
  - expected when `DISCORD_CHANNEL_ID` is empty (DM-only default)
- `channel_id` confusion:
  - use `!id` in the exact Discord channel you want to allowlist

## References (docs + papers)

- Discord Developer Docs (official): https://discord.com/developers/docs/intro
- discord.js Guide / docs (official project docs): https://discord.js.org/
- Fuehrer & Bittner (2024), response timing and chatbot UX (BISE / Springer): https://link.springer.com/article/10.1007/s12599-024-00992-2
- Galbraith et al. (2024), dialogue repair in popular virtual assistants (Frontiers / PubMed record): https://pubmed.ncbi.nlm.nih.gov/38693812/
- Wang et al. (2024), collaborative repair strategies for conversational AI (IBM Research): https://research.ibm.com/publications/effectiveness-of-collaborative-repair-strategies-in-conversational-ai-communications
