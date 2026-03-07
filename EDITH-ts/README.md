# EDITH

Even Dead, I'm The Hero.

Persistent AI companion with long-term memory. Runs locally, supports 6 LLM providers, and delivers across 9 channels.

Official product identity is `EDITH` — Even Dead, I'm The Hero.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure (at least 1 API key required)
cp .env.example .env
# Edit .env - set GEMINI_API_KEY (free via https://aistudio.google.com)

# 3. Setup database
pnpm prisma migrate dev

# 4. Run
pnpm dev
```

## Chat Commands

Once running, these commands work in CLI and WebChat:

| Command | Description |
|---|---|
| `/model <engine>` | Switch engine (e.g. `/model gemini`) |
| `/model <engine>/<model>` | Specific model (e.g. `/model openai/gpt-4o-mini`) |
| `/model auto` | Reset to automatic selection |
| `/models` | List available engines and models |
| `/status` | Show current engine, preferences |
| `/help` | Show all commands |

## Modes

```bash
pnpm dev                        # CLI chat (default)
pnpm dev -- --mode gateway      # WebSocket + API server
pnpm dev -- --mode all          # CLI + gateway
pnpm edith                     # EDITH OS mode (legacy alias)
```

## Supported Engines

| Engine | Provider | Default Model | Free? |
|---|---|---|---|
| `gemini` | Google | gemini-2.0-flash | yes |
| `groq` | Groq | llama-3.3-70b-versatile | yes |
| `openai` | OpenAI | gpt-4o | paid |
| `anthropic` | Anthropic | claude-sonnet-4-20250514 | paid |
| `openrouter` | OpenRouter | anthropic/claude-sonnet-4 | mixed |
| `ollama` | Local | Auto-detect | yes |

Switch anytime with `/model <engine>` in chat or via REST API.

## REST API

When running in `gateway` mode:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/message` | Send a message |
| `GET` | `/api/models` | List available engines + models |
| `POST` | `/api/models/select` | Set model preference |
| `DELETE` | `/api/models/select` | Reset to auto |
| `GET` | `/api/usage/summary` | Usage stats |

## Architecture

```text
User Input
  CLI / WebSocket / Channel
    -> Security Layer
    -> Hook Pipeline
    -> Engine Orchestrator
    -> Memory System
    -> Response Critic
    -> Output Scanner
    -> Channel Delivery
```

## Channels

WebChat, Discord, Telegram, WhatsApp (Baileys/Cloud), Slack, Signal, LINE, Matrix (Element), Microsoft Teams, iMessage (via BlueBubbles).

## Voice

Built-in EDITH voice uses Edge TTS with the `edith` DSP preset under the hood:

```env
VOICE_ENABLED=true
VOICE_TTS_BACKEND=edge
VOICE_EDGE_VOICE=en-US-GuyNeural
```

## Project Structure

```text
src/
├── core/           # Pipeline, startup, chat commands, event bus
├── engines/        # LLM providers + orchestrator + model preferences
├── memory/         # Temporal, causal, profiler, MemRL, HiMeS
├── channels/       # 9 channel adapters
├── gateway/        # Fastify WebSocket + REST server
├── security/       # Prompt filter, affordance, tool guard, output scan
├── voice/          # Voice pipeline + DSP presets
├── agents/         # Agent runner + tools
├── background/     # Daemon, triggers, VoI, context predictor
├── sessions/       # Session store + compaction
├── hooks/          # Pre/post message hooks
├── skills/         # Skill loader + bundled skills
├── plugin-sdk/     # Plugin system
├── acp/            # Agent Communication Protocol
└── observability/  # Usage tracking + engine stats
```

## Research Basis

| Paper | Area | Module |
|---|---|---|
| HiMeS (2601.06152) | Memory | `memory/himes.ts` |
| O-Mem (2511.13593) | Memory | `memory/profiler.ts` |
| ProMem (2601.04463) | Memory | `memory/promem.ts` |
| REMI (2509.06269) | Memory | `memory/causal-graph.ts` |
| TiMem (2601.02845) | Memory | `memory/temporal-index.ts` |
| Memoria (2512.12686) | Memory | `memory/session-summarizer.ts` |
| PASB (2602.08412) | Security | `security/prompt-filter.ts` |
| AURA (2508.06124) | Security | `security/affordance-checker.ts` |

## Branding

See `docs/branding.md` for the naming contract and how legacy labels should be interpreted.

## Contributing

```bash
pnpm typecheck
pnpm prisma migrate dev
pnpm doctor
```
