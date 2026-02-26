# Telegram Channel (HP Test MVP)

Date: 2026-02-26

## Why Telegram first (for quick testing)

Telegram is the fastest path to test Orion from a phone with minimal infra:

- no custom mobile app needed
- official Bot API supports long polling (`getUpdates`) for local/dev testing
- supports typing indicator and rich text (`sendChatAction`, `sendMessage` with `parse_mode`)

## Research-informed design choices (first-principles)

This MVP is intentionally shaped by conversational-agent research, not only API convenience.

### 1. No fake delay, but show progress

Research on chatbot response timing shows shorter response times are generally preferred by experienced users, and fixed delays can reduce the experience for many users.

Implementation choice:
- no artificial delay added
- send Telegram `typing` action while Orion is processing

### 2. Better repair than generic failure

Dialogue repair research shows users recover better when the system provides clearer, actionable responses (instead of repeating generic fallback behavior).

Implementation choice:
- explicit error reply on pipeline failures (`try shorter / retry`)
- `/help`, `/id`, `/ping` commands for discoverability and debugging
- safer defaults for unauthorized chats with a clear setup hint

### 3. Safer default channel scope for first test

Messaging bots can accidentally respond in group chats if not constrained.

Implementation choice:
- default Telegram behavior is **private chats only**
- allow group or specific chats by setting `TELEGRAM_CHAT_ID` allowlist

## Implemented behavior

- Long polling via Telegram Bot API (`getUpdates`)
- Webhook disabled on startup (`deleteWebhook`) so local polling works
- Inbound Telegram text messages go through the same Orion incoming-message pipeline path used by gateway (hooks + usage tracking + MemRL follow-up)
- Outbound messages use Telegram HTML parse mode
- Telegram formatting hardening:
  - raw HTML (`<`, `>`, `&`) is escaped before sending
  - fallback to plain text if Telegram rejects entity parsing
- Per-chat serialized processing (prevents overlapping responses in the same chat)

## Environment variables

Required:

- `TELEGRAM_BOT_TOKEN`

Optional (recommended for safe testing):

- `TELEGRAM_CHAT_ID`
  - single chat id or comma/newline-separated list
  - if empty: only private chats are allowed by default

Examples:

```env
TELEGRAM_BOT_TOKEN=123456:abcDEF...
TELEGRAM_CHAT_ID=123456789
```

## Quick start (local)

1. Create a bot with `@BotFather` and get the token.
2. Set `TELEGRAM_BOT_TOKEN` in `.env`.
3. Start Orion in gateway/all mode (channel manager initializes Telegram):
   - `pnpm dev -- --mode all`
4. DM your bot on Telegram:
   - `/start`
   - `/id` (copy this into `TELEGRAM_CHAT_ID` if you want allowlist)
   - send a normal message

## Troubleshooting

- Bot does not respond:
  - confirm `TELEGRAM_BOT_TOKEN` is valid
  - ensure no webhook is actively bound to the bot (startup calls `deleteWebhook`)
  - check logs for `channels.telegram`
- Group chat ignored:
  - expected by default (private-only)
  - add group chat id to `TELEGRAM_CHAT_ID`
- Message send fails with formatting issue:
  - channel retries plain text automatically after Telegram entity parse errors

## References (docs + papers)

- Telegram Bot API (official): https://core.telegram.org/bots/api
- Fuehrer & Bittner (2024), response timing and chatbot UX (BISE / Springer): https://link.springer.com/article/10.1007/s12599-024-00992-2
- Galbraith et al. (2024), dialogue repair in popular virtual assistants (Frontiers / PubMed record): https://pubmed.ncbi.nlm.nih.gov/38693812/
- Wang et al. (2024), collaborative repair strategies for conversational AI (IBM Research): https://research.ibm.com/publications/effectiveness-of-collaborative-repair-strategies-in-conversational-ai-communications
