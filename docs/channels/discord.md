# Discord Channel Setup

## Requirements

- A Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- A Discord server (guild) where you have admin rights, OR use DMs with the bot
- EDITH running with gateway enabled

---

## Step 1 — Create a Discord Application and Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Go to the **Bot** section in the left sidebar
4. Click **Add Bot**
5. Under **Token**, click **Copy** (you'll need this for `.env`)

---

## Step 2 — Enable Required Intents

In the Bot section of the Developer Portal, scroll down to **Privileged Gateway Intents** and enable:

- **Message Content Intent** — required to read message text
- **Server Members Intent** — optional, only if you need member info

---

## Step 3 — Invite the Bot to Your Server

1. Go to **OAuth2 > URL Generator** in the Developer Portal
2. Under **Scopes**, select `bot`
3. Under **Bot Permissions**, select:
   - `Read Messages/View Channels`
   - `Send Messages`
   - `Read Message History`
4. Copy the generated URL and open it in a browser to invite the bot

---

## Step 4 — Configure EDITH

Add to your `.env`:

```env
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
```

Optionally restrict to specific channel IDs (comma-separated). If empty, EDITH responds to DMs only:

```env
DISCORD_CHANNEL_ID=123456789012345678
```

---

## Step 5 — Start EDITH

```bash
pnpm dev -- --mode all
```

You should see:

```
[channels.discord] Discord bot connected as YourBotName#1234
```

---

## Step 6 — Test the Connection

In Discord (DM the bot or use your allowlisted channel):

- `!help` or `/help` — lists available commands
- `!id` or `/id` — returns the current channel/DM ID
- `!ping` or `/ping` — round-trip health check
- Any normal message — processed by the full EDITH pipeline

---

## Supported Features

| Feature | Status |
|---------|--------|
| Text messages | Supported |
| DMs | Supported — DM-only by default |
| Guild channels | Supported — requires `DISCORD_CHANNEL_ID` |
| Images | Supported — processed via vision pipeline |
| Voice messages | Partial — STT if attachment type is audio |
| Typing indicator | Supported — shown while processing |
| Message chunking | Supported — splits responses at Discord's 2000-char limit |
| Slash commands | Planned |

---

## Troubleshooting

**Bot is online but EDITH does not reply:**
- Verify `Message Content Intent` is enabled in the Developer Portal
- Verify the channel is a DM or is listed in `DISCORD_CHANNEL_ID`
- Check `[channels.discord]` logs

**Guild channel ignored:**
- This is the default when `DISCORD_CHANNEL_ID` is empty
- Add the channel ID to `DISCORD_CHANNEL_ID`
- Use `!id` in the exact channel to get the ID

**Invalid token error:**
- Regenerate the token in the Developer Portal and update `.env`
- Never commit your bot token — it is a secret

---

## References

- [Discord Developer Portal](https://discord.com/developers/applications)
- [discord.js Documentation](https://discord.js.org/)
- [EDITH Channel Architecture](../architecture.md)
