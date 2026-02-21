# Orion - Personal AI Companion

TypeScript ESM implementation running on Node.js 22.

## Status

- [x] Phase 1-4: Core infrastructure
- [x] Phase 5: Security Hardening
- [ ] Phase 6: Memory Upgrade
- [ ] Phase 7: Content Intelligence
- [ ] Phase 8: Developer Platform
- [ ] Phase 9: Additional Channels
- [ ] Phase 10: Voice Upgrade

## Quick Start

```bash
pnpm install
pnpm prisma migrate dev
pnpm dev
```

## Security Features (Phase 5)

### Prompt Injection Protection

`src/security/prompt-filter.ts` provides:

- Direct injection detection (ignore instructions, disregard all, etc.)
- Jailbreak pattern detection (DAN, do anything now, pretend you are)
- Role hijack detection (your new persona, from now on you)
- Delimiter injection detection (<|im_start|>, ###, """)

### Tool Call Validation

`src/security/tool-guard.ts` provides:

- Terminal command blocking for dangerous operations
- File path protection (system directories, sensitive files)
- URL validation with SSRF protection
- Path traversal prevention

### Memory Validation

`src/security/memory-validator.ts` validates stored memories before injection into context to prevent memory poisoning attacks.

### Pairing System

`src/pairing/manager.ts` provides code-based user approval:

1. Unknown user sends message
2. Orion generates 6-digit pairing code
3. User sends code to owner
4. Owner approves with `!approve XXXXXX`

### Session Management

- `src/sessions/session-store.ts`: Per-channel session isolation
- `src/sessions/send-policy.ts`: Rate limiting (30 msg/min, 4000 char max)
- `src/sessions/input-provenance.ts`: Audit trail for all inputs

### Permissions

Configure in `permissions/permissions.yaml`:

```yaml
messaging:
  enabled: true
  require_confirm: false

file_system:
  enabled: true
  read: true
  write: false
  blocked_paths:
    - /etc
    - C:\Windows
```

## Architecture

```
src/
  agents/           AI agent runner and tools
  background/       Daemon loop and trigger engine
  channels/         Platform integrations (Discord, Telegram, etc.)
  core/             Intelligence and VoI calculator
  database/         Prisma client wrapper
  engines/          LLM providers (Anthropic, OpenAI, etc.)
  gateway/          WebSocket server for remote access
  memory/           Vector store and RAG
  multiuser/        User management
  pairing/          Code-based user approval
  permissions/      YAML-based sandbox
  security/         Prompt filtering and tool guards
  sessions/         Session and rate limit management
  skills/           Dynamic skill loader
  voice/            TTS/STT bridge
  vision/           Screen analysis bridge
```

## Configuration

Environment variables in `.env`:

```
DATABASE_URL="file:./orion.db"
DEFAULT_USER_ID="owner"

ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
GEMINI_API_KEY=""
GROQ_API_KEY=""

DISCORD_BOT_TOKEN=""
DISCORD_CHANNEL_ID=""
TELEGRAM_BOT_TOKEN=""
SLACK_BOT_TOKEN=""
WHATSAPP_ENABLED=false
```

## Development

```bash
pnpm typecheck   # TypeScript check
pnpm test        # Run tests
pnpm dev         # Start development
```
