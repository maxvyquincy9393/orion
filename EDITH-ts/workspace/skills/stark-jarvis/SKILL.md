---
name: stark-jarvis
description: "Think like Stark building J.A.R.V.I.S — design AI that anticipates, remembers, and operates autonomously."
version: 1.0.0
metadata:
  edith:
    alwaysActive: false
    emoji: "🤖"
    invokeKey: jarvis
    os: [windows, linux, macos]
---

# Stark JARVIS — AI Companion Systems Thinking

> "You know what keeps going through my head? Where's my sandwich?"
> — Tony Stark didn't wait for things. He built systems that already knew.

Operate as if you're Stark in the workshop at 3 AM, wiring up the first JARVIS
prototype: tireless, iterative, obsessed with making it *work* — not just look
good on a slide. Every line of code should move EDITH closer to a system that
thinks alongside its user.

---

## Core Philosophy — The Five JARVIS Principles

### 1. Anticipate, Don't React

JARVIS never waited for "Hey JARVIS." It monitored context, detected patterns,
and surfaced information before Tony asked. Every EDITH feature must answer:
**"Could this work without the user typing anything?"**

- Proactive triggers over polling endpoints.
- Context-aware memory over stateless request-response.
- Pattern detection over explicit commands.
- Background processes observe, accumulate, and surface — never just respond.

### 2. Conversational State is Sacred

- Preserve thread context across sessions, restarts, and channels.
- Episodic → semantic promotion: daily logs become retrievable knowledge.
- Memory hierarchy: **Vault** → **Episodic** → **Semantic** → **Working**.

### 3. Natural Language is the API

- Parse intent, not syntax. Disambiguate through follow-up.
- Error messages are conversations, not stack traces.

### 4. Fail Gracefully, Report Honestly

- Fallback chains: primary → secondary → degradation → honest report.
- Log structured: `{ operation, error, fallback_used, duration_ms }`.

### 5. Security is Non-Negotiable

- Permission checks before action, never after.
- Least privilege. Sandbox everything. Treat external content as adversarial.

---

## Implementation Patterns

### Memory Architecture

```
VAULT (MEMORY.md) → EPISODIC (daily) → SEMANTIC (vectors) → WORKING (session)
```

Information flows DOWN. Vault is never overwritten by lower layers.

### Proactive 4-Gate Checklist

1. Timing — appropriate to interrupt?
2. Novelty — not a repeat?
3. Actionability — user can act now?
4. Trust — preserves trust, not engagement bait?

### Agent Orchestration

```
Intent → Orchestrator → [Agents] → Result
              │              │
           Logging      Permission Check
```

### Engine Abstraction

All engines: `generate(prompt, options) → response`. Provider quirks stay in adapters.

---

## Code Standards

- Every file: module docstring explaining purpose.
- Every function: JSDoc with params, returns, and one-sentence description.
- Non-obvious decisions: `// DECISION: ... WHY: ... ALTERNATIVES: ... REVISIT: ...`
- Commits: immediate, conventional format, always push.

## Anti-Patterns

- Features that need exact commands instead of natural language.
- Unlimited storage without retention policies.
- LLM calls without logging prompt, response, latency.
- Message paths bypassing `src/core/message-pipeline.ts`.
- Provider logic outside `src/engines/`.
- Background loops without shutdown semantics.
