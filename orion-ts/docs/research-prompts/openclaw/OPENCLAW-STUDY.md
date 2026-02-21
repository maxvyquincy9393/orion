# OpenClaw Architecture — Deep Study & Gap Analysis for Orion

## Apa Itu OpenClaw (Realnya)

OpenClaw bukan chatbot wrapper. Ini adalah **OS untuk AI agents**.
180,000+ GitHub stars dalam 8 minggu (Januari-Februari 2026).
Creator: Peter Steinberger (ex-PSPDFKit founder). Sekarang MIT-licensed.

Tagline internal mereka: "The LLM provides intelligence. OpenClaw provides the execution environment."

---

## Arsitektur OpenClaw (Lengkap dari Source Code)

### Layer 1: Gateway (Control Plane)
- WebSocket server, hub-and-spoke
- Koneksi ke semua messaging apps sekaligus (WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Teams, dll)
- mDNS discovery untuk local device pairing
- Auth: device token handshake — client kirim `connect` frame, gateway balas `hello-ok` snapshot
- Rate limiting per client built-in
- Single-process by design (trade-off: no horizontal scale, tapi simple deploy)

### Layer 2: Channel Adapters
Per-channel normalization. Setiap channel punya:
- Authentication handler (platform-specific)
- Inbound message parser → canonical format
- Access control (DM pairing / allowlist / open mode)
- Outbound formatter (per-platform markdown, voice note, etc)

### Layer 3: Agent Runtime
Ini yang paling penting. Per session, urutan eksekusi:

```
1. Session Resolution   → load/create session file
2. Context Assembly     → bootstrap files + memory recall + skill index
3. Execution Loop       → LLM call → tool interception → tool execution → continue
4. State Persistence    → save updated session to disk
```

Session-based isolation: setiap session punya "lane" sendiri.
Default serial execution dalam satu lane (mencegah state corruption).
Parallel hanya untuk idempotent background tasks.

### Layer 4: System Prompt Architecture
OpenClaw build custom system prompt setiap agent run.
Prompt di-compose dari multiple sources (urutan injeksi):

```
[TOOLING]        → current tool list + short descriptions
[SAFETY]         → guardrail reminder: no power-seeking, no oversight bypass
[SKILLS INDEX]   → compact list: name + description + file path (bukan full content!)
[WORKSPACE]      → working directory path
[DOCUMENTATION]  → local docs path + ClawHub URL
[BOOTSTRAP FILES]→ AGENTS.md, SOUL.md, USER.md, IDENTITY.md, MEMORY.md, TOOLS.md
[DATE/TIME]      → injected when known
[SANDBOX INFO]   → jika sandbox enabled
```

**Key insight**: Skills TIDAK di-inject full content ke prompt.
Hanya index (97 chars per skill: name + description + location path).
Model membaca SKILL.md on-demand saat memutuskan skill itu relevan.
Ini yang buat context tetap lean walaupun install 700+ skills.

### Layer 5: Bootstrap Files (Identity System)

| File | Fungsi | Token Budget |
|---|---|---|
| `AGENTS.md` | Operating instructions untuk agent | ~2-5K |
| `SOUL.md` | Persona, tone, values, boundaries | ~1-3K |
| `USER.md` | Info user + preferences | ~1-2K |
| `IDENTITY.md` | Agent name, emoji, theme | ~500 |
| `MEMORY.md` | Curated long-term memory (DM only) | ~3K max |
| `TOOLS.md` | Local tool notes | ~1K |
| `HEARTBEAT.md` | Heartbeat checklist | ~500 |
| `BOOT.md` | Startup checklist | ~500 |

Total bootstrap cap: `bootstrapTotalMaxChars = 150,000` (tapi practical: keep under 20K)
Per-file cap: `bootstrapMaxChars = 20,000`

Semua files ini **always loaded** setiap turn — artinya langsung makan context window.
MEMORY.md khusus hanya di-load untuk DM session (bukan group chat).

### Layer 6: Skill System

```
~/.openclaw/workspace/
  skills/
    my-skill/
      SKILL.md        ← required: frontmatter + instructions
      install.sh      ← optional: setup script (TIDAK auto-run!)
      config.json     ← optional: config schema
  bundled-skills/
    voice-call/
      SKILL.md
```

**SKILL.md format** (YAML frontmatter + markdown body):
```yaml
---
name: my-skill
description: "What this skill does (ini yang masuk index — keep under 97 chars)"
version: 1.2.0
metadata:
  openclaw:
    requires:
      env:
        - API_KEY_NAME
      bins:
        - curl
    primaryEnv: API_KEY_NAME
    alwaysActive: false
    emoji: "✅"
    homepage: "https://..."
    os: ["linux", "macos"]
    install:
      - kind: brew
        formula: jq
        bins: [jq]
---
# Skill Instructions
(Ini yang di-inject ke context saat skill dipanggil)
```

Skill lifecycle:
1. Discovery: agent baca skill index (nama + description saja)
2. Activation: saat relevan, agent baca full SKILL.md via `read` tool
3. Execution: agent ikuti instruksi di SKILL.md
4. Self-authoring: agent bisa TULIS skill baru sendiri!

### Layer 7: Memory System

```
CONTEXT WINDOW (always loaded):
├── System Prompts (~4-5K tokens)
├── Bootstrap Files (MEMORY.md ~3K)
└── Conversation + Tools (~185K+)

MEMORY STORES (retrieved on demand via tools):
├── Episodic    → daily logs: memory/YYYY-MM-DD.md (append-only)
├── Semantic    → knowledge graph (sqlite-vec or keyword)
├── Procedural  → learned workflows
└── Vault       → user-pinned, never auto-decayed
```

Memory search: embedding-based (sqlite-vec) OR keyword-based.
Embedding provider auto-select: local GGUF → OpenAI → Gemini → Voyage.
Hybrid search: 0.7 semantic + 0.3 keyword (default weights).

Session compaction: saat context window hampir penuh,
summaries di-generate dari older turns, preserving semantic content.

### Layer 8: Authentication & Security

**Device Pairing Flow:**
1. User kirim pairing request ke gateway
2. Gateway generate one-time pairing code
3. User confirm code di control interface (CLI/WebUI/app)
4. Device token di-issue, stored encrypted
5. Token di-clear otomatis jika mismatch (prevent stale auth)

**Access Control Hierarchy:**
```
Identity first → siapa yang boleh bicara ke bot
Scope next     → di mana bot boleh act
Model last     → assume model bisa dimanipulasi, minimize blast radius
```

Channel modes:
- `DM pairing` (default): hanya approved devices
- `allowlist`: specific chat IDs
- `open`: siapa saja (NOT recommended)

Slash commands dan directives hanya honored untuk authorized senders.

**Tool Sandboxing:**
- Docker sandbox per session (kalau enabled)
- Tool policy: per-session permission boundaries
- Path traversal prevention: session operations confined ke agent sessions directory
- Browser control: require auth, auto-generate token kalau tidak ada
- Webhook verification: constant-time secret comparison + per-client throttling

**Prompt Injection Defense:**
"Model last" philosophy — architectural constraints, bukan hanya prompt instructions.
Ini yang bikin OpenClaw lebih secure dari alternative yang hanya pakai prompt guardrails.

### Layer 9: Proactive Behavior (Heartbeat Architecture)
Bukan polling interval biasa. "Heartbeat" waktu agent tidur dan bangun sendiri.
Agent review recent context saat bangun, reflect, decide apakah perlu action.
Ini yang buat OpenClaw feel genuinely proactive, bukan reactive.

Cron jobs + webhooks untuk external triggers.
Webhook config:
```json
{
  "hooks": {
    "enabled": true,
    "token": "long-random-secret",
    "path": "/hooks"
  }
}
```

### Layer 10: Multi-Agent Routing

Sub-agents punya `promptMode: minimal`:
- Omit Skills, Memory Recall, Self-Update, User Identity, Heartbeats
- Hanya ada: Tooling, Safety, Workspace, Sandbox, Date/Time, injected context
- Bootstrap files trimmed: hanya AGENTS.md dan TOOLS.md

Agent-to-agent via session tools.
ACP (Agent Client Protocol) via `@agentclientprotocol/sdk`.

---

## Gap Orion vs OpenClaw

| Komponen | OpenClaw | Orion Sekarang | Gap |
|---|---|---|---|
| Identity files | SOUL.md + AGENTS.md + USER.md + IDENTITY.md | Tidak ada | CRITICAL |
| Skill system | SKILL.md lazy-loading index | `skills/manager.ts` ada tapi belum lazy | Medium |
| Auth | Device pairing + token + allowlist | `pairing/manager.ts` ada | Small |
| Memory | Bootstrap always-loaded + on-demand stores | LanceDB + temporal | Medium |
| Heartbeat | Context-aware proactive | VoI-based daemon | Similar |
| Session lanes | Serial default, explicit parallel | Sequential tapi ad-hoc | Medium |
| Sub-agent mode | `promptMode: minimal` | Tidak ada | Medium |
| Skill self-authoring | Agent bisa tulis skill baru | Tidak ada | Future |

---

## Paper Reference untuk OpenClaw-Style Architecture

| Area | Paper | arXiv | Relevansi |
|---|---|---|---|
| Identity Persistence | Social Identity in HAI | arXiv:2508.16609 | SOUL.md design |
| Personality OCEAN | SANDMAN AAMAS 2025 | arXiv:2504.00727 | Trait-based decision making |
| Companion Design | Harmful Traits AI Companions | arXiv:2511.14972 | Anti-sycophancy |
| Socioaffective Alignment | Why HAI needs alignment | arXiv:2502.02528 | Long-term relationship |
| Memory Survey | Memory in Age of AI Agents | arXiv:2512.13564 | Comprehensive |
| Skill Security | AURA Affordance | arXiv:2508.06124 | Skill injection risk |
