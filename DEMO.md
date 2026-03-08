# EDITH Demo Guide - 5 Minute Setup

This guide will get EDITH running in 5 minutes with minimal configuration.

## Prerequisites

- **Node.js 18+** (check: `node --version`)
- **pnpm** (install: `npm install -g pnpm`)
- An **API key** from one of these FREE providers:
  - [Groq](https://console.groq.com) (recommended - fastest free tier)
  - [Google AI Studio](https://makersuite.google.com/app/apikey) (Gemini)
  - [Ollama](https://ollama.ai) (local - no API key needed)

## Quick Start

### Step 1: Install Dependencies

```bash
pnpm install
```

### Step 2: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env and add ONE of these:
# GROQ_API_KEY=gsk_...           # Recommended (free, fast)
# GEMINI_API_KEY=...             # Alternative (free)
# OLLAMA_BASE_URL=http://localhost:11434  # Local (if you have Ollama running)
```

**Minimal `.env` for demo** (edit the file):
```env
# === Provider (choose ONE) ===
GROQ_API_KEY=your_groq_key_here

# === Database (default: SQLite) ===
DATABASE_URL=file:./workspace/.edith/edith.db

# === Mode ===
DEFAULT_USER_ID=demo-user
```

### Step 3: Initialize Database

```bash
pnpm db:push
```

### Step 4: Run EDITH

Choose your preferred mode:

#### Option A: CLI Mode (Text Chat)

```bash
pnpm dev --mode text
```

You'll get an interactive CLI where you can chat with EDITH:
```
You: Hello EDITH
EDITH: Hello! I'm EDITH, your personal AI companion. How can I help you today?
```

#### Option B: WebChat UI

```bash
pnpm dev --mode all
```

Then open your browser to: **http://127.0.0.1:8080**

You'll see a web interface where you can chat with EDITH.

#### Option C: Telegram (requires bot token)

1. Get a Telegram bot token from [@BotFather](https://t.me/botfather)
2. Add to `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_ENABLED=true
   ```
3. Run:
   ```bash
   pnpm dev --mode all
   ```
4. Message your bot on Telegram!

---

## What Can EDITH Do?

Try these commands after starting:

### Basic Conversation
```
You: What can you do?
You: Tell me a joke
You: What's 1234 * 5678?
```

### Memory System
```
You: Remember that my favorite color is blue
You: What's my favorite color?
```

### File Operations (in workspace/)
```
You: Create a file called hello.txt with "Hello World"
You: Read hello.txt
You: List files in workspace/
```

### Code Execution
```
You: Run this Python code: print(sum(range(1, 101)))
You: Calculate the factorial of 10
```

### Web Browsing
```
You: Search the web for latest AI news
You: Visit https://example.com and summarize the page
```

---

## Troubleshooting

### "No API key configured"
- Make sure you set ONE of: `GROQ_API_KEY`, `GEMINI_API_KEY`, or `OLLAMA_BASE_URL`
- Check that `.env` file is in the root directory

### "Database schema out of sync"
```bash
pnpm db:push
```

### "Port 8080 already in use"
Change the port in `.env`:
```env
WEBCHAT_PORT=3000
```

### "Permission denied" errors
EDITH uses a permissions system. By default, most operations are allowed in demo mode.
To adjust permissions, see `permissions/capabilities.yaml`

---

## Advanced Configuration

### Enable Multiple Channels

Edit `.env` to enable more channels:

```env
# === Channels ===
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your_token

DISCORD_ENABLED=true
DISCORD_BOT_TOKEN=your_token

WEBCHAT_ENABLED=true
WEBCHAT_PORT=8080

# WhatsApp (QR code mode - no API key needed)
WHATSAPP_ENABLED=true
WHATSAPP_MODE=scan
```

### Change LLM Provider

EDITH supports multiple LLM providers. Edit `.env`:

```env
# === Provider Preferences ===
# Priority order for LLM selection
LLM_PROVIDER_PRIORITY=groq,gemini,openai,anthropic,ollama

# Or force a specific provider:
# LLM_PROVIDER_PRIORITY=anthropic
# ANTHROPIC_API_KEY=sk-ant-...
```

### Enable Voice Mode

```env
# === Voice (Phase 1) ===
VOICE_ENABLED=true
VOICE_PROVIDER=groq  # or openai
VOICE_STT_MODEL=whisper-large-v3
VOICE_TTS_PROVIDER=cartesia
```

### Enable Calendar Integration

```env
# === Calendar (Phase 8) ===
GOOGLE_CALENDAR_ENABLED=true
GOOGLE_CALENDAR_CLIENT_ID=your_client_id
GOOGLE_CALENDAR_CLIENT_SECRET=your_client_secret
```

### Enable Email Monitoring

```env
# === Email (Phase 8) ===
GMAIL_ENABLED=true
GMAIL_USER_EMAIL=your_email@gmail.com
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
GMAIL_REFRESH_TOKEN=your_refresh_token
```

---

## Next Steps

1. **Read the docs**: Check out `docs/architecture.md` for system overview
2. **Customize persona**: Edit `workspace/SOUL.md` to change EDITH's personality
3. **Add skills**: Create custom skills in `src/skills/`
4. **Setup channels**: Follow guides in `docs/channels/` for Telegram, Discord, etc.
5. **Run tests**: `pnpm test` to verify everything works

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm dev --mode text` | CLI text chat mode |
| `pnpm dev --mode all` | All channels (WebChat + enabled channels) |
| `pnpm dev --mode voice` | Voice mode (requires voice config) |
| `pnpm test` | Run test suite |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm db:push` | Update database schema |
| `pnpm onboard` | Interactive setup wizard |

---

## Demo Scenarios

### Scenario 1: Personal Assistant

```bash
pnpm dev --mode text
```

Then try:
```
You: Set a reminder to call mom at 3pm
You: What's on my calendar today?
You: Create a note about the team meeting
```

### Scenario 2: Developer Assistant

```
You: Read src/main.ts and explain what it does
You: Find all TODO comments in the codebase
You: Run the test suite
```

### Scenario 3: Research Assistant

```
You: Search the web for "best practices for vector databases 2026"
You: Summarize the top 3 results
You: Save the summary to workspace/research-notes.md
```

---

## Need Help?

- **Documentation**: `docs/` folder
- **Issues**: Open an issue on GitHub
- **Architecture**: Read `docs/architecture.md`
- **Security**: Check `docs/security/` for security features

---

**Enjoy using EDITH! 🚀**
