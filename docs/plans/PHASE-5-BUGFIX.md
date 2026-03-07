# Phase 5 — Critical Bug Fixes (5 Bugs)

> *"I found the problem. It's not one problem. It's five. And three of them would've taken EDITH down from the outside."*
> *"Then we fix all five. Right now. And we do it right — karena ini bakal jalan di HP dengan RAM 1GB."*

**Durasi Estimasi:** 3–5 hari
**Prioritas:** 🔴 CRITICAL — 2 bug adalah security vulnerabilities aktif
**Status:** 5 bugs identified, 0 fixed
**Target Hardware:** HP (min 1GB RAM) + Laptop — semua fix harus memory-conscious

---

## Cara Tony Stark Approach Bug Fixing

Tony tidak approach bug sebagai list todo. Dia approach sebagai failure analysis — kayak waktu dia debug Mark II kenapa beku di stratosphere. Pertanyaannya bukan "apa yang salah?" tapi **"kalau ini tidak di-fix, seberapa parah konsekuensinya?"**

Dan ada satu constraint yang selalu Tony pegang saat build untuk field deployment: **"Ini harus jalan di hardware yang ada di tangan orang biasa."** Mark I dibuat di gua dengan scrap metal. EDITH harus jalan di HP dengan 1GB RAM.

Dari 5 bug di sini, urutan prioritas Tony adalah:
1. **Security dulu** (Bug #4, #5) — ini kalau dibiarkan, sistem bisa dikompromis dari luar
2. **Data integrity** (Bug #3) — ini silent corruption, paling berbahaya karena tidak kelihatan — **dan punya implikasi memory besar di 1GB environment**
3. **Logic correctness** (Bug #1) — systematic bias yang semakin buruk seiring waktu
4. **Tuning** (Bug #2) — 1 baris, tapi berdampak ke kualitas retrieval setiap hari

Fix yang benar bukan cuma "make it work". Fix yang benar adalah yang bekerja dengan alasan yang bisa dijelaskan dari first principles, **dan tidak menyebabkan OOM di HP 1GB RAM.**

---

## 1. Landasan Riset — Paper & Standards

---

### Paper 1: ShiQ — Bringing Back Bellman to LLMs (arXiv:2505.11081, May 2025)

**Relevansi:** Bug #1 — Bellman equation scope

**Apa isinya:**
ShiQ mengambil pendekatan Q-learning yang sudah terbukti di non-LLM RL tasks dan mengadaptasinya ke LLMs melalui loss functions yang theoretically grounded dari Bellman equations. Paper ini secara eksplisit membuktikan bahwa estimasi Q-value hanya valid jika operator `max` dihitung dari **seluruh valid next state space**, bukan dari subset batch saat ini. Mini-batch Q-estimation adalah known anti-pattern yang menghasilkan biased underestimate dan degradasi memory ranking secara perlahan. ShiQ juga membuktikan bahwa multi-step extension (LShiQ) mempropagasi rewards lebih efektif, tapi untuk fix Bug #1 kita cukup perbaiki single-step Bellman scope dulu — foundational correctness sebelum optimasi.

**Yang EDITH adopt:**
- Global DB query untuk `nextMaxQ`, bukan sibling batch lookup
- Feedback loop adalah offline operation — extra 1 DB query per memory acceptable, tidak ada latency issue di 1GB device

---

### Paper 2: TBRM — Trajectory Bellman Residual Minimization (arXiv:2505.15311, May 2025)

**Relevansi:** Bug #1 — konfirmasi global scope sebagai non-negotiable

**Apa isinya:**
TBRM memperkenalkan algoritma yang mengoptimasi single trajectory-level Bellman objective menggunakan logits model sendiri sebagai Q-values tanpa critics, importance-sampling ratios, atau clipping. Yang kita ambil dari paper ini adalah konfirmasi teoritik: Bellman residual yang dihitung dari subset data menghasilkan **biased estimates** yang menyebabkan suboptimal policy convergence. Ini bukan minor rounding error — ini systematic bias yang akumulasi semakin buruk seiring bertambahnya memory nodes. Di 1GB device dengan database memory yang terbatas, bias ini justru lebih merusak karena populasi node yang kecil membuat sample variance dari mini-batch semakin tinggi.

**Yang EDITH adopt:**
- Justifikasi teoritik mengapa global query adalah satu-satunya pilihan yang benar
- Memory-efficient query: `findFirst` dengan `orderBy: qValue DESC` + `select: { qValue: true }` — minimal data fetch, tidak load seluruh row

---

### Paper 3: RAG-Fusion & Hybrid Retrieval Analysis (arXiv, 2024)

**Relevansi:** Bug #2 — RRF threshold tuning

**Apa isinya:**
Analysis of Fusion Functions for Hybrid Retrieval membuktikan secara matematis bahwa distribusi skor RRF (Reciprocal Rank Fusion) memiliki upper bound yang bisa dihitung dari parameter `k` dan `weight`. Dengan `k=60`, skor maksimum teoritis adalah `weight_total / (k+1) = 1.0/61 ≈ 0.0164`. Threshold `0.005` yang dipakai sekarang hanya menyaring dokumen yang muncul di rank 80+ di satu source — yang artinya hampir tidak menyaring apapun. RAG-Fusion paper menunjukkan bahwa noise dalam retrieved context adalah biaya tersembunyi yang sering diabaikan: setiap token noise yang masuk ke prompt adalah token yang tidak berguna, dan di 1GB device dengan local LLM yang context window-nya terbatas, **token waste adalah memory waste**.

**Yang EDITH adopt:**
- Threshold `0.008`: menyaring dokumen yang hanya muncul di rank 16+ di single-source
- Justifikasi: di 1GB environment, kualitas > kuantitas retrieval — lebih baik 5 hasil relevan dari 20 noisy

---

### Paper 4: EmbeddingGemma — On-Device Embeddings (Google DeepMind, Sep 2025)

**Relevansi:** Bug #3 — pilihan model embedding yang tepat untuk 1GB RAM

**Apa isinya:**
EmbeddingGemma adalah model embedding baru dari Google yang dirancang khusus untuk on-device AI — dengan 308M parameter, ia berjalan di kurang dari 200MB RAM dengan quantization. Yang membuat ini revolusioner untuk EDITH adalah tiga hal. **Pertama**, EmbeddingGemma dilatih pada 100+ bahasa dan merupakan model embedding multilingual open-source terbaik di bawah 500M parameter pada benchmark MTEB. Ini berarti Bahasa Indonesia di-support dengan baik — sesuatu yang `all-MiniLM-L6-v2` tidak offer. **Kedua**, EmbeddingGemma menggunakan Matryoshka Representation Learning untuk menyediakan beberapa ukuran embedding dari satu model — developer bisa truncate dari 768 ke 128 dimensi untuk kecepatan lebih tinggi dan storage lebih rendah. **Ketiga**, EmbeddingGemma mendukung framework populer seperti transformers.js, Ollama, LlamaIndex, dan LangChain — integrasi dengan stack EDITH yang ada sangat straightforward.

**Yang EDITH adopt:**
- EmbeddingGemma (256-dim mode) sebagai **primary local embedding model** menggantikan `all-MiniLM-L6-v2` di Phase 9
- 256-dim: balance terbaik antara quality dan storage untuk 1GB device
- Bisa jalan via `@xenova/transformers` (transformers.js) tanpa backend Python
- Bug #3 fix: ketika embedding provider tidak tersedia, **reject dan simpan ke FTS-only** — jangan fake dengan hash vector

---

### Paper 5: Embedding Drift / Silent Corruption in Vector DBs (Research, 2024)

**Relevansi:** Bug #3 — mengapa hash fallback adalah racun di vector space

**Apa isinya:**
Research tentang embedding drift menunjukkan bahwa mencampur vektor dari distribusi yang berbeda dalam satu vector database secara fundamental merusak jaminan matematika dari cosine similarity. Semantic embeddings dari model seperti `all-MiniLM` atau EmbeddingGemma mengisi ruang vektor secara konsisten — distribusinya clustered dan meaningful. Hash vectors mengisi ruang vektor secara pseudo-random dan uniform. Ketika keduanya dicampur dalam satu LanceDB table, cosine similarity antara query embedding dan hash vector menghasilkan skor yang **random tapi tampak confident** — tidak ada cara bagi retriever untuk tahu mana yang genuine semantic match dan mana yang garbage. Di 1GB device yang bergantung pada local retrieval karena offline mode, ini adalah bencana silent yang memperburuk kualitas responses secara bertahap.

**Yang EDITH adopt:**
- Strict rejection: `hashToVector()` dihapus dari fallback path
- Error class baru: `EmbeddingUnavailableError` untuk signal callers dengan clean
- Graceful degradation: FTS (full-text search) tetap berjalan — EDITH masih bisa retrieve, tapi hanya via keyword match

---

### Paper 6: CWE-208 — Observable Timing Discrepancy (MITRE)

**Relevansi:** Bug #4 — timing side-channel di token comparison

**Apa isinya:**
CWE-208 mendokumentasikan bagaimana perbedaan waktu eksekusi yang observable dapat mengekspos informasi rahasia. Untuk string comparison, early-exit saat panjang berbeda membocorkan panjang token rahasia — attacker bisa binary-search panjang token hanya dengan mengukur response time. Solusinya: **HMAC-based comparison** — hash kedua nilai dengan key yang sama, lalu bandingkan digest yang selalu 32 bytes. Waktu komputasi HMAC sama terlepas dari panjang atau konten input. Di 1GB mobile device yang sering beroperasi di jaringan tidak terpercaya (hotspot publik, 4G), timing attack lebih mudah dilakukan karena network variance lebih rendah dibanding broadband.

**Yang EDITH adopt:**
- HMAC-sha256 comparison: `HMAC(key, candidate)` vs `HMAC(key, expected)` → selalu 32-byte comparison
- `crypto.timingSafeEqual()` untuk final comparison

---

### Paper 7: MQTT-SN PUF Authentication Scheme (MDPI 2024)

**Relevansi:** Bug #4 — konfirmasi praktik constant-time auth di edge devices

**Apa isinya:**
Paper ini menganalisis skema autentikasi untuk IoT devices dengan resource sangat terbatas menggunakan Physical Unclonable Functions. Yang relevan: paper ini secara eksplisit membahas bahwa di edge/mobile environments, timing side-channel attacks lebih berbahaya karena attacker sering memiliki physical proximity dan lower network jitter. Constant-time operations untuk auth adalah **mandatory**, bukan optional, di semua deployment termasuk local network. EDITH di HP yang connect ke gateway server via local WiFi adalah persis scenario ini.

**Yang EDITH adopt:**
- Auth middleware harus constant-time bahkan untuk local network deployment
- Security assumptions tidak boleh berubah berdasarkan "ini cuma local network"

---

### Paper 8: OWASP API Security Top 10 (2023)

**Relevansi:** Bug #5 — Broken Object Level Authorization di config endpoints

**Apa isinya:**
OWASP API Security Top 10 menempatkan Broken Object Level Authorization (BOLA) sebagai risk #1. Config endpoints yang dapat diakses tanpa autentikasi adalah contoh klasik: siapapun yang bisa reach port 18789 (gateway EDITH) bisa overwrite semua konfigurasi — API keys, LLM provider, behavior settings. Di mobile deployment di mana EDITH sering berjalan di jaringan WiFi yang di-share (kafe, kantor, kampus), ini bukan theoretical risk — ini practical attack vector. OWASP merekomendasikan: setiap endpoint yang memiliki efek samping (write, update, delete) harus diproteksi, dan first-setup grace period harus dibatasi secara ketat.

**Yang EDITH adopt:**
- `requireConfigAuth()` middleware di semua PUT/PATCH/POST ke `/api/config`
- First-setup grace period: hanya allow tanpa token kalau belum ada config DAN belum ada provider key tersimpan
- Setelah setup selesai: ADMIN_TOKEN wajib

---

## 2. Bug Detail & Fix Plans

### 2.1 Bug #1 — MemRL nextMaxQ: Bellman Scope Terlalu Sempit

**File:** `src/memory/memrl.ts` ~lines 375–395
**Paper basis:** ShiQ (arXiv:2505.11081) + TBRM (arXiv:2505.15311)
**Memory impact:** +1 targeted DB query (minimal, acceptable)

**Problem:**
`nextMaxQ` dihitung dari sibling nodes dalam batch saat ini (2–5 memories), bukan dari global user memory. Ini melanggar prinsip dasar Bellman equation yang membutuhkan `max` operator di atas **semua valid next states**. Hasil: Q-value estimates secara sistematis underestimate karena batch kecil selalu miss nodes dengan Q tinggi. Makin sedikit memories yang ada (seperti di user baru di 1GB device dengan storage terbatas), semakin parah bias-nya.

```
ShiQ Principle (arXiv:2505.11081):
  Q(s,a) = reward + γ · max_{a'} Q(s', a')

  "max" HARUS atas SEMUA valid next states.
  Mini-batch "max" = biased underestimate = suboptimal ranking.

  Semakin kecil batch → semakin parah bias
  (persis kondisi 1GB device dengan limited memory storage)
```

**Fix — minimal DB query, full correctness:**
```typescript
// OLD (buggy): max dari siblings di batch yang sama
const peerMaxQ = nodes
  .filter(n => n.userId === node.userId && n.id !== memoryId)
  .map(n => n.qValue ?? n.utilityScore ?? 0.5)
  .reduce((max, q) => Math.max(max, q), 0)

// NEW (correct): global max dari semua user memories
// Memory-efficient: hanya fetch 1 row, hanya kolom yang diperlukan
const topNode = await prisma.memoryNode.findFirst({
  where: {
    userId: node.userId,
    id: { not: memoryId },
  },
  orderBy: { qValue: "desc" },
  select: { qValue: true, utilityScore: true }, // minimal fetch
})
const nextMaxQ = topNode?.qValue ?? topNode?.utilityScore ?? 0.5
```

**Impact:** ~10 lines. 1 additional DB query per memory in feedback batch. Feedback is async/background — tidak ada user-facing latency. Di SQLite lokal (1GB device), query ini sub-millisecond.

---

### 2.2 Bug #2 — RRF Threshold: Filter yang Hampir Tidak Filter

**File:** `src/memory/hybrid-retriever.ts` ~line 66
**Paper basis:** Analysis of Fusion Functions for Hybrid Retrieval + RAG-Fusion
**Memory impact:** Lebih sedikit tokens retrieved = lebih sedikit memory dipakai saat inference

**Problem:**
`scoreThreshold: 0.005` secara matematis hampir tidak menyaring apapun. Di 1GB device dengan local LLM yang punya limited context window, memasukkan retrieval noise ke prompt = membuang token budget = response yang lebih buruk.

```
Bukti Matematis (dari Fusion Functions paper):
  RRF Formula: weight × (1 / (k + rank))
  Dengan k=60, weight_fts=0.4, weight_vec=0.6:

  Rank 1 kedua source:  0.4/61 + 0.6/61 = 0.0164 (max possible)
  Rank 20 kedua source: 0.4/80 + 0.6/80 = 0.0125
  Rank 20 FTS only:     0.4/80 + 0      = 0.005  ← threshold sekarang
  Rank 15 Vec only:     0      + 0.6/75 = 0.008  ← threshold baru

  0.005 = hanya buang rank 81+ dari single source
  0.008 = buang rank 16+ dari single source ← noise yang sesungguhnya
```

**Fix — 1 baris:**
```typescript
// OLD:
scoreThreshold: 0.005

// NEW:
scoreThreshold: 0.008
```

**Impact:** 1 line. Hasil retrieval lebih bersih, prompt lebih padat, local LLM di 1GB device lebih efektif.

---

### 2.3 Bug #3 — Hash Fallback Embedding: Silent Corruption di Vector Space

**File:** `src/memory/store.ts` ~lines 350–390
**Paper basis:** Embedding Drift research + **EmbeddingGemma (Sep 2025)** sebagai solusi jangka panjang
**Memory impact:** Eliminasi hash vector = vector index lebih reliable = tidak perlu padding/workaround

**Problem:**
Saat embedding provider (Ollama/OpenAI) offline, `hashToVector()` menghasilkan vektor pseudo-random yang di-store ke LanceDB bercampur dengan semantic embeddings asli. Di 1GB device yang sering offline atau pakai Ollama lokal (resource-constrained), provider failure lebih sering terjadi — artinya corruption ini tidak rare, tapi common.

```
Dampak di 1GB environment:

  Real embedding (all-MiniLM atau EmbeddingGemma):
    → 384/256-dim vector, distribusi clustered
    → cosine similarity = meaningful semantic proximity

  Hash vector:
    → 384/256-dim pseudo-random, distribusi uniform
    → cosine similarity = random noise yang tampak confident
    → "memory tentang cuaca Jakarta" bisa match ke
      "memory tentang kode Python" karena hash collision
```

**Fix Strategy — Reject, jangan fake:**
```typescript
// NEW: Error class untuk signal yang jelas
export class EmbeddingUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Embedding unavailable: ${reason}`)
    this.name = "EmbeddingUnavailableError"
  }
}

// Di embed():
async embed(text: string): Promise<number[]> {
  try {
    // coba provider chain: local → openai → ollama
    return await this.embeddingProviderChain(text)
  } catch (err) {
    // JANGAN return hashToVector(text)
    throw new EmbeddingUnavailableError(
      err instanceof Error ? err.message : "all providers failed"
    )
  }
}

// Di callers (storeMemory, updateMemory):
try {
  const embedding = await store.embed(content)
  await lancedb.insert({ ...node, embedding })
} catch (err) {
  if (err instanceof EmbeddingUnavailableError) {
    // Store ke Prisma saja (FTS masih jalan)
    // Vector search degraded tapi tidak corrupt
    logger.warn("Storing to FTS-only: embedding unavailable", { reason: err.reason })
    await prisma.memoryNode.create({ data: nodeWithoutEmbedding })
  } else {
    throw err
  }
}
```

**Note untuk Phase 9:** Saat Phase 9D diimplementasi, ganti `all-MiniLM-L6-v2` dengan **EmbeddingGemma (256-dim)** sebagai local embedding provider. 200MB RAM, 100+ bahasa termasuk Bahasa Indonesia, SOTA di MTEB. Ini yang seharusnya jadi provider utama di 1GB device — bukan OpenAI API yang butuh internet.

**Impact:** ~25 lines di 2 files. FTS tetap berjalan. Vector search degraded tapi tidak corrupt.

---

### 2.4 Bug #4 — Admin Token Timing Side-Channel

**File:** `src/gateway/server.ts` ~lines 173–190
**Paper basis:** CWE-208 (MITRE) + MQTT-SN PUF (MDPI 2024)
**Memory impact:** HMAC computation trivial (<0.1ms), tidak ada memory concern

**Problem:**
`timingSafeTokenEquals` mengambil code path berbeda untuk length mismatch vs match. Attacker bisa ukur response time untuk determine panjang `ADMIN_TOKEN`. Di HP yang sering di jaringan publik, network jitter lebih rendah = timing attack lebih feasible.

```
CWE-208 Attack Pattern:
  candidate "a"     → response ~0.001ms (length mismatch, early exit)
  candidate "aaaa"  → response ~0.001ms (still mismatch)
  candidate "aaaaa" → response ~0.003ms (length match, enters comparison)

  Attacker tahu: token panjangnya 5 karakter
  Lanjut brute-force karakter per karakter...

HMAC Fix:
  HMAC("a", key)     → 32-byte hash → compare 32 bytes
  HMAC("aaaa", key)  → 32-byte hash → compare 32 bytes
  HMAC("aaaaa", key) → 32-byte hash → compare 32 bytes
  → waktu selalu identik, panjang tidak bocor
```

**Fix:**
```typescript
// OLD (vulnerable):
function timingSafeTokenEquals(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false // ← length leak!
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  return crypto.timingSafeEqual(a, b)
}

// NEW (constant-time):
function timingSafeTokenEquals(candidate: string, expected: string): boolean {
  const key = Buffer.from(expected, "utf-8")
  const a = crypto.createHmac("sha256", key).update(candidate).digest()
  const b = crypto.createHmac("sha256", key).update(expected).digest()
  return crypto.timingSafeEqual(a, b) // selalu 32 bytes, selalu constant time
}
```

**Impact:** ~8 lines. Zero performance cost yang visible.

---

### 2.5 Bug #5 — Unauthenticated Config Write Endpoints

**File:** `src/gateway/server.ts` ~lines 882–930
**Paper basis:** OWASP API Security Top 10 — Broken Object Level Authorization
**Memory impact:** Middleware check ringan, tidak ada memory concern

**Problem:**
`PUT/PATCH /api/config` dan `POST /api/config/test-provider` tidak punya autentikasi apapun. Di 1GB mobile deployment yang sering di jaringan shared (WiFi kampus, kafe), siapapun yang tau port 18789 bisa overwrite API keys dan konfigurasi EDITH.

**Fix — `requireConfigAuth()` middleware:**
```typescript
async function requireConfigAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const adminToken = process.env.ADMIN_TOKEN

  if (!adminToken) {
    // First-time setup grace period:
    // Allow HANYA jika belum ada config ATAU belum ada provider key
    const config = await readEdithConfig().catch(() => null)
    const hasKeys = config && hasAnyProviderKey(config)
    if (!hasKeys) return true // setup belum selesai, allow

    // Config sudah ada tapi ADMIN_TOKEN tidak di-set = misconfiguration
    reply.code(403).send({
      error: "ADMIN_TOKEN not configured. Set it in your environment to allow config changes.",
    })
    return false
  }

  const bearer = req.headers.authorization?.replace("Bearer ", "").trim()
  if (!bearer || !timingSafeTokenEquals(bearer, adminToken)) {
    reply.code(401).send({ error: "Invalid or missing admin token" })
    return false
  }
  return true
}

// Apply ke semua write endpoints:
fastify.put("/api/config", async (req, reply) => {
  if (!(await requireConfigAuth(req, reply))) return
  // ... existing handler
})

fastify.patch("/api/config", async (req, reply) => {
  if (!(await requireConfigAuth(req, reply))) return
  // ... existing handler
})

fastify.post("/api/config/test-provider", async (req, reply) => {
  if (!(await requireConfigAuth(req, reply))) return
  // ... existing handler
})
```

**Impact:** ~50 lines. Security dari open → protected.

---

## 3. Budget Memory — Target 1GB RAM

Ini yang Tony check sebelum deploy di lapangan. Setiap komponen harus punya angka:

```
EDITH Core Budget di 1GB RAM:
┌─────────────────────────────────────────────────────────┐
│  Node.js runtime + EDITH gateway           ~150 MB      │
│  SQLite (Prisma)                           ~30 MB        │
│  LanceDB                                   ~50 MB        │
│  EmbeddingGemma 256-dim (Phase 9D)         ~200 MB       │
│  Whisper.cpp base model (Phase 9B)         ~388 MB       │
│  OS + background processes                 ~150 MB       │
│                                            ─────────     │
│  Total                                     ~968 MB       │
│  Headroom                                  ~56 MB  ✅    │
└─────────────────────────────────────────────────────────┘

CATATAN: Kalau Whisper dan EmbeddingGemma tidak berjalan
bersamaan (lazy load + unload), headroom bisa sampai ~440MB.
Ini harus jadi pola: load model saat dibutuhkan, unload setelah.
```

**Implikasi langsung dari budget ini ke bug fixes:**
- **Bug #1:** Hanya fetch 1 row `{ qValue, utilityScore }` — tidak load seluruh memory node object
- **Bug #3:** EmbeddingGemma 256-dim (bukan 768-dim) untuk hemat ~40% memory vs full dimensions
- **Bug #3:** Graceful degradation ke FTS-only ketika embedding provider tidak bisa di-load = tidak force-load model kalau memory tight

---

## 4. Implementation Roadmap

### Day 1 — Security Fixes (Bug #4, #5): CRITICAL FIRST

Ini yang Tony kerjain sebelum tidur kalau bisa.

| Task | File | Lines |
|------|------|-------|
| Implement HMAC-based `timingSafeTokenEquals` | `server.ts` | ~8 |
| Implement `requireConfigAuth()` middleware | `server.ts` | ~30 |
| Apply auth ke `PUT /api/config` | `server.ts` | ~5 |
| Apply auth ke `PATCH /api/config` | `server.ts` | ~5 |
| Apply auth ke `POST /api/config/test-provider` | `server.ts` | ~5 |
| Test: timing attack (measure response time variance) | `__tests__/` | ~20 |
| Test: config write without token → 401 | `__tests__/` | ~20 |

### Day 2 — Memory & Data Integrity (Bug #1, #3)

| Task | File | Lines |
|------|------|-------|
| Fix `nextMaxQ` global Prisma query | `memrl.ts` | ~10 |
| Add `EmbeddingUnavailableError` class | `store.ts` | ~8 |
| Replace `hashToVector()` fallback dengan throw | `store.ts` | ~5 |
| Update `storeMemory()` caller untuk catch + FTS-only fallback | `store.ts` | ~12 |
| Test: global Bellman — mock DB, verify correct max node | `__tests__/` | ~25 |
| Test: embedding rejection — provider fails → FTS-only store | `__tests__/` | ~20 |

### Day 3 — Retrieval Fix + Full Verification (Bug #2)

| Task | File | Lines |
|------|------|-------|
| Update `scoreThreshold: 0.005 → 0.008` | `hybrid-retriever.ts` | 1 |
| Regression test: threshold menyaring noise dengan benar | `__tests__/` | ~15 |
| Full test suite: `pnpm test` | terminal | — |
| TypeScript check: `pnpm tsc --noEmit` | terminal | — |
| Manual smoke test: EDITH menyimpan dan retrieve memory | terminal | — |
| Manual smoke test: config endpoint blocked tanpa token | terminal | — |

---

## 5. Risiko & Mitigasi

| Risiko | Kenapa Bisa Terjadi | Mitigasi |
|--------|---------------------|----------|
| Bellman fix menambah DB query overhead | Feedback batch besar | Confirm feedback adalah async; monitor query time di test |
| EmbeddingGemma belum diintegrate di Phase 5 | Phase 9 belum done | Bug #3 fix tetap valid: reject hash, graceful FTS fallback sudah cukup untuk sekarang |
| `requireConfigAuth` break existing mobile app | Mobile kirim request tanpa header auth | Update mobile client untuk kirim `Authorization: Bearer <token>` di settings screen — add ke Phase 8 backlog |
| Memory budget 1GB tight saat semua model loaded | Whisper + EmbeddingGemma bersamaan | Lazy load + unload pattern wajib di Phase 9; document sebagai architectural constraint |

---

## 6. References

| # | Paper/Standard | ID | Bug | Kenapa Lebih Baik dari Versi Lama |
|---|---------------|----|----|-----------------------------------|
| 1 | ShiQ: Bringing Back Bellman to LLMs | arXiv:2505.11081 | #1 | Paper **Mei 2025** — lebih baru dari versi sebelumnya, bukti teoritik lebih kuat |
| 2 | TBRM: Trajectory Bellman Residual Min | arXiv:2505.15311 | #1 | Paper **Mei 2025** — konfirmasi independent bahwa global scope non-negotiable |
| 3 | Analysis of Fusion Functions for Hybrid Retrieval | arXiv | #2 | Tetap dipertahankan, mathematical proof RRF threshold valid |
| 4 | RAG-Fusion | arXiv | #2 | Tetap dipertahankan, praktik RRF threshold production-tested |
| 5 | **EmbeddingGemma** | Google DeepMind Sep 2025 | #3 | **BARU** — <200MB RAM, 100+ bahasa termasuk ID, SOTA MTEB, **designed untuk 1GB device** |
| 6 | Embedding Drift / Silent Corruption | Research | #3 | Tetap dipertahankan, justifikasi reject hash fallback |
| 7 | CWE-208: Observable Timing Discrepancy | MITRE | #4 | Tetap dipertahankan, definisi gold standard |
| 8 | MQTT-SN PUF Authentication | MDPI 2024 | #4 | Tetap dipertahankan, relevan untuk mobile/edge deployment |
| 9 | OWASP API Security Top 10 | OWASP 2023 | #5 | Tetap dipertahankan, BOLA adalah risk #1 |

---

## 7. File Changes Summary

| File | Action | Est. Lines | Memory Impact |
|------|--------|-----------|--------------|
| `src/memory/memrl.ts` | Fix Bellman `nextMaxQ` — 1 targeted query | ~10 | Neutral (minimal fetch) |
| `src/memory/hybrid-retriever.ts` | Update `scoreThreshold` | 1 | Positive (lebih sedikit noise di context) |
| `src/memory/store.ts` | Remove hash fallback, add `EmbeddingUnavailableError`, FTS-only path | ~25 | Positive (no more fake vectors) |
| `src/gateway/server.ts` | HMAC token fix, `requireConfigAuth` middleware, apply to 3 endpoints | ~55 | Neutral |
| `src/__tests__/memrl-bellman.test.ts` | NEW | ~30 | — |
| `src/__tests__/embedding-fallback.test.ts` | NEW | ~25 | — |
| `src/__tests__/config-auth.test.ts` | NEW | ~40 | — |
| **Total** | | **~186 lines** | |

---

## 8. Definition of Done

Phase 5 selesai ketika:

- [ ] Semua 3 test files pass (memrl-bellman, embedding-fallback, config-auth)
- [ ] `pnpm tsc --noEmit` zero errors
- [ ] `PUT /api/config` tanpa token → 401 (bukan 200)
- [ ] Token comparison response time variance < 0.5ms (timing-safe verified)
- [ ] Memory store dengan provider down → FTS-only (tidak ada hash vectors di LanceDB)
- [ ] MemRL feedback dengan 100+ nodes → nextMaxQ dari global max, bukan batch
- [ ] Retrieval dengan threshold 0.008 tidak return single-source rank-20+ noise

> *"Lima bug. Lima fix. Semuanya ada justifikasinya, semuanya ada test-nya, dan semuanya bisa jalan di HP 1GB."*
> *"Kalau JARVIS bisa jalan di suit yang dibuat di gua, EDITH bisa jalan di HP yang ada di saku orang."*
