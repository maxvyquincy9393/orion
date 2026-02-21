# Orion — Phase OC-9 to OC-12: Implementation Prompt
# Focus: MemRL Fix, Hybrid Search, Telemetry, Multi-Tenant
# Research basis: RESEARCH-PAPERS-PHASE-OC9-OC12.md
# Date: Feb 22, 2026

---

## KONTEKS UNTUK AI (baca dulu sebelum mulai)

Orion adalah AI companion dengan full TypeScript stack di `orion-ts/`.
Phase OC-0 sampai OC-8 sudah selesai atau sedang dikerjakan.
Phase ini implement 4 sistem berikutnya yang membawa Orion dari "feature parity" ke "production platform":

- **OC-9**: Fix bug kritis di MemRL + upgrade ke Intent-Experience-Utility triplets
- **OC-10**: Hybrid memory search (FTS + Vector + RRF reranking)
- **OC-11**: Token usage tracking + cost telemetry
- **OC-12**: Multi-tenant workspace foundation (prerequisite SaaS)

Setiap OC = file baru + patch minimal ke file existing. Zero breaking changes ke API.

---

## OC-9: MEMRL BUG FIX + INTENT-EXPERIENCE-UTILITY UPGRADE

### Background

`src/memory/memrl.ts` sudah ada tapi punya **critical bug**: `updateFromFeedback()` tidak pernah dipanggil
setelah response. Artinya Q-values tidak pernah update, RL tidak berfungsi, agent tidak belajar dari experience.

Research basis: arXiv 2601.03192 (MemRL) — agents harus store memories sebagai Intent-Experience-Utility triplets
dan update Q-values via Bellman equation setelah setiap outcome.

### Step 1: Upgrade memory format di `src/memory/memrl.ts`

Ganti internal memory format dari plain text ke triplets:

```typescript
// SEBELUM (plain memory entry)
interface MemoryEntry {
  content: string;
  embedding: number[];
  timestamp: number;
}

// SESUDAH (Intent-Experience-Utility triplet)
export interface IEUTriplet {
  id: string;
  intent: string;           // What was the user trying to do?
  experience: string;       // What did the agent do? What happened?
  utility: number;          // Q-value: -1.0 to 1.0 (learned via RL)
  embedding: number[];      // Embedding of intent (for Phase-A retrieval)
  outcomeCount: number;     // How many times this memory was used
  lastUsed: number;         // Timestamp
  sessionId: string;
}
```

### Step 2: Implement Two-Phase Retrieval

Ganti `retrieveContext()` dengan two-phase mechanism:

```typescript
async retrieveContext(query: string, sessionId: string, topK = 5): Promise<IEUTriplet[]> {
  // Phase-A: Semantic similarity filter (candidate pool)
  const candidates = await this.vectorSearch(query, topK * 3); // retrieve 3x more candidates
  
  // Phase-B: Q-value reranking (select high-utility from candidates)
  const reranked = candidates
    .sort((a, b) => {
      // Combine semantic score + utility score
      const aScore = (a.semanticScore * 0.4) + (a.utility * 0.6);
      const bScore = (b.semanticScore * 0.4) + (b.utility * 0.6);
      return bScore - aScore;
    })
    .slice(0, topK);
  
  return reranked;
}
```

### Step 3: Implement Bellman Q-value Update

```typescript
async updateFromFeedback(
  sessionId: string, 
  memoryIds: string[],  // IDs of memories that were retrieved and used
  outcome: 'success' | 'failure' | 'partial',
  reward?: number       // Optional explicit reward (-1 to 1)
): Promise<void> {
  const r = reward ?? (outcome === 'success' ? 1.0 : outcome === 'failure' ? -0.5 : 0.1);
  const gamma = 0.9; // discount factor
  const alpha = 0.1; // learning rate
  
  for (const id of memoryIds) {
    const memory = await this.getById(id);
    if (!memory) continue;
    
    // Bellman update: Q_new = Q_old + alpha * (r + gamma * max_Q_next - Q_old)
    const maxQNext = 0; // terminal state assumption for simplicity
    const newUtility = memory.utility + alpha * (r + gamma * maxQNext - memory.utility);
    
    await this.updateUtility(id, Math.max(-1, Math.min(1, newUtility)));
    await this.incrementOutcomeCount(id);
  }
}
```

### Step 4: Patch `src/core/runner.ts` — connect feedback loop

Tambahkan ini di akhir setiap task execution dalam `runner.ts`:

```typescript
// Setelah task selesai, update MemRL
if (this.memrl && context.retrievedMemoryIds?.length) {
  const outcome = taskResult.success ? 'success' : taskResult.partial ? 'partial' : 'failure';
  await this.memrl.updateFromFeedback(
    context.sessionId,
    context.retrievedMemoryIds,
    outcome
  );
}
```

### Step 5: Patch `src/gateway/index.ts` — connect feedback loop untuk chat responses

Di gateway WebSocket handler, setelah response dikirim ke user:

```typescript
// Track retrieved memories per request
const retrievedIds = await memrl.retrieveContext(userMessage, sessionId);
// ... generate response ...
// After response sent:
await memrl.updateFromFeedback(sessionId, retrievedIds.map(m => m.id), 'success');
// Note: 'success' default untuk chat — bisa upgrade ke thumbs up/down feedback nanti
```

---

## OC-10: HYBRID MEMORY SEARCH

### Background

Orion pakai pure vector search (LanceDB) untuk semua memory retrieval.
Vector search fails untuk: exact names, dates, IDs, newly-coined terms.
OpenClaw punya FTS fallback + query expansion. Kita implement hybrid dengan RRF reranking.

Research basis: LlamaIndex/Google hybrid search research, arXiv 2506.00054 (RAG Survey).

### Buat file baru: `src/memory/hybrid-retriever.ts`

```typescript
import * as lancedb from '@lancedb/lancedb';

export interface RetrievalResult {
  id: string;
  content: string;
  score: number;          // Final RRF score
  vectorScore?: number;   // Raw vector similarity
  ftsScore?: number;      // Raw FTS score
  source: 'vector' | 'fts' | 'hybrid';
}

export class HybridRetriever {
  private db: lancedb.Connection;
  private tableName: string;
  private k = 60; // RRF constant
  
  constructor(db: lancedb.Connection, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }
  
  async retrieve(
    query: string,
    queryEmbedding: number[],
    topK = 10,
    options: { expandQuery?: boolean } = {}
  ): Promise<RetrievalResult[]> {
    const tbl = await this.db.openTable(this.tableName);
    
    // Optionally expand query via LLM (get synonyms/rephrases)
    const queries = options.expandQuery
      ? [query, ...(await this.expandQuery(query))]
      : [query];
    
    // Run vector search + FTS in parallel
    const [vectorResults, ftsResults] = await Promise.all([
      this.vectorSearch(tbl, queryEmbedding, topK * 2),
      this.ftsSearch(tbl, queries, topK * 2),
    ]);
    
    // RRF merge
    return this.reciprocalRankFusion(vectorResults, ftsResults, topK);
  }
  
  private async vectorSearch(tbl: lancedb.Table, embedding: number[], limit: number) {
    return tbl.vectorSearch(embedding).limit(limit).toArray();
  }
  
  private async ftsSearch(tbl: lancedb.Table, queries: string[], limit: number) {
    // LanceDB full-text search
    const results = [];
    for (const q of queries) {
      try {
        const r = await tbl.search(q).limit(limit).toArray();
        results.push(...r);
      } catch { /* FTS might not be enabled for all tables */ }
    }
    // Deduplicate by id
    return [...new Map(results.map(r => [r.id, r])).values()];
  }
  
  private reciprocalRankFusion(
    vectorResults: any[],
    ftsResults: any[],
    topK: number
  ): RetrievalResult[] {
    const scores = new Map<string, { score: number; item: any; vectorRank?: number; ftsRank?: number }>();
    
    // Score from vector results
    vectorResults.forEach((item, rank) => {
      const id = item.id;
      const rrfScore = 1 / (this.k + rank + 1);
      scores.set(id, { score: rrfScore, item, vectorRank: rank });
    });
    
    // Score from FTS results (add to existing or create)
    ftsResults.forEach((item, rank) => {
      const id = item.id;
      const rrfScore = 1 / (this.k + rank + 1);
      const existing = scores.get(id);
      if (existing) {
        existing.score += rrfScore;
        existing.ftsRank = rank;
      } else {
        scores.set(id, { score: rrfScore, item, ftsRank: rank });
      }
    });
    
    // Sort by final RRF score
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ score, item, vectorRank, ftsRank }) => ({
        id: item.id,
        content: item.content ?? item.text ?? '',
        score,
        vectorScore: vectorRank !== undefined ? 1 / (this.k + vectorRank + 1) : undefined,
        ftsScore: ftsRank !== undefined ? 1 / (this.k + ftsRank + 1) : undefined,
        source: vectorRank !== undefined && ftsRank !== undefined ? 'hybrid' 
               : vectorRank !== undefined ? 'vector' : 'fts',
      }));
  }
  
  private async expandQuery(query: string): Promise<string[]> {
    // Simple expansion: generate 2 rephrases via LLM
    // This is a lightweight call — use fast engine (Groq/Gemini Flash)
    // Return empty array on failure to avoid blocking retrieval
    try {
      // Call fast engine here with prompt:
      // "Rephrase this query in 2 different ways for memory search: {query}"
      // Parse response into array of strings
      return []; // placeholder — implement with actual LLM call
    } catch {
      return [];
    }
  }
}
```

### Patch `src/memory/himes.ts`

Replace `retrieveContext()` yang pakai vector-only dengan HybridRetriever:

```typescript
import { HybridRetriever } from './hybrid-retriever';

// Di constructor:
this.hybridRetriever = new HybridRetriever(this.db, 'memories');

// Di retrieveContext():
async retrieveContext(query: string, sessionId: string): Promise<MemoryEntry[]> {
  const embedding = await this.embed(query);
  const results = await this.hybridRetriever.retrieve(query, embedding, 10, {
    expandQuery: query.length > 50 // expand only for complex queries
  });
  return results.map(r => this.toMemoryEntry(r));
}
```

---

## OC-11: TOKEN TELEMETRY + COST TRACKING

### Background

Orion tidak punya visibility ke token usage atau cost. OpenClaw punya real-time cost dashboard per model.
Kita implement lightweight in-process telemetry — tidak butuh external OTel collector.

Research basis: Portkey/Maxim observability research, OTel for MCP agents (Glama.ai).

### Buat file baru: `src/telemetry/usage-tracker.ts`

```typescript
import Database from 'better-sqlite3';
import path from 'path';

export interface UsageRecord {
  requestId: string;
  sessionId: string;
  userId?: string;
  model: string;
  engine: string;           // 'groq', 'gemini', 'claude', etc.
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  toolCalls: string[];      // list of tools used
  taskType: string;
  timestamp: number;
  success: boolean;
}

// Pricing table (update as needed)
const MODEL_PRICING: Record<string, { input: number; output: number; cached?: number }> = {
  'claude-3-5-sonnet': { input: 3.00, output: 15.00, cached: 0.30 }, // per 1M tokens
  'claude-3-5-haiku': { input: 0.80, output: 4.00, cached: 0.08 },
  'gpt-4o': { input: 2.50, output: 10.00, cached: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cached: 0.075 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00, cached: 0.3125 },
  'llama-3.3-70b': { input: 0.59, output: 0.79 }, // Groq pricing
  'qwen-72b': { input: 0.40, output: 0.40 },
};

export class UsageTracker {
  private db: Database.Database;
  private ringBuffer: UsageRecord[] = [];
  private readonly BUFFER_SIZE = 1000;
  
  constructor(dbPath?: string) {
    const p = dbPath ?? path.join(process.cwd(), 'data', 'usage.db');
    this.db = new Database(p);
    this.initSchema();
  }
  
  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        request_id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT,
        model TEXT,
        engine TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_tokens INTEGER,
        estimated_cost_usd REAL,
        latency_ms INTEGER,
        tool_calls TEXT,
        task_type TEXT,
        timestamp INTEGER,
        success INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_session ON usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON usage(timestamp);
      CREATE INDEX IF NOT EXISTS idx_user ON usage(user_id);
    `);
  }
  
  track(record: UsageRecord): void {
    // Estimate cost
    const pricing = MODEL_PRICING[record.model] ?? { input: 0, output: 0 };
    record.estimatedCostUsd = (
      (record.inputTokens * pricing.input) +
      (record.outputTokens * pricing.output) +
      (record.cachedTokens * (pricing.cached ?? pricing.input * 0.1))
    ) / 1_000_000;
    
    // In-memory ring buffer (fast path)
    this.ringBuffer.push(record);
    if (this.ringBuffer.length > this.BUFFER_SIZE) this.ringBuffer.shift();
    
    // Persist to SQLite (async, don't await)
    setImmediate(() => this.persist(record));
  }
  
  private persist(record: UsageRecord) {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO usage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        record.requestId, record.sessionId, record.userId ?? null,
        record.model, record.engine,
        record.inputTokens, record.outputTokens, record.cachedTokens,
        record.estimatedCostUsd, record.latencyMs,
        JSON.stringify(record.toolCalls), record.taskType,
        record.timestamp, record.success ? 1 : 0
      );
    } catch (err) {
      // Non-critical — don't throw
      console.error('[UsageTracker] persist error:', err);
    }
  }
  
  getSummary(options: { hours?: number; userId?: string; engine?: string } = {}) {
    const since = Date.now() - (options.hours ?? 24) * 3600 * 1000;
    let query = `SELECT 
      COUNT(*) as total_requests,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(estimated_cost_usd) as total_cost_usd,
      AVG(latency_ms) as avg_latency_ms,
      engine,
      model
    FROM usage WHERE timestamp > ?`;
    const params: any[] = [since];
    
    if (options.userId) { query += ' AND user_id = ?'; params.push(options.userId); }
    if (options.engine) { query += ' AND engine = ?'; params.push(options.engine); }
    query += ' GROUP BY engine, model ORDER BY total_cost_usd DESC';
    
    return this.db.prepare(query).all(...params);
  }
  
  getSessionCost(sessionId: string): number {
    const row = this.db.prepare(
      'SELECT SUM(estimated_cost_usd) as cost FROM usage WHERE session_id = ?'
    ).get(sessionId) as any;
    return row?.cost ?? 0;
  }
  
  // Hard spending cap check
  isOverBudget(sessionId: string, capUsd = 0.50): boolean {
    return this.getSessionCost(sessionId) > capUsd;
  }
}

// Singleton
export const usageTracker = new UsageTracker();
```

### Patch `src/gateway/index.ts` — instrument all LLM calls

Cari semua tempat dimana LLM dipanggil (pattern: `await engine.generate(...)`) dan wrap dengan tracking:

```typescript
import { usageTracker } from '../telemetry/usage-tracker';
import { randomUUID } from 'crypto';

// Wrap setiap LLM call:
const requestId = randomUUID();
const start = Date.now();
let response;
try {
  response = await engine.generate(prompt, options);
} finally {
  usageTracker.track({
    requestId,
    sessionId: context.sessionId,
    userId: context.userId,
    model: engine.model,
    engine: engine.name,
    inputTokens: response?.usage?.input_tokens ?? estimateTokens(prompt),
    outputTokens: response?.usage?.output_tokens ?? estimateTokens(response?.content ?? ''),
    cachedTokens: response?.usage?.cache_read_input_tokens ?? 0,
    estimatedCostUsd: 0, // calculated in tracker
    latencyMs: Date.now() - start,
    toolCalls: context.toolsUsed ?? [],
    taskType: context.taskType ?? 'chat',
    timestamp: Date.now(),
    success: !!response,
  });
}

// Budget check
if (usageTracker.isOverBudget(context.sessionId)) {
  await channel.send('⚠️ Session cost limit reached. Starting new session to continue.');
}
```

### Expose API endpoint — patch `src/gateway/index.ts`

```typescript
// GET /api/usage/summary?hours=24
app.get('/api/usage/summary', (req, res) => {
  const summary = usageTracker.getSummary({
    hours: parseInt(req.query.hours as string) || 24,
    userId: req.query.userId as string,
    engine: req.query.engine as string,
  });
  res.json({ summary, generatedAt: new Date().toISOString() });
});
```

---

## OC-12: MULTI-TENANT WORKSPACE FOUNDATION

### Background

`workspaceResolver.ts` sudah ada di prompt OC-3 tapi belum diimplementasi.
Tanpa ini, Orion tidak bisa serve multiple users dengan data isolation.
Ini prerequisite untuk SaaS monetization.

Research basis: AWS AaaS Whitepaper 2026, Fast.io Multi-Tenant Guide 2026.

### Buat file baru: `src/core/workspace-resolver.ts`

```typescript
import path from 'path';
import fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';

export interface TenantContext {
  tenantId: string;
  userId: string;
  workspacePath: string;
  memoryNamespace: string;   // For LanceDB isolation
  tier: 'free' | 'pro' | 'enterprise';
  rateLimits: {
    requestsPerHour: number;
    costCapUsd: number;
  };
}

const TIER_LIMITS = {
  free: { requestsPerHour: 60, costCapUsd: 0.10 },
  pro: { requestsPerHour: 600, costCapUsd: 2.00 },
  enterprise: { requestsPerHour: 6000, costCapUsd: 50.00 },
};

export class WorkspaceResolver {
  private prisma: PrismaClient;
  private baseWorkspacePath: string;
  private cache = new Map<string, TenantContext>();
  
  constructor(prisma: PrismaClient, baseWorkspacePath: string) {
    this.prisma = prisma;
    this.baseWorkspacePath = baseWorkspacePath;
  }
  
  async resolve(userId: string, channelId?: string): Promise<TenantContext> {
    // Cache check (TTL: 5 minutes)
    const cacheKey = `${userId}:${channelId ?? 'default'}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;
    
    // Look up user in DB
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, tier: true },
    }).catch(() => null);
    
    const tenantId = user?.tenantId ?? userId; // fallback: userId = tenantId (personal)
    const tier = (user?.tier ?? 'free') as 'free' | 'pro' | 'enterprise';
    
    const ctx: TenantContext = {
      tenantId,
      userId,
      workspacePath: path.join(this.baseWorkspacePath, tenantId),
      memoryNamespace: `tenant_${tenantId}`,
      tier,
      rateLimits: TIER_LIMITS[tier],
    };
    
    // Ensure workspace directory exists
    await fs.mkdir(ctx.workspacePath, { recursive: true });
    
    // Cache for 5 minutes
    this.cache.set(cacheKey, ctx);
    setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);
    
    return ctx;
  }
  
  // Inject tenant namespace into all LanceDB queries
  wrapMemoryQuery<T>(query: T, ctx: TenantContext): T & { namespace: string } {
    return { ...query, namespace: ctx.memoryNamespace } as any;
  }
}
```

### Buat file baru: `src/config/orion-config.ts`

```typescript
import { z } from 'zod';

const OrionConfigSchema = z.object({
  // Core
  instanceId: z.string().default('orion-default'),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  
  // Multi-tenant
  multiTenant: z.object({
    enabled: z.boolean().default(false),
    defaultTier: z.enum(['free', 'pro', 'enterprise']).default('free'),
    baseWorkspacePath: z.string().default('./workspaces'),
  }).default({}),
  
  // Telemetry
  telemetry: z.object({
    enabled: z.boolean().default(true),
    dbPath: z.string().default('./data/usage.db'),
    defaultCostCapUsd: z.number().default(0.50),
    alertOnBudgetPercent: z.number().default(80), // Alert at 80% of cap
  }).default({}),
  
  // Memory
  memory: z.object({
    hybridSearchEnabled: z.boolean().default(true),
    queryExpansionEnabled: z.boolean().default(false), // Off by default (adds latency)
    memrlEnabled: z.boolean().default(true),
    memrlLearningRate: z.number().default(0.1),
  }).default({}),
  
  // Rate limits (global fallback)
  rateLimits: z.object({
    requestsPerHour: z.number().default(120),
    maxConcurrentSessions: z.number().default(10),
  }).default({}),
});

export type OrionConfig = z.infer<typeof OrionConfigSchema>;

export function loadConfig(overrides?: Partial<OrionConfig>): OrionConfig {
  const raw = {
    instanceId: process.env.ORION_INSTANCE_ID,
    environment: process.env.NODE_ENV,
    multiTenant: {
      enabled: process.env.MULTI_TENANT_ENABLED === 'true',
      baseWorkspacePath: process.env.WORKSPACE_BASE_PATH,
    },
    telemetry: {
      dbPath: process.env.USAGE_DB_PATH,
      defaultCostCapUsd: parseFloat(process.env.COST_CAP_USD ?? '0.50'),
    },
    ...overrides,
  };
  
  return OrionConfigSchema.parse(raw);
}

export const config = loadConfig();
```

### Patch `prisma/schema.prisma` — tambah tenant fields

```prisma
// Tambahkan ke model User:
model User {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  // Tambah ini:
  tenantId  String?  // null = personal (userId = tenantId)
  tier      String   @default("free") // free | pro | enterprise
  
  // Existing relations...
}

// Tambahkan model baru:
model Tenant {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  name        String
  tier        String   @default("free")
  costCapUsd  Float    @default(0.50)
  users       User[]
}
```

### Patch `src/gateway/index.ts` — inject tenant context per request

```typescript
import { WorkspaceResolver } from '../core/workspace-resolver';

const workspaceResolver = new WorkspaceResolver(prisma, config.multiTenant.baseWorkspacePath);

// Di setiap incoming request handler:
const tenantCtx = await workspaceResolver.resolve(userId, channelId);

// Pass ke semua downstream: memory, tools, responses
context.tenantCtx = tenantCtx;

// Rate limiting check
if (usageTracker.isOverBudget(tenantCtx.tenantId, tenantCtx.rateLimits.costCapUsd)) {
  return channel.send('⚠️ Usage limit reached. Upgrade your plan or wait for next billing period.');
}
```

---

## CHECKLIST EKSEKUSI

### OC-9 (MemRL)
- [ ] Upgrade IEUTriplet interface di `memrl.ts`
- [ ] Implement Two-Phase Retrieval (semantic + Q-value)
- [ ] Implement Bellman Q-value update di `updateFromFeedback()`
- [ ] Patch `runner.ts` — call `updateFromFeedback()` setelah task complete
- [ ] Patch `gateway/index.ts` — call `updateFromFeedback()` setelah chat response

### OC-10 (Hybrid Search)
- [ ] Buat `src/memory/hybrid-retriever.ts` (full content di atas)
- [ ] Patch `src/memory/himes.ts` — use HybridRetriever untuk semua retrieval
- [ ] Test: query dengan exact name/date → should get better results
- [ ] Optional: implement query expansion (LLM call ke fast engine)

### OC-11 (Telemetry)
- [ ] Buat `src/telemetry/usage-tracker.ts` (full content di atas)
- [ ] Buat `data/` directory kalau belum ada
- [ ] Patch `gateway/index.ts` — wrap semua LLM calls dengan tracking
- [ ] Add `/api/usage/summary` endpoint
- [ ] Test: check `data/usage.db` ada dan terisi setelah beberapa requests

### OC-12 (Multi-Tenant)
- [ ] Buat `src/core/workspace-resolver.ts` (full content di atas)
- [ ] Buat `src/config/orion-config.ts` (full content di atas)
- [ ] Patch `prisma/schema.prisma` — tambah `tenantId` + `tier` ke User, tambah Tenant model
- [ ] Run `pnpm prisma migrate dev --name add-tenant-fields`
- [ ] Patch `gateway/index.ts` — inject TenantContext ke semua request handlers
- [ ] Set `MULTI_TENANT_ENABLED=false` di `.env` untuk sekarang (enable later)
- [ ] Test: 2 different userIds → should get different workspace paths

---

## URUTAN EKSEKUSI YANG DISARANKAN

1. **OC-9 dulu** — ini bug fix yang unlock semua existing MemRL work. 1-2 hari.
2. **OC-11 paralel dengan OC-9** — independent, bisa dikerjain bareng. 1 hari.
3. **OC-10** setelah OC-9 selesai — needs stable memory layer. 2 hari.
4. **OC-12** terakhir — needs telemetry (OC-11) untuk cost tracking per tenant. 3-4 hari.

Kalau resources terbatas, OC-9 + OC-11 paling high ROI. Keduanya relatif kecil tapi impact besar.
