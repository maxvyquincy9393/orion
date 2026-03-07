# Compatibility Matrix

| Component | Requirement | Optional | Notes |
|---|---|---|---|
| Node runtime | Node.js 22+ | No | TS ESM setup |
| Package manager | pnpm 10+ | No | lockfile baseline |
| Database | SQLite (Prisma) | No | `DATABASE_URL` |
| Vector DB | LanceDB | No | local data dir |
| Python | Python 3.10+ | Yes | required for voice/media tools |
| Qwen3-TTS | Python package | Yes | fallback to XTTS when absent |
| Signal | signal-cli | Yes | requires linked account |
| LINE | channel token/secret | Yes | API dependent |
| Matrix | homeserver/token/room | Yes | API dependent |
| Teams | app credentials/service URL | Yes | Bot Framework flow |
| iMessage | BlueBubbles server | Yes | macOS ecosystem |

## LLM Providers
- Anthropic, OpenAI, Gemini, Groq, OpenRouter are optional by key presence.
- At least one provider recommended for production use.
