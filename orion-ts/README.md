# Orion

Personal AI companion. Runs locally, builds long-term memory, and can act proactively across channels.

## Quick Start

```bash
pnpm install
pnpm prisma migrate dev
pnpm doctor
pnpm dev -- --mode all
```

## Configuration (.env reference)

Core:

```env
DATABASE_URL="file:./orion.db"
DEFAULT_USER_ID="owner"
LOG_LEVEL="info"

ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
GEMINI_API_KEY=""
GROQ_API_KEY=""
OPENROUTER_API_KEY=""
```

Channels:

```env
WEBCHAT_PORT=8080
WHATSAPP_ENABLED=false

SIGNAL_PHONE_NUMBER=""
SIGNAL_CLI_PATH=""

LINE_CHANNEL_TOKEN=""
LINE_CHANNEL_SECRET=""

MATRIX_HOMESERVER=""
MATRIX_ACCESS_TOKEN=""
MATRIX_ROOM_ID=""

TEAMS_APP_ID=""
TEAMS_APP_PASSWORD=""
TEAMS_SERVICE_URL=""

BLUEBUBBLES_URL=""
BLUEBUBBLES_PASSWORD=""
```

Voice:

```env
VOICE_ENABLED=false
PYTHON_PATH="python"
QWEN3_MODE="latency" # latency | quality
```

## Modes

- `text`: CLI loop.
- `gateway`: WebSocket + webchat + daemon.
- `all`: gateway + CLI together.

Run with:

```bash
pnpm dev -- --mode text
pnpm dev -- --mode gateway
pnpm dev -- --mode all
```

## Architecture (diagram)

```text
Input Channels -> Security Layer -> Hook Pipeline -> Gateway
               -> Memory System (Temporal/HiMeS/Profiler/Causal/ProMem)
               -> Engine Orchestrator -> Agent Runner/Tools
               -> Background Daemon (Triggers + VoI + ContextPredictor)
               -> Channel Delivery
```

## Features

- Multi-engine orchestration: Anthropic/OpenAI/Gemini/Groq/Ollama/OpenRouter.
- Security stack: prompt filtering, memory validation, tool guard, ACP signing.
- Memory stack: temporal index, profiler facts/opinions, session compression, ProMem, causal graph.
- Content intelligence: URL extraction + summarization, image/audio understanding, markdown adaptation per channel.
- Developer platform: hooks, plugin loader, ACP router/protocol, doctor CLI.
- Multi-channel support: WebChat, WhatsApp, Signal, LINE, Matrix, Teams, iMessage.
- Voice: Qwen3-TTS upgrade path with XTTS fallback and streaming bridge.

## Memory Architecture

Layers:

- `session-summarizer.ts`: in-session compression (Memoria-style).
- `profiler.ts`: objective facts + subjective opinions with confidence updates.
- `causal-graph.ts`: causal edges + hyper-edges + hybrid retrieval.
- `temporal-index.ts`: raw -> summary -> abstracted with validity periods.
- `promem.ts`: post-session iterative extraction/verification.
- `himes.ts`: short-term + long-term fused context assembly.

## Security Model

Message path:

1. Pairing/rate policy checks.
2. Prompt filter sanitization (direct + indirect injection patterns).
3. Hook pipeline (`pre_message`, `post_message`, `pre_send`).
4. Memory validation before context injection.
5. Tool guard for file/terminal/url restrictions.
6. ACP security for agent-to-agent messages:
   - HMAC-SHA256 signing
   - capability check
   - payload filtering
   - state transition validation
   - provenance audit logging

## Voice Setup (Qwen3-TTS vs XTTS-v2)

Python pipeline (`delivery/voice.py`):

- Uses `Qwen3-TTS` when available.
- Falls back automatically to XTTS-v2 when Qwen3 is unavailable.
- Supports:
  - `speak(text, voice_profile)` (backward compatible)
  - `speak_streaming(text, voice_profile, callback)` (chunk streaming)

Install Qwen3-TTS:

```bash
python -m pip install git+https://github.com/QwenLM/Qwen3-TTS
```

## Phase Status

- [x] Phase 1-4: Core infrastructure
- [x] Phase 5: Security hardening
- [x] Phase 6: Memory upgrade
- [x] Phase 7: Content intelligence
- [x] Phase 8: Developer platform
- [x] Phase 9: Additional channels
- [x] Phase 10: Voice upgrade

## Research Basis

| Paper | arXiv ID | Area | Integrated In |
|---|---|---|---|
| HiMeS | 2601.06152 | Memory | `src/memory/himes.ts` |
| O-Mem | 2511.13593 | Memory | `src/memory/profiler.ts` |
| ProMem | 2601.04463 | Memory | `src/memory/promem.ts` |
| REMI | 2509.06269 | Memory | `src/memory/causal-graph.ts` |
| TiMem | 2601.02845 | Memory | `src/memory/temporal-index.ts` |
| Memoria | 2512.12686 | Memory | `src/memory/session-summarizer.ts` |
| Hindsight | 2512.12818 | Memory | `src/memory/profiler.ts` |
| PersonalAI | 2506.17001 | Memory | `src/memory/causal-graph.ts` |
| Zep/Graphiti | 2501.13956 | Memory | `src/memory/temporal-index.ts` |
| UserCentrix | 2505.00472 | Proactive | `src/core/voi.ts` |
| ContextAgent | 2505.14668 | Proactive | `src/core/context-predictor.ts` |
| PASB | 2602.08412 | Security | `src/security/prompt-filter.ts` |
| SoK Injection | 2601.17548 | Security | `src/acp/protocol.ts`, `src/acp/router.ts` |
| Agentic AI Security | 2510.23883 | Security | security review layer |
| Systems Security | 2512.01295 | Security | permission/task scoping |
| Multi-Agent Orchestration | 2601.13671 | Multi-agent | `src/acp/router.ts` |
| Qwen3-TTS | 2601.15621 | Voice | `delivery/voice.py`, `src/voice/bridge.ts` |

## Contributing

1. Run `pnpm typecheck` before commit.
2. For schema edits, run `pnpm prisma migrate dev`.
3. Use `pnpm doctor` when environment issues appear.
4. Keep security checks active when adding new tools/channels.
