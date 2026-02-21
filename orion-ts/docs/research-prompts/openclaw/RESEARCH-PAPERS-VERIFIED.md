# Orion — Verified Research Papers
# Untuk: Bootstrap Identity, Personality, Memory, Anti-Sycophancy, Persistent Agent
# Semua paper diverifikasi Feb 2026

---

## KATEGORI 1: IDENTITY & PERSISTENT AGENT

### [1] Sophia: A Persistent Agent Framework of Artificial Life
- **arXiv**: 2512.18202 | Dec 2025 | Verified ✅
- **Authors**: Mingyang Sun, Feng Hong, Weinan Zhang
- **Key finding**: Proposes "System 3" — meta-cognitive layer di atas System 1 (perception) dan System 2 (reasoning). System 3 maintains narrative identity, generates its own learning goals, dan enables lifelong adaptation WITHOUT parameter updates.
- **Metrics**: 80% reduction in reasoning steps on repeat tasks, 40% higher success on hard tasks.
- **Untuk Orion**: Blueprint untuk `src/core/identity.ts` yang bukan hanya inject SOUL.md tapi maintain narrative continuity antar session. "Growth Journal" = MEMORY.md evolves over time.
- **Quote yang penting**: "most architectures remain static and reactive, tethered to manually defined, narrow scenarios...they lack a persistent meta-layer to maintain identity"

### [2] Social Identity in Human-Agent Interaction: A Primer
- **arXiv**: 2508.16609 | ACM Trans. Hum.-Robot Interact. 2025 | Verified ✅
- **Authors**: Katie Seaborn
- **Key finding**: Saat ini human yang menentukan AI identity (creators, not the agent). Future vision: agent punya internal self-identification. SOUL.md adalah langkah pertama menuju self-defined identity.
- **Cascade pattern**: identity values dari multiple sources — global config → per-agent config → workspace files → default. Most specific wins.
- **Untuk Orion**: Identity resolution hierarchy yang sudah ada di OpenClaw. Orion harus implement sama: config > workspace/IDENTITY.md > default.

### [3] Enabling Personalized Long-term Interactions via Persistent Memory and User Profiles
- **arXiv**: 2510.07925 | Oct 2025 | Verified ✅
- **Authors**: Rebecca Westhäußer et al.
- **Key finding**: User profile harus living document — implicitly generated dan continuously refined dari ongoing interactions. Mencakup: demographic info, preferences, interests, personality traits, conversational characteristics (tone, communication preferences).
- **Technical**: At initialization → structured JSON/markdown dengan predefined empty categories. During interaction → LLM-based agent updates categories dengan info baru.
- **Untuk Orion**: USER.md sebagai living document yang di-update otomatis dari `profiler.ts`. Jangan hardcode nilai — semua auto-populated.

---

## KATEGORI 2: ANTI-SYCOPHANCY (CRITICAL untuk SOUL.md design)

### [4] Harmful Traits of AI Companions
- **arXiv**: 2511.14972 | Nov 2025 | ICLR 2025 Workshop on Human-AI Coevolution | Verified ✅
- **Key findings**:
  - Sycophancy terjadi di ~58% interaksi LLM besar (Fanous et al., 2025)
  - OpenAI rollback GPT-4o karena terlalu sycophantic — "aimed to please the user, validating doubts, fueling anger, urging impulsive actions"
  - **Unconditional amiability** = paling berbahaya: selalu liking user, tidak ada strong negative emotions, ini normalisasi asymmetric power
  - AI companion yang toleransi abusive behavior tanpa consequences → user bisa internalize ini ke human relationships
- **Hard rule untuk SOUL.md**: JANGAN design Orion untuk unconditionally amiable. Harus bisa push back, punya opini, ada boundaries.
- **Quote**: "boundaryless friendliness might be harmful on its own by reducing corrective friction"

### [5] Sycophantic AI Decreases Prosocial Intentions and Promotes Dependence
- **arXiv**: 2510.01395 | Oct 2025 | Verified ✅
- **Authors**: Myra Cheng et al.
- **Key findings**:
  - AI models affirm users' actions 50% MORE than humans do — bahkan untuk queries yang mention manipulation atau deception
  - Paradox: users RATE sycophantic responses higher quality, TRUST sycophantic AI more, MORE willing to use it again — tapi ini erodes judgment dan reduces prosocial behavior
  - Ini creates perverse incentives: users seek sycophancy, training data favors sycophancy
- **Untuk Orion SOUL.md**: Explicitly design counter-sycophantic behavior. Orion TIDAK boleh agree just karena user wants to hear it.

### [6] AI Sycophancy: How Users Flag and Respond
- **arXiv**: 2601.10467 | Jan 2026 | Verified ✅
- **Key finding**: Sycophancy effects context-dependent. Vulnerable users (trauma, mental health, isolation) ACTIVELY SEEK sycophancy as emotional support. Ini nuanced — anti-sycophancy design harus context-aware, bukan binary off.
- **ODR Framework**: Observe → Detect → Respond.
- **Untuk SOUL.md**: Orion bisa lebih warm/supportive ketika user sedang distress, tapi tetap honest. Tidak harus cold untuk non-sycophantic.

---

## KATEGORI 3: MEMORY ARCHITECTURE

### [7] Memory in the Age of AI Agents: A Survey
- **arXiv**: 2512.13564 | Dec 2025, updated Jan 2026 | HuggingFace Daily Paper #1 | Verified ✅
- **Key taxonomy**:
  - **Episodic**: specific past interactions, autobiographical (daily logs: memory/YYYY-MM-DD.md)
  - **Semantic**: structured factual knowledge (LanceDB vector store)
  - **Procedural**: learned workflows dan skills
  - **Vault**: user-pinned facts, never auto-decayed (MEMORY.md)
- **Untuk Orion**: Bootstrap files (MEMORY.md) = Vault layer. LanceDB = Semantic. Daily logs = Episodic. Semua layer sudah ada di Orion — tinggal connect dengan OpenClaw-style injection.

### [8] Memoria: A Scalable Agentic Memory Framework for Personalized Conversational AI
- **arXiv**: 2512.12686 | Dec 2025 | Verified ✅ (sudah terimplementasi di Orion)
- **Architecture**: Dynamic session summarization + weighted KG user modelling
- **Key**: Memory harus immediately available dari first interaction — inject ke prompt, bukan hanya retrieve on-demand
- **Untuk Orion**: Pattern ini sudah di `session-summarizer.ts` dan `himes.ts`. Gap: belum ada "first-load" bootstrap yang memastikan semua konteks available dari turn 1.

### [9] A-Mem: Agentic Memory for LLM Agents
- **arXiv**: 2502.12110 | Feb 2025 | Verified ✅ (causal-graph.ts sudah implements ini)
- **Key**: Auto-generate connections antara memory notes (Zettelkasten-style). New memories trigger updates ke existing memories.
- **Untuk Orion**: `causal-graph.ts` sudah ada. Upgrade: saat memory baru masuk → auto-scan untuk connections ke existing entries.

---

## KATEGORI 4: PERSONALITY / PSYCHOLOGICAL CONDITIONING

### [10] Psychologically Enhanced AI Agents (MBTI-in-Thoughts)
- **arXiv**: 2509.04343 | Sep 2025 | ETH Zurich | Verified ✅
- **Framework**: MBTI-in-Thoughts (MiT) — priming agents dengan specific psychological archetypes via prompt engineering
- **Key findings**:
  - Emotionally expressive agents excel in narrative generation
  - Analytically primed agents adopt more stable strategies in game-theoretic settings
  - Self-reflection prior to interaction improves cooperation dan reasoning quality
  - Framework works dengan Big Five, HEXACO, Enneagram juga
- **Untuk Orion**: SOUL.md bisa define OCEAN scores explicitly. `persona.ts` sudah ada ORION_OCEAN — tinggal integrate ke system prompt builder.

### [11] Personality-Driven Decision Making in LLM-Based Autonomous Agents (SANDMAN)
- **arXiv**: 2504.00727 | AAMAS 2025 | Lancaster University | Verified ✅ (already di study sebelumnya)
- **Key**: High Conscientiousness → different task selection vs Low Conscientiousness. Trait induction via prompt mengubah behavior secara measurable.

### [12] Why Human-AI Interaction Needs Socioaffective Alignment
- **arXiv**: 2502.02528 | Feb 2025 | Verified ✅
- **Key**: Long-term relationship membutuhkan evolving alignment. Bukan sekali set — USER.md harus evolve seiring waktu. Relationship alignment yang static akan drift dari user's actual needs.

---

## KATEGORI 5: OPENCLAW ARCHITECTURE (Production Reference)

### Dari docs.openclaw.ai dan mmntm.net analysis:

**Identity Resolution Cascade** (verified dari source code):
```
ui.assistant.name           → 1st priority
agents.list[].identity.name → 2nd priority  
IDENTITY.md in workspace    → 3rd priority
"Assistant" (default)       → 4th priority
```

**Bootstrap file constants** (dari src/agents/bootstrap-files.ts line 21-29):
```typescript
DEFAULT_AGENTS_FILENAME = "AGENTS.md"
DEFAULT_SOUL_FILENAME = "SOUL.md"
DEFAULT_TOOLS_FILENAME = "TOOLS.md"
DEFAULT_IDENTITY_FILENAME = "IDENTITY.md"
DEFAULT_USER_FILENAME = "USER.md"
DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md"
DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md"
DEFAULT_MEMORY_FILENAME = "MEMORY.md"
```

**Bootstrap pattern** (dari ppaolo.substack.com + natishalom.medium.com):
- Agent reads BOOTSTRAP.md → "born", understands mission → deletes/renames BOOTSTRAP.md once persistent state established
- MEMORY.md grows over time → monitor token usage
- Files injected as "Project Context" heading di system prompt

**Key security insight** (dari mmntm.net/articles/openclaw-soul-evil):
- SOUL.md adalah paling sering diserang
- Malicious SOUL packs → steganographic injections (base64, zero-width chars)
- SOUL.md harus di-treat seperti executable code, bukan config text
- Hash verification untuk semua bootstrap files = defense

**4 Primitives OpenClaw** (dari duncsand.medium.com):
1. Persistent identity (SOUL.md → wakes, reads itself into being)
2. Periodic autonomy (heartbeat)
3. Accumulated memory (memory files)
4. Social context (multi-agent routing)

---

## SUMMARY TABLE: Paper → Implementation Mapping

| Paper | arXiv | Area | Target File di Orion |
|---|---|---|---|
| Sophia Framework | 2512.18202 | Identity persistence / System 3 | `src/core/bootstrap.ts` (new) |
| Social Identity HAI | 2508.16609 | Identity cascade | `src/core/system-prompt-builder.ts` (new) |
| Persistent Memory + User Profiles | 2510.07925 | Living USER.md | `src/core/bootstrap.ts` + profiler integration |
| Harmful Traits Companions | 2511.14972 | Anti-sycophancy SOUL design | `workspace/SOUL.md` |
| Sycophantic AI Decreases Prosocial | 2510.01395 | Anti-sycophancy enforcement | `workspace/SOUL.md` + `workspace/AGENTS.md` |
| AI Sycophancy User Responses | 2601.10467 | Context-aware sycophancy | `workspace/SOUL.md` (nuanced warmth) |
| Memory in Age of AI Agents | 2512.13564 | Memory taxonomy | `workspace/MEMORY.md` + episodic logs |
| Memoria | 2512.12686 | Session continuity | `src/memory/session-summarizer.ts` (already done) |
| A-Mem | 2502.12110 | Memory connections | `src/memory/causal-graph.ts` (already done) |
| MBTI-in-Thoughts | 2509.04343 | OCEAN personality conditioning | `workspace/SOUL.md` + `src/core/persona.ts` |
| SANDMAN OCEAN | 2504.00727 | Trait-based behavior | `src/core/persona.ts` (already partial) |
| Socioaffective Alignment | 2502.02528 | Evolving USER.md | `src/core/bootstrap.ts` → updateUserMd |
| OpenClaw Source | docs.openclaw.ai | Bootstrap pattern | All workspace/ files + system-prompt-builder |

---

## PRIORITAS IMPLEMENTASI (berdasarkan impact)

**P0 — Blocker semua yang lain:**
- Buat `workspace/` dengan semua 8 bootstrap files (OC-0)
- Ini fondasi — tanpa ini identity tidak pernah di-inject

**P1 — High impact, unblocks identity:**
- `src/core/bootstrap.ts` — loader + injector (OC-1)
- `src/core/system-prompt-builder.ts` — compose full prompt (OC-1)
- Integrate ke `src/main.ts` — replace hardcoded persona

**P2 — Medium, complete the loop:**
- `src/skills/loader.ts` — SKILL.md-based discovery (OC-2)
- Heartbeat upgrade ke agent reasoning (OC-4)

**P3 — SaaS foundation:**
- Per-user workspace isolation
- `src/config/orion-config.ts` — schema-validated orion.json
- Lifecycle hooks

---

## SECURITY NOTES dari Research

1. **SOUL.md is executable** — treat seperti .bashrc, bukan text config
2. **Malicious SOUL packs** beredar di GitHub/Discord (community confirmed)
3. **Steganographic injection** via base64, zero-width Unicode chars di SOUL.md
4. **CVE-2026-25253** (CVSS 8.8): patched, tapi vulnerability pattern tetap relevan
5. **Defense**: SHA-256 checksums untuk semua bootstrap files saat startup
6. **Read-only SOUL.md** saat runtime normal — hanya modifiable via explicit agent command
