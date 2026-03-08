---
name: Bug Report
about: Report a bug or unexpected behavior in EDITH
title: '[Bug] '
labels: bug
assignees: ''
---

## Describe the Bug

A clear and concise description of what the bug is.

## To Reproduce

Steps to reproduce the behavior:

1. Start EDITH with `...`
2. Send message `...`
3. See error

## Expected Behavior

A clear and concise description of what you expected to happen.

## Actual Behavior

What actually happened. Include error messages, stack traces, or log output if available.

```
Paste logs here (from [channels.telegram] / [core.pipeline] / etc.)
```

## Environment

| Field | Value |
|-------|-------|
| OS | (e.g., Windows 11, macOS 14, Ubuntu 22.04) |
| Node.js version | (run `node --version`) |
| pnpm version | (run `pnpm --version`) |
| EDITH version / commit | (run `git rev-parse --short HEAD`) |
| Channel affected | (e.g., Telegram, Discord, webchat) |
| LLM provider | (e.g., Groq, Anthropic, Ollama) |

## Configuration (sanitized)

Share relevant config (remove all API keys and secrets):

```env
NODE_ENV=production
VOICE_ENABLED=false
# ... other relevant vars
```

## Additional Context

Any other context, screenshots, or information about the problem.
