# Phase B — Memory Upgrade: MemRL

## Paper
**MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory**
arXiv: 2601.03192 | Jan 2026 | Shanghai Jiao Tong University + NUS

## Core Idea dari Paper
Memory sekarang di Orion itu passive — simpan lalu retrieve by similarity.
MemRL ubah ini jadi active: setiap memory entry punya utility score (Q-value).
Setelah setiap task selesai, utility di-update berdasarkan apakah task berhasil.
Next time retrieve, rank by utility bukan hanya similarity.

Formula: Q(m) ← Q(m) + α × (reward - Q(m))  [Monte Carlo update]

Struktur memory baru: Intent-Experience-Utility triplet
- Intent: embedding dari query/task yang memicu memory ini dibuat
- Experience: konten memory itu sendiri
- Utility: float 0-1, awalnya 0.5, diupdate berdasarkan feedback

Two-Phase Retrieval:
1. Phase 1: filter by cosine similarity > threshold (sparsity threshold δ)
2. Phase 2: rank filtered candidates by Q-value, ambil top-k

## Gap di Orion Sekarang
`memory/store.ts` — semua entry diperlakukan sama.
Tidak ada mekanisme untuk tahu memory mana yang sering berguna.
Search hanya by vector similarity, tidak ada utility weighting.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Implementasi MemRL pattern ke memory system.
Paper referensi: arXiv 2601.03192

### TASK: Phase B — MemRL Memory Upgrade

Target files:
- `src/memory/store.ts` (modifikasi utama)
- `prisma/schema.prisma` (tambah field utility)
- `src/memory/memrl.ts` (file baru)

#### Step 1: Update Prisma Schema
Di `prisma/schema.prisma`, cari model MemoryNode dan tambahkan field:
```prisma
model MemoryNode {
  // field yang sudah ada...
  utilityScore  Float    @default(0.5)
  retrievalCount Int     @default(0)
  successCount   Int     @default(0)
}
```
Juga tambahkan di LanceDB row (ini di memory, bukan prisma):
Untuk MemoryRow interface di store.ts, tambahkan field `utilityScore Float`.

Setelah edit schema, jalankan: `npx prisma migrate dev --name add-utility-score`

#### Step 2: Buat src/memory/memrl.ts
Buat file baru dengan class MemRLUpdater:

```typescript
// Interface untuk feedback setelah task selesai
export interface TaskFeedback {
  memoryIds: string[]     // ID memory yang dipakai dalam task ini
  taskSuccess: boolean    // apakah task berhasil
  reward: number          // 0.0 hingga 1.0
}

export class MemRLUpdater {
  private readonly alpha = 0.1   // learning rate
  private readonly gamma = 0.9   // decay factor

  // Panggil setelah setiap response/task selesai
  async updateFromFeedback(feedback: TaskFeedback): Promise<void>

  // Two-Phase retrieval: filter similarity dulu, rank by utility
  async twoPhaseRetrieve(
    userId: string,
    queryVector: number[],
    limit: number,
    similarityThreshold: number   // delta: default 0.3
  ): Promise<SearchResult[]>

  // Hitung implicit reward dari conversation continuation
  // Jika user reply panjang dan positif setelah response → reward tinggi
  // Jika user tidak reply atau ganti topik → reward rendah
  estimateRewardFromContext(
    userReply: string | null,
    previousResponseLength: number
  ): number
}

export const memrlUpdater = new MemRLUpdater()
```

Implementasi detail:
- `updateFromFeedback`: untuk setiap memoryId, query prisma, update utilityScore
  dengan formula: newScore = currentScore + alpha * (reward - currentScore)
  Clamp antara 0.05 dan 0.99. Increment retrievalCount. Jika success, increment successCount.
- `twoPhaseRetrieve`: 
  Phase 1: ambil candidates dari LanceDB pakai vectorSearch, limit 3x dari limit target
  Phase 2: sort candidates by (0.6 * similarityScore + 0.4 * utilityScore), ambil top limit
- `estimateRewardFromContext`:
  Jika userReply null atau length < 10: return 0.2 (low reward)
  Jika userReply length > 100: return 0.8
  Jika userReply contains question mark: return 0.7 (engaged)
  Default: return 0.5

#### Step 3: Modifikasi memory/store.ts
- Di method `search()`, ganti implementasi dengan call ke `memrlUpdater.twoPhaseRetrieve()`
- Di method `save()`, set utilityScore default 0.5 saat insert ke LanceDB
- Tambahkan method `provideFeedback(feedback: TaskFeedback)` yang delegate ke memrlUpdater

#### Step 4: Integrasikan ke main.ts
Di main.ts, setelah mendapat `response` dari orchestrator:
```typescript
const reward = memrlUpdater.estimateRewardFromContext(null, response.length)
// Kita belum tahu user reply, tapi bisa update setelah reply berikutnya
// Simpan memoryIds yang dipakai dalam context saat ini
```

Strategi: di buildContext(), catat IDs memory yang di-inject ke context.
Return IDs tersebut bersama hasil context.
Di loop utama, setelah user reply berikutnya, update feedback berdasarkan reply itu.

Modifikasi BuildContextResult interface:
```typescript
export interface BuildContextResult {
  systemContext: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
  retrievedMemoryIds: string[]   // tambahan baru
}
```

### Constraints
- Jangan hapus existing search() logic, buat sebagai fallback
- Alpha dan gamma harus bisa dikonfigurasi via environment variable atau config
- Semua utility updates harus async dan tidak block main response loop
- Zero TypeScript errors setelah implementasi
- Jangan tambah external package baru (gunakan prisma yang sudah ada)
```

## Cara Test
```bash
# Mulai conversation
pnpm dev --mode text
# Kirim beberapa pesan yang sama
# Check database: utility score memory yang sering dipakai harusnya naik
sqlite3 .orion/orion.db "SELECT content, utilityScore FROM MemoryNode ORDER BY utilityScore DESC LIMIT 10"
```

## Expected Outcome
Memory yang pernah membantu (user reply panjang setelahnya) dapat utility score tinggi.
Memory yang noisy atau tidak relevan terdegradasi mendekati 0.
Kualitas context yang dibangun meningkat seiring waktu tanpa fine-tuning model.
