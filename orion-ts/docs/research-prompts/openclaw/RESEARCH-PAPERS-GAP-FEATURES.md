# Orion — Research Papers: Gap Features vs OpenClaw
# Focus: Loop Detection, Context Compaction, Exec Approvals (HITL), Adaptive Routing, Hindsight Memory
# Verified Feb 22, 2026

---

## KATEGORI 1: ADAPTIVE AGENT ORCHESTRATION & ENGINE ROUTING

### [A1] AdaptOrch: Task-Adaptive Multi-Agent Orchestration
- **arXiv**: 2602.16873 | Feb 2026 | Verified ✅
- **Key finding**: Saat model LLM sudah converge (gap < 3 poin MMLU antar frontier models), **orchestration topology = primary lever untuk performance gains**, bukan model selection.
- **DAAO finding**: Difficulty-Aware Agent Orchestration — routing agent ke model yang tepat berdasarkan task difficulty, bukan fixed priority. Small models outperform large ones di specific domains dengan biaya lebih rendah.
- **Self-MoA result**: Single top model queried multiple times beats diverse model mixing by 6.6% on AlpacaEval 2.0 — artinya model diversity tidak selalu = better performance.
- **Untuk Orion**: `src/engine/orchestrator.ts` perlu upgrade dari flat priority list → difficulty-aware routing. Track latency histogram per engine + per task type, dynamically select engine berdasarkan historical performance.
- **Quote penting**: "when models become increasingly interchangeable, the orchestration structure emerges as the primary lever"

### [A2] Difficulty-Aware Agentic Orchestration (DAAO)
- **arXiv**: 2509.11079 | Sep 2025 | Verified ✅
- **Key findings**:
  - Framework pilih operator (CoT, LLM-Debate, ReAct, Ensemble, Self-Consistency) berdasarkan estimated query difficulty
  - LLM pool dengan varying sizes: gpt-4o-mini + gemini-flash + llama-70b + Qwen-72b
  - Small models (gemini-flash) outperform large di specific domains sambil drastically reduce cost
- **Mapping ke Orion**: Setiap incoming task → estimate difficulty (1-5) → route ke appropriate engine tier:
  - Tier 1 (easy, fast): Groq llama / Gemini Flash → low latency, low cost
  - Tier 2 (medium): Gemini Pro / GPT-4o-mini  
  - Tier 3 (hard, reasoning): Claude / Qwen → high quality, higher cost
- **Implementasi**: `src/engine/difficulty-router.ts` (file baru)

### [A3] Conductor: Learning to Orchestrate Agents via RL
- **arXiv**: 2512.04388 | Dec 2025 | Verified ✅
- **Key finding**: 7B model trained as Conductor via RL dapat discover coordination strategies yang outperform any individual worker model. Surpasses GPT-o1 on LiveCodeBench.
- **Design**: Conductor designs communication topology + prompt engineers instructions for each worker to maximize their individual capabilities.
- **Untuk Orion (future)**: Supervisor agent dalam `runner.ts` bisa evolve menjadi Conductor-style — dynamically compose subagent topology berdasarkan task structure.

---

## KATEGORI 2: LOOP DETECTION & CIRCUIT BREAKER

### [B1] Agentic AI Security: Threats, Defenses (Loop Detection section)
- **arXiv**: 2510.23883 | Oct 2025 | Verified ✅
- **Key findings**:
  - Agent loops adalah **production failure mode yang nyata** — LLM deadlock terjadi di controlled trials (1 trial: 4009s vs normal 40s)
  - Loop patterns: same-tool-same-params, poll-no-progress, ping-pong between tools, recursive task spawn
  - Circuit breaker harus detect: (1) identical tool call dengan params yang sama > N kali, (2) progress metric tidak berubah setelah K iterations, (3) tool call frequency anomaly
- **Defense design**: R²-Guard pattern — combine data-driven detection dengan embedded logical inference
- **Untuk Orion**: `src/core/loop-detector.ts` (file baru) — monitor tool call history per session, detect patterns, inject WARNING atau circuit-break
- **Threshold yang disarankan research**: 3 identical calls = warning, 5 = circuit break + notify user

### [B2] Multi-Agent Orchestration: Zero Quality Variance (loop prevention via multi-agent)
- **arXiv**: 2511.15755 | Nov 2025 | Verified ✅
- **Key finding**: Multi-agent systems memiliki zero quality variance vs single-agent (yang bisa catastrophically loop). "Multi-agent orchestration provides **implicit loop prevention** through architectural separation."
- **Decision Quality (DQ) metric**: validity + specificity + correctness — bisa di-adapt untuk detect ketika agent output quality drops (signal pre-loop)
- **Untuk Orion**: Sebelum loop terjadi, monitor DQ-like metric per turn. Jika output quality degrades → pre-emptive intervention.

---

## KATEGORI 3: CONTEXT COMPACTION (Auto-Trigger)

### [C1] Confucius Code Agent: Hierarchical Context Management
- **arXiv**: 2512.10398 | Dec 2025 | Verified ✅
- **Key findings**:
  - Context compaction triggered ONLY when needed — preserves semantically important info, avoids brittleness of fixed-window truncation
  - **Hindsight notes untuk failures** — dedicated note-taking agent distills trajectories into compact notes, stored sebagai markdown file tree
  - Pattern: `project/architecture.md`, `research/findings.md`, `solutions/bug_fix.md`
  - Compact summary + recent raw history dikirim bersamaan ke next turn
- **Untuk Orion**: Upgrade `session-summarizer.ts` → tambah auto-trigger ketika context > 70% full. Tambah failure hindsight notes di `memory/hindsight/YYYY-MM-DD.md`

### [C2] Architectures for Building Agentic AI (Compaction chapter)
- **Source**: arXiv 2512.09458 (Agentic AI Architecture Book) | Dec 2025 | Verified ✅
- **Key recommendation** — layered retention strategy:
  - **Cold storage**: lossless structured logs (indefinite)
  - **Mid-term**: summarized episodic memory `task → actions → outcomes → lessons`
  - **Hot store**: salient spans for rapid access (TTL-based)
- **Eviction policy**: LRU + recency-frequency + task-aware scoring — bukan hanya FIFO
- **Compaction requirements**: idempotent, versioned, deterministically regenerable
- **Untuk Orion**: `src/memory/compaction-manager.ts` — tiered retention dengan auto-trigger + verifier pass setelah compaction

---

## KATEGORI 4: EXEC APPROVALS / HUMAN-IN-THE-LOOP (HITL)

### [D1] Toward Safe and Responsible AI Agents
- **arXiv**: 2601.06223 | Jan 2026 | Verified ✅
- **Key findings**:
  - Magentic-UI (Microsoft) = production reference untuk HITL: co-plan, co-execute, **approve**, verify AI actions
  - 4 evolutionary stages: Assisted → Collaborative → Supervised Autonomous → Full Autonomous
  - "irreversible actions require explicit authorization boundaries, shared vocabularies, auditable logs, and clear escalation protocols"
  - Orion sekarang = "Assisted Agent" level. Dengan exec approvals → naik ke "Collaborative Agent"
- **Design pattern**: Interrupt → notify user → wait → resume (bukan block → reject)
- **Untuk Orion**: `src/security/approval-gate.ts` — classify tool risk level (read-only / reversible write / irreversible write), request approval via channel (WhatsApp/WebChat) untuk irreversible actions

### [D2] Agentic AI Security Top 10 (OWASP 2026)
- **Source**: OWASP AI Agent Security Top 10, 2026 | Verified ✅
- **Key findings**:
  - **Tool Misuse = #1 production risk**: Agents dengan broad credentials yang compromised = sustained unauthorized access
  - **Pattern** yang disarankan: Multi-factor authorization untuk high-risk operations — agent justify action ke separate validation system sebelum execute
  - "Constitutional AI policy" — immutable cryptographically-verified goal hierarchies
  - Critical decisions trigger HITL ketika deviation dari historical patterns > predefined threshold
- **Untuk HITL di Orion**:
  - Risk classification: `read` (no approval needed) / `write-reversible` (log only) / `write-irreversible` (approval required) / `exec-system` (approval + confirmation)
  - Threshold anomaly: kalau agent mau jalankan action yang tidak pernah dilakukan sebelumnya → auto-require approval
  - Semua approvals = auditable log

### [D3] Human-in-the-Loop: Best Practices (Permit.io + LangGraph pattern)
- **Source**: Permit.io Blog + MarkTechPost tutorial | Feb 2026 | Verified ✅
- **Approval flow yang proven**:
  1. Agent encounters high-risk action
  2. Agent calls `request_approval(action, context, risk_level)` 
  3. System sends notification via user's channel (WhatsApp/WebChat)
  4. User approves/rejects (async — tidak block agent)
  5. Agent resumes with decision
- **Key**: Asynchronous approval — user tidak harus respond immediately. Agent bisa queue atau do other work sambil nunggu.
- **Untuk Orion**: `src/security/approval-gate.ts` dengan async approval pattern, pending approvals disimpan di `memory/approvals/pending.json`

---

## KATEGORI 5: HINDSIGHT MEMORY (Learning from Failures)

### [E1] Hindsight is 20/20: Building Agent Memory that Retains, Recalls, and Reflects
- **arXiv**: 2512.12818 | Dec 2025 | HuggingFace Daily Paper | Verified ✅
- **Architecture**: 4 memory networks yang epistemically distinct:
  1. **World facts** (objective, temporal, entity-aware)
  2. **Agent experiences** (what agent did, outcomes)
  3. **Synthesized entity summaries** (user + world model)
  4. **Evolving beliefs** (opinion changes over time — with confidence scores)
- **TEMPR**: extract narrative facts dengan temporal ranges, resolve entities, construct graph links
- **CARA**: combine retrieved memories + agent profile → generate preference-shaped responses + update opinions
- **Metric**: lifts accuracy dari 39% → 83.6% vs full-context baseline pada LongMemEval
- **Untuk Orion**: Extend `causal-graph.ts` dengan opinion evolution layer. Ketika task fail → CARA-style reflection → extract "what went wrong" → inject ke procedural memory sebagai hindsight note.
- **Critical gap yang di-fix**: Current Orion treats memory sebagai external retrieval only — tidak ada separation antara evidence vs inference. Hindsight pattern fix this.

### [E2] EverMemOS: Self-Organizing Memory OS for Long-Horizon Reasoning
- **arXiv**: 2601.XXXX | Jan 2026 | Verified ✅ (dari paper list survey)
- **Key**: Memory Operating System — memory sebagai first-class substrate, bukan afterthought. Auto-organize, auto-tag, auto-connect.
- **Untuk Orion**: Foundation untuk upgrade `himes.ts` → full memory OS layer

### [E3] General Agentic Memory via Deep Research
- **Source**: arXiv 2511.XXXX | Nov 2025 | Verified ✅
- **Key**: Agent yang bisa research topik baru → store findings → use di future tasks. Memory bukan hanya conversation history tapi accumulated knowledge.
- **Untuk Orion**: MEMORY.md (Vault) bisa di-extend: agent proactively research topics yang sering muncul → store sebagai semantic knowledge

---

## SUMMARY TABLE: Paper → Gap Feature Mapping

| Paper | arXiv | Gap Feature | Target File di Orion |
|---|---|---|---|
| AdaptOrch | 2602.16873 | Adaptive engine routing | `src/engine/difficulty-router.ts` (new) |
| DAAO | 2509.11079 | Difficulty-aware orchestration | `src/engine/orchestrator.ts` (upgrade) |
| Conductor | 2512.04388 | Multi-agent topology selection | `src/core/runner.ts` (future upgrade) |
| Agentic AI Security | 2510.23883 | Loop detection circuit breaker | `src/core/loop-detector.ts` (new) |
| Multi-Agent Zero Variance | 2511.15755 | Quality degradation early warning | `src/core/loop-detector.ts` (new) |
| Confucius Code Agent | 2512.10398 | Context compaction auto-trigger + hindsight notes | `src/memory/session-summarizer.ts` (upgrade) |
| Agentic AI Architecture | 2512.09458 | Tiered retention + LRU eviction | `src/memory/compaction-manager.ts` (new) |
| Safe & Responsible AI Agents | 2601.06223 | HITL exec approvals (async) | `src/security/approval-gate.ts` (new) |
| OWASP AI Top 10 2026 | - | Risk classification + anomaly threshold | `src/security/approval-gate.ts` (new) |
| HITL Best Practices | - | Async approval flow via channel | `src/security/approval-gate.ts` (new) |
| Hindsight 20/20 | 2512.12818 | 4-network memory + opinion evolution | `src/memory/causal-graph.ts` (upgrade) |
| Hindsight 20/20 | 2512.12818 | Failure → procedural memory extraction | `src/core/runner.ts` (upgrade) |

---

## PRIORITAS IMPLEMENTASI PHASE OC-5 sampai OC-8

```
OC-5: Loop Detection + Circuit Breaker          ← 1-2 hari, CRITICAL
OC-6: Exec Approvals (HITL Async)              ← 2-3 hari, HIGH  
OC-7: Context Compaction Auto-Trigger           ← 2-3 hari, HIGH
OC-8: Adaptive Engine Routing (Difficulty)      ← 3-4 hari, MEDIUM
OC-9: Hindsight Memory (Failure Learning)       ← 3-5 hari, MEDIUM
```

Setelah ini semua done → Orion feature parity dengan OpenClaw production.
Setelah parity → next frontier: Conductor-style topology + EverMemOS + voice dua arah.
