---
name: stark-jarvis
description: >-
  Think like Tony Stark building J.A.R.V.I.S — design AI systems that anticipate,
  remember, and operate autonomously. Use when building conversational AI, memory
  pipelines, proactive intelligence, agent orchestration, or LLM integrations.
  Do NOT use for infrastructure ops, CI/CD, or hardware-level engineering tasks.
license: MIT
compatibility: Designed for VS Code Copilot, OpenAI Codex, and EDITH internal loader
metadata:
  author: edith-project
  version: "1.0.0"
  edith-emoji: "🤖"
  edith-always-active: "false"
  edith-invoke-key: "jarvis"
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
and surfaced information before Tony asked. Every EDITH feature must answer one
question: **"Could this work without the user typing anything?"**

- Proactive triggers over polling endpoints.
- Context-aware memory over stateless request-response.
- Pattern detection over explicit commands.
- Background processes observe, accumulate, and surface — never just respond.

### 2. Conversational State is Sacred

Tony could say "do that thing from last Tuesday" and JARVIS knew. EDITH must
too.

- Preserve thread context across sessions, restarts, and channels.
- Episodic memory feeds semantic memory — daily logs become retrievable knowledge.
- Never lose context. Interrupted conversations resume where they stopped.
- Memory hierarchy: **Vault** (permanent) → **Episodic** (daily) → **Semantic** (vector) → **Working** (session).

### 3. Natural Language is the API

Tony never opened a YAML config. He spoke. EDITH should be the same.

- CLI is for developers. Conversation is for users.
- Parse intent, not syntax. Accept vague and disambiguate through follow-up.
- If the user says "make it faster," determine what "it" is from context.
- Error messages are conversations, not stack traces.

### 4. Fail Gracefully, Report Honestly

JARVIS never crashed silently. When something failed, Tony got a clear report.

- Log structured data: `{ operation, input_summary, error, fallback_used, duration_ms }`.
- Fallback chains: primary → secondary → graceful degradation → honest "I can't do that."
- Never return generic errors. Always include what was attempted and what failed.
- Every LLM call, memory query, and agent step must have observable failure modes.

### 5. Security is Non-Negotiable

Stark learned this the hard way (see: Ultron). Every capability is sandboxed.

- Permission checks happen **before** action, never after.
- Principle of least privilege: request only what the current task needs.
- User-configurable sandbox: what EDITH can see, touch, execute, and communicate.
- All external content (web, files, APIs) is treated as potentially adversarial.

---

## Implementation Patterns

### Memory Architecture

```
┌─────────────────────────────────────────────┐
│  VAULT (MEMORY.md)                          │
│  High-confidence, stable, user-verified     │
├─────────────────────────────────────────────┤
│  EPISODIC (memory/YYYY-MM-DD.md)            │
│  Daily interaction summaries, auto-prunable │
├─────────────────────────────────────────────┤
│  SEMANTIC (LanceDB vectors)                 │
│  Embedded conversation chunks for retrieval │
├─────────────────────────────────────────────┤
│  WORKING (session context)                  │
│  Current thread state, lost on session end  │
└─────────────────────────────────────────────┘
```

- Information flows DOWN. Vault is never overwritten by episodic logs.
- Semantic embeddings reference episodic sources for provenance.
- Working memory is disposable and cheapest to maintain.

### Proactive Intelligence — The 4-Gate Checklist

Before any proactive message fires, validate:

1. **Timing** — Is the user in a context where interruption is appropriate?
2. **Novelty** — Is this new, not a repeat of something already said?
3. **Actionability** — Can the user act on this right now?
4. **Trust** — Does this preserve user trust and avoid engagement bait?

If any gate fails, suppress and log the suppression reason.

### Agent Orchestration Flow

```
User Intent → Orchestrator → [Agent 1] → [Agent 2] → Result
                  │                │            │
               Logging        Permission    Fallback
                                Check         Chain
```

- Orchestrator decomposes high-level intent into steps.
- Each agent is specialized: browsing, file ops, system control, analysis.
- Every step is logged, reversible, and permission-checked.
- Supervisor enforces timeouts and handles partial failures.

### Engine Abstraction

Tony swapped arc reactors. EDITH swaps LLM engines.

- All engines implement: `generate(prompt, options) → response`.
- Engine selection is per-task: fast model for classification, powerful for reasoning.
- Provider quirks (rate limits, tokens, formats) stay inside engine adapters.
- Business logic never references a specific provider name.

---

## Code Standards

### File Header

```typescript
/**
 * proactive-triggers.ts
 *
 * Detects conditions that warrant EDITH initiating contact.
 * Runs as a background loop evaluating triggers against user context.
 *
 * Part of EDITH — Persistent AI Companion System.
 */
```

### Function Documentation

```typescript
/**
 * Evaluate whether a proactive trigger should fire.
 *
 * Checks the trigger against user activity, quiet hours,
 * frequency limits, and novelty. Returns a decision with
 * reasoning for observability.
 *
 * @param trigger - The trigger definition to evaluate
 * @param context - Current user context
 * @returns TriggerDecision with fire/suppress and reasoning
 */
```

### Decision Comments

```typescript
// DECISION: Use LanceDB over Chroma for vector storage
// WHY: Embedded (no server), Windows-native, concurrent reads
// ALTERNATIVES: Chroma (Python server), pgvector (PostgreSQL)
// REVISIT: If multi-node deployment or >1M vectors needed
```

### Commit Discipline

```bash
git add .
git commit -m "feat(memory): add episodic-to-semantic promotion pipeline"
git push origin main
```

---

## Anti-Patterns — What JARVIS Would Never Do

- Ship a feature that only works when the user types the exact right command.
- Store unlimited data without retention policies or size limits.
- Call an LLM without logging prompt, response, and latency.
- Create a message pathway that bypasses `src/core/message-pipeline.ts`.
- Hard-code provider logic outside `src/engines/`.
- Skip permission checks because "it's just a read."
- Leave a background loop without shutdown semantics and health checks.
- Treat errors as acceptable when a fallback chain could recover.
