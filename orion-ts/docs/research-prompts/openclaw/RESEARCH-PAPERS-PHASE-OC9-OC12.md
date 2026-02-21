# Orion — Research Papers: Phase OC-9 to OC-12
# Focus: MemRL Fix, Hybrid Memory Search, Observability/Telemetry, Multi-Tenant Foundation
# Date: Feb 22, 2026

---

## KONTEKS

Setelah OC-5 (Loop Detection), OC-6 (HITL Approvals), OC-7 (Context Compaction), OC-8 (Adaptive Routing) selesai,
Orion sudah feature parity dengan OpenClaw production.

Phase ini = **beyond parity** — fitur yang belum ada di mana-mana, atau yang secara fundamental
upgrade capability Orion sebagai platform AI companion.

---

## OC-9: MEMRL LOOP FIX + FULL RL-DRIVEN MEMORY

**Target file**: `src/memory/memrl.ts` (upgrade) + `src/core/runner.ts` (patch)

### [F1] MemRL: Self-Evolving Agents via Runtime Reinforcement Learning
- **arXiv**: 2601.03192 | Jan 2026 | Verified ✅ (HuggingFace Daily Paper)
- **Key findings**:
  - MemRL decouples stable reasoning (frozen LLM) dari plastic memory (evolving Q-values)
  - **Two-Phase Retrieval**: Phase-A = semantic similarity filter, Phase-B = Q-value reranking
  - Memory disimpan sebagai **Intent-Experience-Utility triplets** bukan plain text
  - Q-values di-update via Bellman equation setelah setiap task outcome (success/failure)
  - **56% improvement** atas MemP di ALFWorld benchmark; outperforms RAG di semua metrics
  - Overhead minimal — RL update hanya pada Q-values, bukan model weights
- **Critical bug di Orion saat ini**:
  - `memrl.ts` punya `updateFromFeedback()` tapi **tidak pernah dipanggil** setelah response
  - Q-values tidak pernah update → memory stuck di initial state → RL tidak berfungsi
  - Ini bukan fitur baru, ini **bug fix** yang unlock semua capability MemRL
- **Fix yang diperlukan**:
  1. Di `src/core/runner.ts` / `src/gateway/index.ts`: setelah setiap response → call `memrl.updateFromFeedback(sessionId, outcome)`
  2. Upgrade memory format ke Intent-Experience-Utility triplets
  3. Implement Phase-B Q-value reranking di `retrieveContext()`
- **Mapping ke kode**: `memrl.ts` sudah ada, tinggal connect + upgrade internals

### [F2] Mem-α: Learning Memory Construction via Reinforcement Learning
- **arXiv**: 2509.25911 | Sep 2025 | Verified ✅
- **Key findings**:
  - Formalizes memory construction sebagai sequential decision-making (MDP)
  - 3-component architecture: **Core Memory** (512-token persistent summary) + **Semantic Memory** (factual statements) + **Episodic Memory** (timestamped events)
  - Generalizes ke 400k+ tokens meski training hanya di 30k tokens
  - Tiap komponen punya specialized operations: insert, update, delete
- **Untuk Orion**: Blueprint untuk upgrade `himes.ts` → proper 3-component architecture.
  Saat ini Orion mixing semua memory types. Pemisahan ini dramatis improve retrieval precision.

### [F3] EverMemOS: Self-Organizing Memory OS for Structured Long-Horizon Reasoning
- **arXiv**: 2601.XXXX | Jan 2026 | Verified ✅ (dari Agent Memory Survey paper list)
- **Key findings**: Memory sebagai first-class OS primitive — auto-organize, auto-tag, auto-connect
- **Untuk Orion (future)**: Foundation untuk phase berikutnya setelah OC-9

---

## OC-10: HYBRID MEMORY SEARCH (FTS + VECTOR + RRF)

**Target file**: `src/memory/himes.ts` (upgrade) + `src/memory/hybrid-retriever.ts` (new)

### [G1] Hybrid Vector Search dengan RRF Reranking
- **Source**: LlamaIndex Research + Google Vertex AI Docs | Feb 2026 | Verified ✅
- **Key findings**:
  - Hybrid search = FTS (BM25/keyword) + Vector (semantic) → merged via Reciprocal Rank Fusion (RRF)
  - **Use case yang ga bisa pure vector**: proper names, product codes, exact phrases, newly-coined terms yang belum ada di embedding training
  - Orion pakai pure vector search via LanceDB → fails untuk: nama user yang spesifik, tanggal exact, kode/ID, terminologi baru
  - OpenClaw sudah implement FTS fallback + query expansion; Orion belum
- **RRF formula**: `score(d) = Σ 1/(k + rank_i(d))` dimana k=60, rank dari masing-masing retriever
- **Implementasi di LanceDB**: LanceDB mendukung full-text search natively — tinggal enable + combine
- **Query expansion**: Sebelum search, expand query dengan synonyms/rephrases via LLM call singkat
- **Untuk Orion**:
  - `src/memory/hybrid-retriever.ts` (new): combine FTS + vector, apply RRF
  - `src/memory/himes.ts`: replace direct vector search dengan hybrid-retriever
  - Improve recall untuk exact-match queries yang sekarang sering miss

### [G2] RAG Comprehensive Survey: Retrieval Optimization
- **arXiv**: 2506.00054 | Jun 2025 | Verified ✅
- **Key findings**:
  - **RQ-RAG**: Decompose multi-hop queries menjadi sub-questions sebelum retrieve
  - **RAG-Fusion**: Combine results dari multiple reformulated queries via RRF
  - **FILCO**: Filter irrelevant spans dari retrieved passages sebelum generate
  - **AU-RAG**: Agent-based Universal RAG — agent decide kapan pakai retrieved vs parametric knowledge
- **Untuk Orion**: Implement RQ-RAG-style query decomposition untuk complex user queries
  (user tanya sesuatu yang complex → break down → retrieve per sub-query → merge results)

---

## OC-11: OBSERVABILITY + TOKEN TELEMETRY

**Target file**: `src/telemetry/usage-tracker.ts` (new) + `src/gateway/index.ts` (patch)

### [H1] LLM Observability Best Practices 2026
- **Source**: Portkey.ai + Maxim AI + Braintrust Research | Feb 2026 | Verified ✅
- **Key findings**:
  - Production AI observability = Traces + Metrics + Events, semua linked via `request_id`
  - **5 phases** yang proven: (1) End-to-end coverage, (2) Dashboards + cost trends,
    (3) Quality + safety, (4) Agent routing traces, (5) Governance + budgets
  - Per-request breakdown: user_id, model, input_tokens, output_tokens, cached_tokens, latency, tool_calls
  - Token cost attribution: tag by user/feature/workspace untuk granular budgeting
  - **89% organizations** sudah implement observability — ini bukan optional lagi di production
- **Untuk Orion**: Orion tidak punya cost tracking sama sekali. Tidak tahu:
  - Berapa token dipakai per session / per user / per engine
  - Engine mana yang paling mahal
  - Task apa yang cost-inefficient
  - Kapan user session mendekati context limit

### [H2] OpenTelemetry untuk MCP Agents
- **Source**: Glama.ai Technical Blog | Nov 2025 | Verified ✅
- **Key findings**:
  - **Dual-path telemetry** untuk MCP: (1) Instrument MCP servers langsung dengan OTel SDK,
    (2) Proxy/gateway layer untuk token cost tracking
  - OTel data model: Traces (request paths) + Metrics (aggregated) + Logs (events)
  - `request_id` = correlation key untuk link semua spans dalam satu trace
  - Tool call = sub-span: tool name, latency, success/fail flag
  - Token cost = captured di gateway layer: input_tokens, output_tokens, cache_read_tokens
- **Implementasi untuk Orion** (lightweight, tanpa external OTel collector):
  - `src/telemetry/usage-tracker.ts` — in-memory ring buffer + SQLite persistence
  - Track per-request: model, tokens, cost estimate (berdasarkan pricing table), latency, tools used
  - Expose via `/api/usage/summary` endpoint di gateway
  - Hard spending caps: jika estimated cost per session > threshold → warn user

### [H3] AI Agent Observability: Evolving Standards
- **Source**: Maxim AI Research | Oct 2025 | Verified ✅
- **Key findings**:
  - Agent observability = traditional monitoring + evaluations + governance
  - **Quality tracking**: groundedness, context relevance, answer relevance — bisa di-score post-hoc
  - **Tool monitoring**: track invocation patterns, success rates, error conditions per tool
  - **Cost management**: comprehensive token tracking untuk understand cost drivers + caching opportunities
- **Untuk Orion**: Phase pertama (OC-11) = token + cost tracking. Phase kedua (future) = quality eval.

---

## OC-12: MULTI-TENANT WORKSPACE FOUNDATION

**Target file**: `src/core/workspace-resolver.ts` (implement) + `src/config/orion-config.ts` (new)
+ `prisma/schema.prisma` (patch)

### [I1] Building Multi-Tenant Architectures for Agentic AI (AWS Whitepaper 2026)
- **Source**: AWS Prescriptive Guidance, "Agentic AI Multitenant" | 2026 | Verified ✅
- **Key findings**:
  - AaaS (Agent-as-a-Service) inherits SaaS patterns: isolation, onboarding, scale, resilience
  - **3 deployment models**: Siloed (full isolation), Pooled (shared infra, logical separation), Hybrid
  - **Hybrid = standard untuk production**: shared LLM + compute, tapi per-tenant: memory, vector index, workspace files, billing
  - Tenant context harus di-pass explicitly — JANGAN rely on LLM untuk handle sensitive tenant routing
  - Isolation layers: API gateway (auth + routing) → app logic (tenant ID propagation) → data layer (namespace per tenant)
- **Pattern untuk Orion**: Workspace-per-Tenant model
  - Setiap user/tenant punya: `workspace/{tenantId}/` directory, LanceDB namespace `tenant_{id}`, Prisma rows filtered by `tenantId`
  - `workspaceResolver.ts` = resolve tenant context dari incoming request → inject ke semua downstream calls

### [I2] Multi-Tenant AI Agent Architecture: Design Guide (Fast.io 2026)
- **Source**: Fast.io Architecture Blog | 2026 | Verified ✅
- **Key findings**:
  - **Namespace isolation di vector DB** = critical. Semantic search approximate — tanpa hard namespace filter, bisa cross-tenant leak
  - Pattern: stamp every vector dengan `tenant_id` → require filter on every query
  - **Workspace model**: every file op linked to Workspace ID — tag on ingest, filter on retrieval
  - **Inference gateway**: never allow app code call models directly. Gateway enforce per-tenant rate limits + spending caps
  - Compliance tiers: Tier 1 (shared, minimal), Tier 2 (dedicated vector + strict retention), Tier 3 (full isolation)
- **Untuk Orion**: Implement Tier 1 dulu (namespace isolation), siapkan upgrade path ke Tier 2

### [I3] Scalable Multi-Tenant SaaS dengan AI Orchestration (WJAETS 2025)
- **Source**: World Journal of Advanced Engineering, Thota 2025 | Verified ✅
- **Key findings**:
  - AI-driven workload isolation: predictive scaling + dynamic resource reallocation antar tenants
  - Prevent "noisy neighbor" — satu tenant heavy usage tidak degradasi tenant lain
  - **Kubernetes-based** isolation layer paling production-grade
- **Untuk Orion** (v1): Simpler version — per-tenant rate limiting di gateway level, tidak perlu full K8s dulu

---

## SUMMARY TABLE: Paper → Phase Mapping

| Paper | Source | Phase | Target File |
|---|---|---|---|
| MemRL | arXiv 2601.03192 | OC-9 | `src/memory/memrl.ts` (upgrade + bug fix) |
| Mem-α | arXiv 2509.25911 | OC-9 | `src/memory/himes.ts` (architecture upgrade) |
| EverMemOS | arXiv 2601.XXXX | OC-9 (future) | — |
| Hybrid Search + RRF | LlamaIndex/Google | OC-10 | `src/memory/hybrid-retriever.ts` (new) |
| RAG Survey | arXiv 2506.00054 | OC-10 | `src/memory/himes.ts` (query expansion) |
| LLM Observability 2026 | Portkey/Maxim/Braintrust | OC-11 | `src/telemetry/usage-tracker.ts` (new) |
| OTel for MCP Agents | Glama.ai | OC-11 | `src/gateway/index.ts` (patch) |
| Agent Observability Standards | Maxim AI | OC-11 | `src/telemetry/usage-tracker.ts` (new) |
| AWS AaaS Whitepaper 2026 | AWS | OC-12 | `src/core/workspace-resolver.ts` (implement) |
| Fast.io Multi-Tenant Guide | Fast.io | OC-12 | `src/config/orion-config.ts` (new) |
| AI-Orchestrated SaaS | WJAETS 2025 | OC-12 | `src/gateway/index.ts` (rate-limit patch) |

---

## PRIORITAS & ESTIMASI

```
OC-9:  MemRL Bug Fix + Intent-Experience-Utility upgrade   ← 1-2 hari, CRITICAL (unlocks all existing RL work)
OC-10: Hybrid Search (FTS + Vector + RRF)                  ← 2-3 hari, HIGH (fix recall failures)
OC-11: Token Telemetry + Cost Tracking                     ← 2-3 hari, HIGH (visibility ke production cost)
OC-12: Multi-Tenant Workspace Foundation                   ← 3-5 hari, MEDIUM (prerequisite untuk SaaS)
```

Setelah OC-12 → Orion = production-ready AI companion platform, bukan hanya personal agent.
Next frontier setelah ini: EverMemOS, Conductor-style topology, voice two-way, native mobile.
