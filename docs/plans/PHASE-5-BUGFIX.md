# Phase 5 — Critical Bug Fixes (5 Bugs)

**Durasi Estimasi:** 3–5 hari  
**Prioritas:** 🔴 CRITICAL — Beberapa bug ini adalah security vulnerabilities  
**Status:** 5 bugs identified, 0 fixed  

---

## 1. Ringkasan Bug

| # | Bug | Severity | File | Impact |
|---|-----|----------|------|--------|
| 1 | MemRL `nextMaxQ` wrong Bellman scope | 🟠 HIGH | memrl.ts | Memory utility scores biased, degraded retrieval quality |
| 2 | Hybrid retriever RRF threshold too low | 🟡 MEDIUM | hybrid-retriever.ts | Noise results pass filter, wasted context tokens |
| 3 | Hash fallback corrupts embedding space | 🔴 CRITICAL | store.ts | Vector search returns garbage when embeddings unavailable |
| 4 | Admin token timing side-channel | 🟡 MEDIUM | server.ts | Attacker can determine ADMIN_TOKEN length |
| 5 | Unauthenticated config write endpoints | 🔴 CRITICAL | server.ts | Any network client can overwrite entire config |

---

## 2. Bug Detail & Fix Plans

### 2.1 Bug #1 — MemRL nextMaxQ Wrong Bellman Scope

**File:** [orion-ts/src/memory/memrl.ts](../orion-ts/src/memory/memrl.ts) ~lines 375-395

**Problem:**
The Bellman Q-update computes `max Q(s', a')` using **only memories from the current feedback batch** (`uniqueIds`), not from the full memory table. This makes the Bellman target a **biased underestimate**.

```
Current (broken):                          Fixed:
─────────────────                          ─────────────────
Query: uniqueIds only                      Query: global max Q per user
→ Only 2-5 memories in batch              → Best Q across ALL memories
→ nextMaxQ biased low                      → nextMaxQ correct estimate
→ Q-values underestimate                   → Q-values converge properly
→ Memory retrieval suboptimal              → Better memory ranking
```

**Arsitektur Fix:**

```
Before:
  prisma.memoryNode.findMany({ where: { id: { in: uniqueIds } } })
    ↓
  peerMaxQ = batch_siblings.filter(same_user).map(q).max()
    ↓
  nextMaxQ = peerMaxQ (biased — small peer set)

After:
  prisma.memoryNode.findFirst({
    where: { userId: node.userId, id: { not: memoryId } },
    orderBy: { qValue: "desc" },
    select: { qValue: true, utilityScore: true }
  })
    ↓
  nextMaxQ = successor.qValue ?? successor.utilityScore ?? 0.5
```

**Exact Code Fix:**
```typescript
// Replace the per-memory nextMaxQ calculation:

// OLD (inside the loop):
const peerMaxQ = nodes
  .filter((candidate) => candidate.userId === node.userId && candidate.id !== memoryId)
  .map((candidate) => candidate.qValue ?? candidate.utilityScore)

let nextMaxQ = peerMaxQ.length > 0
  ? Math.max(...peerMaxQ)
  : Number.NaN

// NEW:
const successor = await prisma.memoryNode.findFirst({
  where: { userId: node.userId, id: { not: memoryId } },
  orderBy: { qValue: "desc" },
  select: { qValue: true, utilityScore: true },
})
const nextMaxQ = successor
  ? (successor.qValue ?? successor.utilityScore ?? 0.5)
  : 0.5
```

**Impact:** ~5 lines changed. Adds 1 DB query per memory in batch (typically 2-5 queries per feedback call). Acceptable performance since feedback is not latency-critical.

**Test:**
```typescript
it("uses global max Q for Bellman target, not batch siblings", async () => {
  // Setup: create memory with high Q that's NOT in current batch
  // Call feedback with batch that excludes high-Q memory
  // Verify nextMaxQ used the global high-Q, not batch max
})
```

---

### 2.2 Bug #2 — RRF Threshold Too Permissive

**File:** [orion-ts/src/memory/hybrid-retriever.ts](../orion-ts/src/memory/hybrid-retriever.ts) ~line 66

**Problem:**
`scoreThreshold: 0.005` is effectively a no-op. With `rrfK=60`:
- Max possible score: `0.4/61 + 0.6/61 ≈ 0.0164`
- Rank 20 FTS only: `0.4/80 = 0.005` (barely at threshold)
- Everything passes → noise in retrieved context → wasted tokens

**Arsitektur Analysis:**

```
RRF Score Formula: weight × (1 / (k + rank))

With k=60, weight_fts=0.4, weight_vec=0.6:

Rank 1 in both:   0.4/61 + 0.6/61 = 0.0164 (max)
Rank 5 in both:   0.4/65 + 0.6/65 = 0.0154
Rank 10 in both:  0.4/70 + 0.6/70 = 0.0143
Rank 20 in both:  0.4/80 + 0.6/80 = 0.0125

Rank 20 FTS only: 0.4/80 + 0     = 0.005  ← Current threshold
Rank 15 Vec only: 0     + 0.6/75 = 0.008  ← Better threshold
Rank 20 Vec only: 0     + 0.6/80 = 0.0075 ← Still passes at 0.005

Recommended: 0.008 (filters single-source rank 16+ results)
```

**Exact Code Fix:**
```typescript
// hybrid-retriever.ts line ~66
const DEFAULT_CONFIG: HybridConfig = {
  topK: 20,
  finalLimit: 10,
  rrfK: 60,
  ftsWeight: 0.4,
  vectorWeight: 0.6,
  scoreThreshold: 0.008,   // Was: 0.005 — too permissive
}
```

**Impact:** 1 line changed. Filters out ~20-30% more noise results. No API changes.

**Test:**
```typescript
it("filters results below RRF score threshold", () => {
  // Create result with score 0.006 (below new threshold)
  // Verify it's excluded from final results
})
```

---

### 2.3 Bug #3 — Hash Fallback Embedding Corruption

**File:** [orion-ts/src/memory/store.ts](../orion-ts/src/memory/store.ts) ~lines 350-390

**Problem:**
When both Ollama and OpenAI embedding providers are down, `embed()` falls back to `hashToVector()` — a **deterministic lexical hash** that produces fake embeddings. These get stored in the same LanceDB table alongside real semantic embeddings.

**Why it's critical:**
- Cosine similarity between a real 768-dim semantic vector and a hash vector is **meaningless**
- Vector search returns **random rankings** — mix of real matches and hash garbage
- User doesn't know this is happening (warning only fires every 25th call)

**Arsitektur Fix:**

```
┌─────────────────────────────────────────────────────┐
│                embed() Method                        │
│                                                      │
│  Before (broken):                                    │
│  ┌──────────┐   ┌──────────┐   ┌───────────┐      │
│  │ Ollama   │──▶│ OpenAI   │──▶│ hashToVec │      │
│  │ (768-dim)│   │ (1536-dim│   │ (fake ☠️) │      │
│  │          │   │  → resize)│   │           │      │
│  └──────────┘   └──────────┘   └───────────┘      │
│  All stored in same LanceDB table → CORRUPTED       │
│                                                      │
│  After (fixed):                                      │
│  ┌──────────┐   ┌──────────┐   ┌───────────┐      │
│  │ Ollama   │──▶│ OpenAI   │──▶│ REJECT ⛔ │      │
│  │ (768-dim)│   │ (1536-dim│   │ Throw err │      │
│  │          │   │  → resize)│   │ or skip   │      │
│  └──────────┘   └──────────┘   │ vector    │      │
│                                  │ search    │      │
│                                  └───────────┘      │
│  Memory stored as text-only (FTS still works)        │
└─────────────────────────────────────────────────────┘
```

**Exact Code Fix (Strategy A — Reject):**
```typescript
// store.ts embed() method — after OpenAI fallback fails:

// OLD:
this.recordHashFallbackEmbedding(text)
const fallback = hashToVector(text)
return fallback

// NEW:
this.hashFallbackCount++
if (this.hashFallbackCount === 1 || this.hashFallbackCount % 10 === 0) {
  log.error(
    `No embedding provider available (count: ${this.hashFallbackCount}). ` +
    "Memory will be stored without vector embedding. " +
    "Configure OLLAMA_BASE_URL or OPENAI_API_KEY for semantic search."
  )
}
throw new EmbeddingUnavailableError(
  "No embedding provider available — cannot produce vector"
)
```

**Caller Fix (where embed is called):**
```typescript
// When storing memory:
let embedding: number[] | null = null
try {
  embedding = await store.embed(content)
} catch (err) {
  if (err instanceof EmbeddingUnavailableError) {
    // Store in Prisma (FTS will work) but skip LanceDB vector insert
    log.warn("Storing memory without vector embedding")
  } else {
    throw err
  }
}

// When searching: 
// If no embedding provider → fall back to FTS-only search (already supported)
```

**Impact:** ~20 lines changed across 2 files. FTS search still works. Vector search degrades gracefully instead of returning garbage.

**Test:**
```typescript
it("throws EmbeddingUnavailableError when no provider available", async () => {
  // Mock both Ollama and OpenAI to fail
  await expect(store.embed("test")).rejects.toThrow(EmbeddingUnavailableError)
})

it("stores memory without embedding when provider unavailable", async () => {
  // Verify memory is in Prisma (text search works)
  // Verify memory is NOT in LanceDB (vector search skipped)
})
```

---

### 2.4 Bug #4 — Admin Token Timing Side-Channel

**File:** [orion-ts/src/gateway/server.ts](../orion-ts/src/gateway/server.ts) ~lines 173-190

**Problem:**
`timingSafeTokenEquals` takes a measurably different code path when token lengths differ (alloc+copy) vs. when they match (direct compare). An attacker sending tokens of varying lengths can **determine the configured ADMIN_TOKEN length**.

**Arsitektur Fix:**

```
Before (timing leak):
─────────────────────
  candidate.length ≠ expected.length?
    YES → alloc + copy + compare + return false  (slower path ⏱️)
    NO  → direct compare                         (faster path ⏱️)
  
  Timing difference reveals token length!

After (constant time):
──────────────────────
  HMAC(key, candidate) vs HMAC(key, expected)
  Both paths: hash → 32 bytes → timingSafeEqual
  
  Always same length comparison. No timing leak.
```

**Exact Code Fix:**
```typescript
// Replace entire function:

function timingSafeTokenEquals(candidate: string, expected: string): boolean {
  // HMAC both values — always produces 32-byte output
  // regardless of input length, eliminating timing side-channel
  const key = Buffer.from(expected, "utf-8") // Use expected as HMAC key
  const a = crypto.createHmac("sha256", key).update(candidate).digest()
  const b = crypto.createHmac("sha256", key).update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}
```

**Impact:** Replace ~15 lines with ~5 lines. No API changes. All callers already use this function.

**Test:**
```typescript
it("returns true for matching tokens", () => {
  expect(timingSafeTokenEquals("abc123", "abc123")).toBe(true)
})
it("returns false for non-matching tokens", () => {
  expect(timingSafeTokenEquals("abc123", "xyz789")).toBe(false)
})
it("returns false for different length tokens without timing leak", () => {
  expect(timingSafeTokenEquals("a", "abc123")).toBe(false)
})
```

---

### 2.5 Bug #5 — Unauthenticated Config Write Endpoints

**File:** [orion-ts/src/gateway/server.ts](../orion-ts/src/gateway/server.ts) ~lines 882-930

**Problem:**
`PUT /api/config`, `PATCH /api/config`, dan `POST /api/config/test-provider` have **ZERO authentication**. Any client on the network can:
- Overwrite entire configuration (inject malicious API keys)
- Disable security features
- Change gateway settings
- Test arbitrary provider API keys

**Arsitektur Fix:**

```
┌──────────────────────────────────────────────┐
│       Config Endpoint Auth Strategy           │
│                                               │
│  GET  /api/config         → No auth (read)   │
│                             (already redacted)│
│                                               │
│  PUT  /api/config         → ⛔ Requires auth │
│  PATCH /api/config        → ⛔ Requires auth │
│  POST /api/config/test-provider → ⛔ Auth    │
│                                               │
│  Auth Logic:                                  │
│  ┌─────────────────────────────────────────┐ │
│  │ 1. Check if ADMIN_TOKEN is configured   │ │
│  │    → If YES: require Bearer ADMIN_TOKEN │ │
│  │    → If NO: check if first-time setup   │ │
│  │                                          │ │
│  │ 2. First-time setup detection:          │ │
│  │    → If nova.json doesn't exist OR      │ │
│  │      has no provider keys configured    │ │
│  │    → Allow unauthenticated (setup mode) │ │
│  │    → After first config write, require  │ │
│  │      ADMIN_TOKEN for further writes     │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Exact Code Fix:**
```typescript
// Helper function:
async function requireConfigAuth(
  req: FastifyRequest, 
  reply: FastifyReply
): Promise<boolean> {
  const adminToken = process.env.ADMIN_TOKEN
  
  // If no admin token configured, check if this is first-time setup
  if (!adminToken) {
    const { readNovaConfig } = await import("../config/nova-config.js")
    const config = await readNovaConfig().catch(() => null)
    if (!config || !hasAnyProviderKey(config)) {
      // First-time setup — allow unauthenticated  
      return true
    }
    // Config exists but no ADMIN_TOKEN — block writes
    reply.code(403).send({ 
      error: "Set ADMIN_TOKEN environment variable to allow config changes" 
    })
    return false
  }
  
  // Admin token configured — verify it
  const bearer = req.headers.authorization?.replace("Bearer ", "")
  if (!bearer || !timingSafeTokenEquals(bearer, adminToken)) {
    reply.code(401).send({ error: "Invalid admin token" })
    return false
  }
  return true
}

// Apply to each endpoint:
app.put("/api/config", async (req, reply) => {
  if (!(await requireConfigAuth(req, reply))) return
  // ... existing logic
})

app.patch("/api/config", async (req, reply) => {
  if (!(await requireConfigAuth(req, reply))) return
  // ... existing logic
})

app.post("/api/config/test-provider", async (req, reply) => {
  if (!(await requireConfigAuth(req, reply))) return
  // ... existing logic
})
```

**Impact:** ~40 lines added. No breaking change for first-time setup. Existing users need ADMIN_TOKEN env var set.

**Test:**
```typescript
it("blocks config write without admin token", async () => {
  const res = await app.inject({ method: "PUT", url: "/api/config", payload: {} })
  expect(res.statusCode).toBe(401)
})

it("allows config write with valid admin token", async () => {
  process.env.ADMIN_TOKEN = "test-secret"
  const res = await app.inject({
    method: "PUT",
    url: "/api/config",
    headers: { authorization: "Bearer test-secret" },
    payload: { someKey: "value" },
  })
  expect(res.statusCode).toBe(200)
})

it("allows first-time setup without token", async () => {
  // Mock: no existing config
  const res = await app.inject({ method: "PUT", url: "/api/config", payload: {} })
  expect(res.statusCode).toBe(200)
})
```

---

## 3. Implementation Roadmap

### Day 1: Security Fixes (Bugs #4, #5)

| Task | File | Detail |
|------|------|--------|
| Fix timing side-channel | server.ts | HMAC-based comparison |
| Add config auth middleware | server.ts | requireConfigAuth() helper |
| Apply auth to PUT/PATCH/POST | server.ts | Guard all 3 endpoints |
| Tests: token comparison | __tests__/ | Equal, unequal, different length |
| Tests: config auth | __tests__/ | With/without token, first-time setup |

### Day 2: Memory Fixes (Bugs #1, #3)

| Task | File | Detail |
|------|------|--------|
| Fix MemRL Bellman scope | memrl.ts | Global max Q query per memory |
| Add EmbeddingUnavailableError | store.ts | Reject hash fallback |
| Update callers of embed() | store.ts | Graceful degradation |
| Tests: MemRL global Q | __tests__/ | Verify global lookup |
| Tests: embedding rejection | __tests__/ | Verify error + FTS fallback |

### Day 3: Retrieval Fix + Verification (Bug #2)

| Task | File | Detail |
|------|------|--------|
| Update RRF threshold | hybrid-retriever.ts | 0.005 → 0.008 |
| Verify no regression | manual test | Run sample queries, check result quality |
| All 5 bugs: regression tests | __tests__/ | Full test suite run |
| Documentation update | decisions.md | Document each fix rationale |
| tsc check | terminal | Verify 0 TS errors |

---

## 4. Android Impact

Bugs #4 dan #5 secara langsung mempengaruhi mobile app:
- **Bug #5 (config endpoints):** Mobile app bisa saja expose gateway ke network → attacker bisa overwrite config. Fix ini protects mobile users.
- **Bug #4 (timing):** Jika mobile app mengirim admin token via WebSocket, timing leak berlaku.
- **Bug #3 (embedding):** Jika user memakai mobile chat dan memory di server corrupt, semua responses degraded.

**Mobile tidak perlu diubah** — semua fixes di server side.

---

## 5. File Changes Summary

| File | Action | Lines Changed |
|------|--------|--------------|
| `src/memory/memrl.ts` | Fix Bellman nextMaxQ query | ~10 |
| `src/memory/hybrid-retriever.ts` | Update scoreThreshold | 1 |
| `src/memory/store.ts` | Reject hash fallback, add error class | ~25 |
| `src/gateway/server.ts` | Fix timing comparison, add config auth | ~50 |
| `src/__tests__/memrl-bellman.test.ts` | NEW: Bellman scope test | ~30 |
| `src/__tests__/embedding-fallback.test.ts` | NEW: Hash rejection test | ~25 |
| `src/__tests__/config-auth.test.ts` | NEW: Config auth tests | ~40 |
| **Total** | | **~181 lines** |
