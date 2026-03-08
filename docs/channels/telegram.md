# Telegram Channel Setup

## Requirements

- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- EDITH running with gateway enabled (`pnpm dev -- --mode all`)

---

## Step 1 — Create a Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts
3. Choose a name and username for the bot
4. Copy the bot token — it looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`

---

## Step 2 — Configure EDITH

Add the token to your `.env` file:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjkl...
```

Optionally restrict to specific chat IDs (comma-separated). Recommended for testing:

```env
TELEGRAM_CHAT_ID=12345678
```

If `TELEGRAM_CHAT_ID` is empty, EDITH responds to private chats only (groups are ignored by default).

---

## Step 3 — Start EDITH

```bash
pnpm dev -- --mode all
```

You should see in the logs:

```
[channels.telegram] Telegram bot polling started
```

---

## Step 4 — Test the Connection

Open your bot in Telegram and send:

- `/start` — EDITH greets you
- `/id` — returns your chat ID (useful for filling `TELEGRAM_CHAT_ID`)
- `/ping` — quick round-trip health check
- Any normal message — goes through the full EDITH pipeline

---

## Supported Features

| Feature | Status |
|---------|--------|
| Text messages | Supported |
| Voice messages (STT) | Supported — transcribed via Whisper |
| Images | Supported — processed via vision pipeline |
| Documents | Partial — text extraction |
| Group chats | Supported — add group chat ID to `TELEGRAM_CHAT_ID` |
| Typing indicator | Supported — shown while EDITH processes |
| HTML formatting | Supported — with auto-fallback to plain text |
| Inline buttons | Planned |

---

## Troubleshooting

**Bot does not respond:**
- Verify the token in `.env` is correct
- Run `pnpm run doctor` to confirm env vars are loaded
- Ensure no other process is polling the same bot token (only one poller per token)

**Group chat ignored:**
- This is the default (private-only)
- Add the group chat ID to `TELEGRAM_CHAT_ID`
- Use `/id` from within the group to get the chat ID

**Message formatting rejected by Telegram:**
- EDITH automatically falls back to plain text when Telegram rejects HTML entities
- Check `[channels.telegram]` logs for details

---

## References

- [Telegram Bot API (official)](https://core.telegram.org/bots/api)
- [EDITH Channel Rate Limiting](../architecture.md)
