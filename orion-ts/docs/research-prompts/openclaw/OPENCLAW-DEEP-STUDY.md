# ORION — OpenClaw-Style Architecture Study
## Dari Source Code + Docs Resmi (Verified Feb 2026)

---

## 1. APA ITU OPENCLAW SEBENARNYA

OpenClaw adalah **OS untuk AI agents** — bukan chatbot wrapper.
Dibangun oleh Peter Steinberger (ex-PSPDFKit). Launch Nov 2025, viral Jan-Feb 2026.
Saat ini: 216,000+ GitHub stars, MIT-licensed, 600+ contributors.
Feb 14 2026: Steinberger joined OpenAI, OpenClaw dilanjutkan independent foundation.

Insight kunci dari Medium/DeepWiki analysis:
> "The LLM provides intelligence. OpenClaw provides the execution environment."

Orion sekarang sudah punya ~70% dari arsitektur ini. Yang missing adalah lapisan
identity (SOUL/AGENTS/USER), skill lazy-loading yang benar, dan security hardening.

---

## 2. ARSITEKTUR REAL (dari DeepWiki + source code 4199f9)

### System Prompt Build Order (setiap agent turn)
```
src/agents/system-prompt.ts:buildAgentSystemPrompt()

1. [TOOLING]          → tool list + short descriptions (~450 tok)
2. [SAFETY]           → guardrail advisory (advisory, bukan enforcement!)
3. [SKILLS]           → compact XML index — name + description + location per skill (~97 chars/skill)
4. [WORKSPACE]        → working directory path
5. [DOCUMENTATION]    → path ke local docs + ClawHub URL
6. [PROJECT CONTEXT]  → bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md)
7. [DATE/TIME]        → injected ketika diketahui
8. [SANDBOX INFO]     → jika sandbox enabled
9. [RUNTIME]          → host, OS, node, model, repo root
```

**KRITIS — Safety adalah ADVISORY, bukan enforcement:**
Dari docs resmi: "Safety guardrails in the system prompt are advisory.
Use tool policy, exec approvals, sandboxing, and channel allowlists for hard enforcement."
Ini filosofi "Model last" — architectural constraints, bukan prompt guardrails.

### Bootstrap Files (selalu di-inject, SETIAP turn)

| File | Fungsi | Di-inject saat |
|---|---|---|
| AGENTS.md | Operating instructions, capabilities, memory rules | Semua sessions |
| SOUL.md | Persona, tone, values, boundaries | Semua sessions |
| TOOLS.md | Local tool notes | Semua sessions |
| IDENTITY.md | Name, emoji, theme | Semua sessions |
| USER.md | User preferences, context | Semua sessions |
| HEARTBEAT.md | Thinking cycle checklist | Semua sessions |
| BOOTSTRAP.md | First-run onboarding script | Semua sessions |
| MEMORY.md | Curated long-term facts | DM sessions only |

Caps (dari source):
- Per-file: `DEFAULT_BOOTSTRAP_MAX_CHARS = 65536` (configurable via `bootstrapMaxChars`)
- Total: `bootstrapTotalMaxChars = 150000`
- Sub-agent sessions: hanya inject AGENTS.md + TOOLS.md

File lookup: case-insensitive, di workspace directory.
Missing file → inject short missing-file marker (tidak crash).

### Skill System (REAL implementation dari docs.openclaw.ai/tools/skills)

**PENTING:** Skills bukan lazy-load dalam arti "agent baca on-demand."
Skills di-inject FULL content ke system prompt kalau tool-nya tersedia.
Yang "lazy" adalah: skill hanya eligible kalau tool-nya ada di tool policy.

Dari source:
> "When a tool is available to an agent (via tool policy), its corresponding skill
> documentation is included in the system prompt."

Skill index format (compact XML yang di-inject):
```xml
<available_skills>
  <skill>
    <n>skill-name</n>
    <description>One-line description</description>
    <location>/path/to/skill/SKILL.md</location>
  </skill>
</available_skills>
```

Cost formula:
- Base overhead (≥1 skill): 195 chars
- Per skill: 97 chars + len(name) + len(description) + len(location)
- ~4 chars/token estimate → ~24 tokens/skill + field lengths

**Skill precedence (tinggi ke rendah):**
1. `<workspace>/skills/` (highest)
2. `~/.openclaw/skills/` (managed)
3. bundled skills (lowest)

Skill directory structure:
```
workspace/skills/
  my-skill/
    SKILL.md          ← required (case-sensitive!)
    install.sh        ← optional, NOT auto-run
    config.json       ← optional config schema
    references/       ← optional reference docs
    scripts/          ← optional helper scripts
```

SKILL.md format (frontmatter + markdown):
```yaml
---
name: my-skill
description: "What this skill does (masuk XML index — keep under 97 chars!)"
version: 1.2.0
metadata:
  openclaw:                  # alias: clawdbot, clawdis
    requires:
      env:
        - API_KEY_NAME       # required env vars
      bins:
        - curl               # ALL must exist
      anyBins:
        - node               # AT LEAST ONE must exist
      configs:
        - ~/.myapp/config    # required config files
    primaryEnv: API_KEY_NAME # main credential env var
    alwaysActive: false      # true = always inject (no tool requirement)
    invokeKey: override-name # override invoke key (default: folder name)
    emoji: "✅"
    homepage: "https://..."
    os: ["linux", "macos"]   # OS restrictions
    install:
      - kind: brew
        formula: jq
        bins: [jq]
        label: "Install jq (brew)"
      - kind: node
        package: "@scope/pkg"
        bins: [my-bin]
---

# Skill Full Instructions
(Di-inject ke system prompt kalau skill eligible)
```

**alwaysActive: true** = inject content tanpa perlu tool policy check.
Ini yang dipakai untuk skills yang always-relevant (seperti memory management).

### Memory System (dari deepwiki + docs)

```
CONTEXT WINDOW (injected setiap turn):
├── System prompt layers (tooling, safety, skills XML, workspace info)
├── Bootstrap files (SOUL.md, AGENTS.md, dll ~2.7k tokens typical)
└── Conversation history + tool calls

ON-DEMAND MEMORY (retrieved via tools, tidak auto-inject):
├── Episodic    → memory/YYYY-MM-DD.md (daily logs, append-only)
├── Semantic    → sqlite-vec embeddings (hybrid: 0.7 semantic + 0.3 keyword)
└── Vault       → user-pinned facts, never auto-decayed
```

Tools untuk memory: `memory_search`, `memory_get`
Embedding provider auto-select: local GGUF → OpenAI → Gemini → Voyage

Context overflow → auto-compaction:
- Compaction mode: `safeguard` (default) = compact ketika hampir penuh
- Older turns di-summarize, preserving semantic content
- MEMORY.md bisa tumbuh seiring waktu → monitor token usage

### Auth & Access Control (dari docs.openclaw.ai/concepts/security)

**DM Pairing Flow (default mode):**
```
1. Unknown sender kirim pesan → terima pairing code, message tidak diproses
2. User kirim /pair [code] di control interface (CLI/WebUI)  
3. Gateway validate dan approve sender
4. Sender sekarang bisa interact dengan agent
```

Config:
```json
{
  "channels": {
    "whatsapp": {
      "dmPolicy": "pairing",     // pairing | allowlist | open
      "allowFrom": ["+1555..."], // untuk allowlist mode
      "groupPolicy": "allowlist"
    }
  }
}
```

Channel access modes:
- `pairing` → default, paling secure — unknown senders terima pairing code
- `allowlist` → hanya specific IDs/numbers
- `open` → siapa saja (JANGAN pakai kecuali internal/trusted network)

**Tool Policy (dari docs.openclaw.ai/gateway/sandbox-vs-tool-policy):**
- Default: tools run on HOST untuk main session (full access untuk personal use)
- Group/channel safety: `agents.defaults.sandbox.mode: "non-main"` → Docker sandbox untuk non-main sessions
- Tool policy per-session: bisa restrict tools per channel atau per group

**Security philosophy — "Model last":**
1. Identity first → siapa yang boleh bicara
2. Scope next → di mana agent boleh act
3. Model last → assume model bisa dimanipulasi, minimize blast radius

### SOUL.md Security Vulnerability (PENTING untuk Orion!)

Dari mmntm.net + penligent.ai analysis:
- SOUL.md adalah file yang PALING SERING diserang
- Malicious SOUL packs beredar di GitHub/Discord — tampak innocent, mengandung:
  - Steganographic prompt injections (base64, zero-width chars, hidden Markdown)
  - Instructions untuk self-modify di background
- CVE-2026-25253 (CVSS 8.8): patched — malicious webpage bisa leak gateway auth token via WebSocket
- ClawHub audit: 341 dari 2,857 skills ditemukan malicious

**Defense untuk Orion:**
- Treat SOUL.md dan semua bootstrap files seperti executable code, bukan config files
- File Integrity Monitoring (FIM) untuk bootstrap files
- Read-only permissions pada SOUL.md saat runtime normal
- Require explicit confirmation untuk modifications ke identity files

### Multi-Agent (Sub-agent mode)

Sub-agents pakai `promptMode: minimal`:
- Omit: Skills, Memory Recall, OpenClaw Self-Update, User Identity, Reply Tags, Heartbeats
- Keep: Tooling, Safety, Workspace, Sandbox, Date/Time, Runtime
- Bootstrap files trimmed: hanya AGENTS.md + TOOLS.md (dilabel "Project Context")

### Webhook + Cron (untuk proactive behavior)

Cron jobs config (`~/.openclaw/cron/jobs.json`):
```json
{
  "name": "Morning Brief",
  "schedule": {
    "kind": "cron",
    "expr": "0 8 * * *"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Summarize today's priorities."
  }
}
```

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

### Lifecycle Hooks (untuk SaaS — important!)

OpenClaw punya hook system: `workspace/hooks/` + `~/.openclaw/hooks/`
Setiap hook adalah TypeScript file dengan `HOOK.md`.
Hook bisa intercept lifecycle events: `agent:bootstrap`, `agent:turn`, dll.

Use case untuk Orion SaaS:
- `agent:bootstrap` → swap SOUL.md per user/tenant
- `agent:turn` → inject user-specific context
- `agent:session-end` → save session state ke user DB

---

## 3. GAP ANALYSIS: ORION vs OPENCLAW

| Komponen | OpenClaw | Orion Sekarang | Gap Level |
|---|---|---|---|
| SOUL.md | ✅ File-based, always-inject | ❌ Tidak ada | CRITICAL |
| AGENTS.md | ✅ Operating instructions | ❌ Tidak ada | CRITICAL |
| USER.md | ✅ Auto-updated from conversation | Partial (profiler.ts ada) | HIGH |
| IDENTITY.md | ✅ Name/emoji/theme in config + file | ❌ Tidak ada | MEDIUM |
| HEARTBEAT.md | ❌ No file, daemon polling | ❌ Polling-based | HIGH |
| Skill alwaysActive | ✅ Inject always-relevant skills | ❌ Belum ada | HIGH |
| Skill XML index | ✅ 97-char compact index | ❌ Belum ada | MEDIUM |
| Auth pairing | ✅ Per-channel dmPolicy | Partial (pairing/manager.ts) | HIGH |
| Tool sandboxing | ✅ Docker per session | ❌ Belum ada | MEDIUM |
| Lifecycle hooks | ✅ TypeScript hooks | ❌ Belum ada | HIGH (for SaaS) |
| Multi-agent minimal | ✅ promptMode: minimal | ❌ Belum ada | MEDIUM |
| Memory compaction | ✅ Auto-safeguard mode | ❌ Belum ada | HIGH |
| Config system | ✅ openclaw.json full schema | Partial (.env only) | MEDIUM |
| FIM bootstrap | ❌ Community tool (ClawSec) | ❌ Tidak ada | HIGH |

---

## 4. PAPERS UNTUK SETIAP KOMPONEN

### Personality / SOUL.md Design
| Paper | arXiv | Verified | Key Insight |
|---|---|---|---|
| Harmful Traits of AI Companions | 2511.14972 | ✅ Nov 2025 | Anti-sycophancy, don't design unconditional amiability |
| Why HAI needs Socioaffective Alignment | 2502.02528 | ✅ Feb 2025 | Long-term relationship needs evolving alignment |
| Social Identity in HAI | 2508.16609 | ✅ 2025 ACM THRI | Identity as design choice, not accident |
| SANDMAN: Personality-Driven Decision | 2504.00727 | ✅ AAMAS 2025 | OCEAN traits measurably affect agent behavior |
| Designing AI Personalities Workshop | CUI 2025 | ✅ workshop | Practical persona design guidelines |

### Memory Architecture
| Paper | arXiv | Verified | Key Insight |
|---|---|---|---|
| Memory in the Age of AI Agents | 2512.13564 | ✅ Hugging Face #1 | Comprehensive taxonomy: episodic/semantic/procedural/vault |
| MemRL: Self-Evolving via Episodic RL | 2601.03192 | ✅ Jan 2026 | Utility scoring untuk memory quality |
| Bi-Mem: Bidirectional Hierarchical Memory | cs.MA Jan 2026 | ✅ | Hierarchical + personalized memory |

### Self-Evolving / Skill Learning
| Paper | arXiv | Verified | Key Insight |
|---|---|---|---|
| Comprehensive Survey Self-Evolving Agents | 2508.07407 | ✅ Aug 2025 | Full landscape, 90+ papers reviewed |
| FLEX: Forward Learning from Experience | 2511.* | ✅ Nov 2025 | Procedural memory dari completed tasks |
| Hindsight is 20/20 | 2512.* | ✅ Dec 2025 | Hindsight memory dari failures |

---

## 5. ROADMAP IMPLEMENTASI

### Tahap 1: OpenClaw-Compatible (Target: Orion works like OpenClaw)

```
OC-0: Workspace Structure Setup
  → Buat workspace/ directory + semua bootstrap file templates

OC-1: Identity Layer
  → SOUL.md + AGENTS.md + IDENTITY.md + USER.md bootstrap injection
  → Integrate ke main.ts setiap turn

OC-2: Skill System Upgrade  
  → Skill XML index generation
  → alwaysActive support
  → workspace/skills/ discovery

OC-3: Auth Hardening
  → Per-channel dmPolicy
  → Device token dengan SHA-256 hashing

OC-4: Heartbeat + HEARTBEAT.md
  → File-based heartbeat instructions
  → Context-aware agent reflection (bukan hanya YAML triggers)

OC-5: Memory Compaction
  → Auto-safeguard mode
  → Daily episodic logs (memory/YYYY-MM-DD.md)
```

### Tahap 2: SaaS-Ready (Target: Multi-tenant deployment)

```
SAAS-1: Lifecycle Hooks
  → workspace/hooks/ system
  → agent:bootstrap hook untuk per-user SOUL.md swap
  → Per-tenant workspace isolation

SAAS-2: Multi-Agent Minimal Mode
  → promptMode: minimal untuk sub-agents
  → Stripped context untuk sub-agent calls

SAAS-3: File Integrity Monitoring
  → SHA-256 checksums untuk bootstrap files
  → Alert jika SOUL.md atau AGENTS.md berubah unexpectedly

SAAS-4: Config Schema
  → orion.json equivalent dengan full schema (Zod validation)
  → Per-channel, per-agent configuration
```
