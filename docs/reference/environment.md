# Environment Variables Reference

All variables are optional unless marked **required**.

## LLM Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | `""` | Anthropic Claude API key |
| `OPENAI_API_KEY` | `""` | OpenAI API key |
| `GEMINI_API_KEY` | `""` | Google Gemini API key |
| `GROQ_API_KEY` | `""` | Groq API key (fast inference) |
| `OPENROUTER_API_KEY` | `""` | OpenRouter API key |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama local server URL |
| `DEEPSEEK_API_KEY` | `""` | DeepSeek API key |
| `MISTRAL_API_KEY` | `""` | Mistral AI API key |
| `TOGETHER_API_KEY` | `""` | Together AI API key |
| `FIREWORKS_API_KEY` | `""` | Fireworks AI API key |
| `COHERE_API_KEY` | `""` | Cohere API key |
| `GITHUB_TOKEN` | `""` | GitHub token (for Copilot engine) |

## Multi-Account Key Rotation

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEYS` | `""` | Comma-separated Anthropic keys |
| `OPENAI_API_KEYS` | `""` | Comma-separated OpenAI keys |
| `GEMINI_API_KEYS` | `""` | Comma-separated Gemini keys |

## Channels

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | `""` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | `""` | Default Telegram chat ID |
| `DISCORD_BOT_TOKEN` | `""` | Discord bot token |
| `DISCORD_CHANNEL_ID` | `""` | Default Discord channel |
| `SLACK_BOT_TOKEN` | `""` | Slack bot token |
| `SLACK_APP_TOKEN` | `""` | Slack app-level token |
| `WEBCHAT_PORT` | `8080` | Webchat HTTP port |

## System

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./edith.db` | SQLite database URL |
| `DEFAULT_USER_ID` | `owner` | Default user ID for single-user mode |
| `LOG_LEVEL` | `info` | Log level: debug/info/warn/error |
| `GATEWAY_PORT` | `18789` | WebSocket gateway port |
| `GATEWAY_HOST` | `127.0.0.1` | Gateway bind address |

## Security

| Variable | Default | Description |
|----------|---------|-------------|
| `DM_POLICY_MODE` | `open` | DM access: open/allowlist/blocklist/admin-only |
| `ADMIN_USER_ID` | `""` | Admin user ID |
| `ALLOWED_USER_IDS` | `""` | Comma-separated allowed user IDs |
| `BLOCKED_USER_IDS` | `""` | Comma-separated blocked user IDs |
| `EDITH_API_TOKEN` | `""` | REST API bearer token |

## Voice

| Variable | Default | Description |
|----------|---------|-------------|
| `VOICE_ENABLED` | `false` | Enable voice pipeline |
| `WAKE_WORD_ENABLED` | `false` | Enable always-on wake word |
| `WAKE_WORD_PHRASE` | `hey edith` | Wake phrase |

## Ambient & Protocols

| Variable | Default | Description |
|----------|---------|-------------|
| `USER_LATITUDE` | `""` | User latitude for weather |
| `USER_LONGITUDE` | `""` | User longitude for weather |
| `NEWS_ENABLED` | `false` | Enable news headlines |
| `NEWS_API_KEY` | `""` | NewsAPI.org API key |
| `MORNING_BRIEFING_ENABLED` | `true` | Enable morning briefing |
| `MORNING_BRIEFING_TIME` | `07:00` | Briefing time (HH:MM) |

## API Compatibility

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_COMPAT_API_ENABLED` | `false` | Enable /v1/chat/completions |
| `MCP_SERVER_ENABLED` | `false` | Enable MCP server mode |
