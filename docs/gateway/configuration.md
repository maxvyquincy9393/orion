# Gateway Configuration Reference

The EDITH gateway is a Fastify HTTP/WebSocket server that handles all inbound and outbound channel traffic, REST API calls, and metrics.

---

## Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `18789` | HTTP port the gateway listens on |
| `HOST` | `127.0.0.1` | Bind address — use `0.0.0.0` to expose to the network |
| `NODE_ENV` | `development` | Environment (`development` / `production`) |
| `DATABASE_URL` | `file:./prisma/edith.db` | SQLite database path (Prisma) |
| `LOG_LEVEL` | `info` | Log verbosity: `debug` / `info` / `warn` / `error` |

---

## LLM Engine Keys

At least one LLM key is required. EDITH crashes fast at startup if none are present.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude models (claude-3-5-sonnet, claude-opus-4, etc.) |
| `OPENAI_API_KEY` | OpenAI models (gpt-4o, o3, etc.) |
| `GROQ_API_KEY` | Groq inference (llama-3.3-70b, etc.) |
| `GEMINI_API_KEY` | Google Gemini models |
| `OPENROUTER_API_KEY` | OpenRouter (access to many providers) |
| `OLLAMA_HOST` | Ollama local endpoint (default: `http://localhost:11434`) |

---

## Channel Configuration

### Telegram

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | No | Comma-separated allowlist of chat IDs |

### Discord

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Token from Discord Developer Portal |
| `DISCORD_CHANNEL_ID` | No | Comma-separated allowlist of channel IDs |

### WhatsApp

| Variable | Required | Description |
|----------|----------|-------------|
| `WHATSAPP_ENABLED` | No | `true` to enable WhatsApp (`false`) |
| `WHATSAPP_MODE` | No | `baileys` (QR) or `cloud` (Meta API) |
| `WHATSAPP_CLOUD_ACCESS_TOKEN` | Cloud only | Meta Graph API access token |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | Cloud only | Meta phone number ID |
| `WHATSAPP_CLOUD_VERIFY_TOKEN` | Cloud only | Webhook verification token |
| `WHATSAPP_CLOUD_ALLOWED_WA_IDS` | No | Comma-separated wa_id allowlist |

### WebChat

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBCHAT_SECRET` | No | Bearer token for webchat WebSocket auth |

---

## Security & Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `PIPELINE_RATE_LIMIT_PER_MIN` | `30` | Max messages per user per minute |
| `ADMIN_TOKEN` | — | Bearer token required for admin endpoints (`/metrics`) |
| `CAMEL_GUARD_ENABLED` | `true` | Enable CaMeL taint tracking |

---

## Voice

| Variable | Default | Description |
|----------|---------|-------------|
| `VOICE_ENABLED` | `false` | Enable voice pipeline |
| `STT_PROVIDER` | `whisper` | Speech-to-text provider |
| `TTS_PROVIDER` | `kokoro` | Text-to-speech provider |
| `VOICE_SIDECAR_PORT` | `8765` | Port for Python voice sidecar |

---

## Vision

| Variable | Default | Description |
|----------|---------|-------------|
| `VISION_ENABLED` | `false` | Enable vision pipeline |
| `VISION_PROVIDER` | `gemini` | Vision provider: `gemini` / `openai` / `claude` / `ollama` |
| `VISION_GEMINI_MODEL` | `gemini-1.5-flash` | Gemini model for vision |
| `VISION_OPENAI_MODEL` | `gpt-4o` | OpenAI model for vision |
| `VISION_CLAUDE_MODEL` | `claude-3-5-sonnet-20241022` | Claude model for vision |
| `VISION_OLLAMA_MODEL` | `llava` | Ollama model for vision |

---

## Hardware (Phase 23)

| Variable | Default | Description |
|----------|---------|-------------|
| `HARDWARE_ENABLED` | `false` | Enable hardware scanning on startup |
| `HARDWARE_LED_ENABLED` | `false` | Enable LED strip control |
| `HARDWARE_MONITOR_DDC_BUS` | — | DDC bus number for monitor control |
| `OCTOPRINT_URL` | — | OctoPrint instance URL |
| `OCTOPRINT_API_KEY` | — | OctoPrint API key |

---

## Gateway Sync / Cross-Device (Phase 27)

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_ID` | auto-generated | Unique ID for this gateway instance |
| `GATEWAY_SYNC_ENABLED` | `false` | Enable cross-device sync |
| `CLOUD_RELAY_URL` | — | Optional cloud relay WebSocket URL |

---

## Example `.env`

```env
# Required: at least one LLM key
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...

# Database
DATABASE_URL=file:./prisma/edith.db

# Gateway
PORT=18789
HOST=127.0.0.1
NODE_ENV=production
LOG_LEVEL=info

# Admin
ADMIN_TOKEN=my-secret-admin-token

# Telegram
TELEGRAM_BOT_TOKEN=123456:abcDEF...
TELEGRAM_CHAT_ID=123456789

# Rate limiting
PIPELINE_RATE_LIMIT_PER_MIN=30
```

---

## Configuration Validation

EDITH validates all required configuration at startup using Zod schemas defined in `src/config.ts`. Missing required values will cause a fast crash with a clear error message rather than a cryptic runtime failure.

To add a new config variable, add it to `ConfigSchema` in `src/config.ts`:

```typescript
MY_NEW_VAR: z.string().default(""),
```
