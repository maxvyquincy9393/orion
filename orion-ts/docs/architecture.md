# Architecture — Orion TS

> Last updated after the Step 10 refactor pass.

## High-Level Architecture

```
[Transport Layer]
  CLI (main.ts → startCLI)
  WebSocket/HTTP Gateway (gateway/server.ts)
         ↓
[Core Pipeline]
  src/core/message-pipeline.ts
  ├── Input:  filterPromptWithAffordance (security/prompt-filter.ts)
  ├── Memory: memory.buildContext() → HiMeS + MemRL
  ├── Prompt: buildSystemPrompt() → bootstrap files + skills + dynamic context
  ├── LLM:   orchestrator.generate() → best available engine
  ├── Critic: responseCritic.critiqueAndRefine()
  └── Output: outputScanner.scan()
         ↓
[Identity Layer — OpenClaw Paradigm]
  workspace/SOUL.md       ← who Orion is (static, source of truth)
  workspace/AGENTS.md     ← operating instructions
  workspace/IDENTITY.md   ← name, emoji, theme
  workspace/USER.md       ← user profile (auto-updated by profiler)
  workspace/MEMORY.md     ← curated long-term facts (DM only)
  src/core/bootstrap.ts   ← loads and verifies these files with SHA256
         ↓
[Dynamic Context — Runtime Layer]
  src/core/persona.ts     ← mood/expertise/topic detection (per-turn)
  src/memory/profiler.ts  ← long-term user profile extraction
         ↓
[Memory Layer]
  LanceDB (vector)         ← semantic search
  src/memory/memrl.ts      ← MemRL two-phase retrieval + Bellman Q-updates
  src/memory/himes.ts      ← hierarchical memory + session summarizer
  src/memory/store.ts      ← primary interface
  Prisma/SQLite            ← message history + memory node metadata
         ↓
[Engine Layer]
  src/engines/orchestrator.ts   ← routes to best available engine
  src/engines/anthropic.ts      ← Claude
  src/engines/openai.ts         ← GPT-4o
  src/engines/gemini.ts         ← Gemini
  src/engines/groq.ts           ← Llama (fast)
  src/engines/ollama.ts         ← local models
         ↓
[Channel Layer]
  src/channels/manager.ts       ← unified channel registry
  WhatsApp / iMessage / Signal / Teams / Line / Matrix / WebChat
```

## Key Architectural Decisions

### 1. **OpenClaw Paradigm**

Workspace markdown files are the source of truth for identity.
Code is the execution environment. SOUL.md beats persona.ts.

The static identity (who Orion is, values, tone) lives in `workspace/SOUL.md`.
Dynamic context (current user mood, expertise, topic) is computed at runtime
by `PersonaEngine` and injected AFTER the bootstrap files.

### 2. **Single Pipeline**

All message transports (CLI, gateway) delegate to
`src/core/message-pipeline.ts`. No duplicate processing logic.

This ensures:
- Consistent behavior across all entry points
- Single source of truth for the processing flow
- Easier testing and debugging
- No logic drift between transports

### 3. **MemRL**

Memories are retrieved in two phases:
1. **Phase 1** — Vector similarity filter (threshold-based)
2. **Phase 2** — Utility/Q-value re-ranking using IEU triplets

Result: Memories ranked by blended score (50% similarity + 30% Q-value + 20% utility)

After each user turn, memories are updated via Bellman Q-learning:
```
Q(s,a) = Q(s,a) + α * [r + γ * maxQ(s') - Q(s,a)]
```

### 4. **Bootstrap Integrity**

Every workspace file is SHA256-verified on load to detect tampering.
Files are cached by mtime to avoid redundant disk reads.
Per-file and total character caps prevent prompt overflow.

### 5. **Multi-Provider Orchestration**

The Orchestrator maintains a registry of available LLM engines
and routes requests based on task type priority:

- **reasoning**: gemini → groq → anthropic → openai → ollama
- **code**: groq → gemini → anthropic → openai → ollama
- **fast**: groq → gemini → ollama → openai → anthropic
- **multimodal**: gemini → openai → anthropic
- **local**: ollama

Engines are checked for availability on init() and only registered
if they respond successfully to an availability probe.

### 6. **Observability**

Usage tracking via UsageTracker with:
- SQLite storage + ring buffer for high-throughput
- Pricing table for cost estimation (OpenAI, Anthropic, Groq, Google)
- `/api/usage/summary` and `/api/usage/global` endpoints
- Actual provider/model tracking (not hardcoded)

### 7. **Multi-Tenancy (SaaS Mode)**

When `ORION_SAAS_MODE=true`:
- Per-user isolated workspaces
- Tenant-level resource quotas (messages, storage, skills, rate limits)
- Feature flags (voice, vision, custom skills, API access)
- Automatic workspace provisioning

## File Organization

```
src/
├── core/               # Bootstrap, persona, system prompts, pipeline
├── engines/            # LLM provider adapters
├── memory/             # Vector store, MemRL, HiMeS, profiler
├── channels/           # Communication platform integrations
├── security/           # Input filtering, output scanning, affordance
├── gateway/            # HTTP/WebSocket server
├── observability/      # Usage tracking, telemetry
├── utils/              # Shared utilities (string, etc.)
└── main.ts             # Entry point (thin orchestrator)
```

## Data Flow

1. **User Input** → Transport (CLI/Gateway)
2. **Safety Check** → filterPromptWithAffordance
3. **Context Building** → memory.buildContext() (HiMeS + MemRL)
4. **Persona Detection** → PersonaEngine.buildDynamicContext()
5. **System Prompt** → buildSystemPrompt() (bootstrap + skills + dynamic)
6. **LLM Generation** → orchestrator.generate()
7. **Critique** → responseCritic.critiqueAndRefine()
8. **Output Safety** → outputScanner.scan()
9. **Persistence** → Database + Vector store + Session store
10. **Side Effects** → Profiler, Causal graph (async)

## Testing Strategy

- Unit tests for pure functions (string utils, clamp, etc.)
- Integration tests for pipeline stages
- E2E tests for critical user journeys

## Performance Considerations

- LanceDB vector search with utility ranking
- mtime-based file caching
- Async side effects (profiler, causal graph)
- Ring buffer for usage tracking
- Connection pooling for database
