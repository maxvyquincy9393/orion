# Orion — Phase OC-5 to OC-8: Gap Feature Implementation Prompt
# Focus: Loop Detection, Exec Approvals (HITL), Context Compaction, Adaptive Routing
# Backed by: RESEARCH-PAPERS-GAP-FEATURES.md
# Date: Feb 22, 2026

---

## KONTEKS UNTUK AI (baca dulu sebelum mulai)

Orion adalah AI companion dengan full TypeScript stack di `orion-ts/`. Setelah OC-0 sampai OC-4 selesai (identity, bootstrap, skills, auth, heartbeat), sekarang kita implement fitur-fitur yang OpenClaw punya tapi Orion belum: loop detection, exec approvals, context compaction auto-trigger, dan adaptive engine routing.

Semua file baru masuk ke `src/` sesuai path yang ditentukan. Tidak ada perubahan breaking ke existing API. Setiap fitur = satu file baru + patch minimal ke file yang sudah ada.

---

## OC-5: LOOP DETECTION + CIRCUIT BREAKER

**Research basis**: arXiv 2510.23883 (Agentic AI Security), arXiv 2511.15755 (Multi-Agent Zero Variance)
**Gap**: Orion tidak punya mekanisme deteksi kalau agent stuck looping. Kalau tool dipanggil berulang dengan params yang sama, atau agent tidak membuat progress, tidak ada yang interrupt.

### Buat file baru: `src/core/loop-detector.ts`

```typescript
import { EventEmitter } from 'events';

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  timestamp: number;
  result?: 'success' | 'error' | 'no-progress';
}

export type LoopSeverity = 'warning' | 'circuit-break';

export interface LoopEvent {
  severity: LoopSeverity;
  pattern: 'identical-calls' | 'no-progress' | 'ping-pong' | 'rapid-spawn';
  callCount: number;
  tool: string;
  message: string;
}

const WARNING_THRESHOLD = 3;   // identical calls before warning
const BREAK_THRESHOLD = 5;     // identical calls before circuit break
const PROGRESS_WINDOW_MS = 30_000; // 30s window for no-progress detection
const PING_PONG_WINDOW = 6;    // last N calls to check for A-B-A-B pattern

export class LoopDetector extends EventEmitter {
  private history: ToolCall[] = [];
  private sessionId: string;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }

  /** Call after every tool invocation */
  record(call: ToolCall): void {
    this.history.push(call);
    this.analyze();
  }

  clearSession(): void {
    this.history = [];
  }

  private analyze(): void {
    this.checkIdenticalCalls();
    this.checkNoProgress();
    this.checkPingPong();
  }

  private checkIdenticalCalls(): void {
    if (this.history.length < WARNING_THRESHOLD) return;
    
    const last = this.history[this.history.length - 1];
    const identical = this.history.filter(c =>
      c.tool === last.tool &&
      JSON.stringify(c.params) === JSON.stringify(last.params)
    );

    if (identical.length >= BREAK_THRESHOLD) {
      this.emit('loop', {
        severity: 'circuit-break',
        pattern: 'identical-calls',
        callCount: identical.length,
        tool: last.tool,
        message: `Circuit break: tool "${last.tool}" called ${identical.length}x with identical params. Agent is stuck.`
      } satisfies LoopEvent);
    } else if (identical.length >= WARNING_THRESHOLD) {
      this.emit('loop', {
        severity: 'warning',
        pattern: 'identical-calls',
        callCount: identical.length,
        tool: last.tool,
        message: `Warning: tool "${last.tool}" called ${identical.length}x with identical params. Possible loop.`
      } satisfies LoopEvent);
    }
  }

  private checkNoProgress(): void {
    const now = Date.now();
    const recent = this.history.filter(c => now - c.timestamp < PROGRESS_WINDOW_MS);
    const allNoProgress = recent.length >= 4 && recent.every(c => c.result === 'no-progress');
    
    if (allNoProgress) {
      this.emit('loop', {
        severity: 'circuit-break',
        pattern: 'no-progress',
        callCount: recent.length,
        tool: recent[recent.length - 1].tool,
        message: `Circuit break: ${recent.length} tool calls in ${PROGRESS_WINDOW_MS/1000}s with no progress. Agent is polling without result.`
      } satisfies LoopEvent);
    }
  }

  private checkPingPong(): void {
    if (this.history.length < PING_PONG_WINDOW) return;
    const recent = this.history.slice(-PING_PONG_WINDOW).map(c => c.tool);
    
    // Detect A-B-A-B pattern
    const isAlternating = recent.every((t, i) => i < 2 || t === recent[i % 2]);
    const hasOnlyTwo = new Set(recent).size === 2;
    
    if (isAlternating && hasOnlyTwo) {
      this.emit('loop', {
        severity: 'warning',
        pattern: 'ping-pong',
        callCount: PING_PONG_WINDOW,
        tool: recent[recent.length - 1],
        message: `Warning: Ping-pong pattern detected between tools [${[...new Set(recent)].join(', ')}]. Agent may be stuck in decision loop.`
      } satisfies LoopEvent);
    }
  }
}
```

### Patch `src/core/runner.ts`

Cari di runner.ts tempat tool dipanggil (biasanya di method `runTool` atau `executeTool`). Tambah:

```typescript
// Di bagian imports
import { LoopDetector } from './loop-detector';

// Di dalam class Runner atau runWithSupervisor:
private loopDetector = new LoopDetector(this.sessionId ?? 'default');

// Setup di constructor atau init:
this.loopDetector.on('loop', (event: LoopEvent) => {
  if (event.severity === 'circuit-break') {
    this.logger.error(`[LoopDetector] ${event.message}`);
    // Inject interrupt ke agent: stop current task, notify user
    this.abort(`Loop detected: ${event.message}`);
  } else {
    this.logger.warn(`[LoopDetector] ${event.message}`);
    // Optional: inject warning into agent context
  }
});

// Wrap setiap tool call dengan record:
const before = Date.now();
const result = await tool.execute(params);
this.loopDetector.record({
  tool: tool.name,
  params,
  timestamp: before,
  result: result?.progress === false ? 'no-progress' : 'success'
});
```

---

## OC-6: EXEC APPROVALS — HUMAN IN THE LOOP (ASYNC)

**Research basis**: arXiv 2601.06223 (Safe & Responsible AI), OWASP AI Top 10 2026, Permit.io HITL patterns
**Gap**: Orion `tool-guard.ts` hanya block atau allow — tidak ada middle ground "tanya user dulu". OpenClaw kirim approval request ke chat, user approve/reject, agent resume.

### Buat file baru: `src/security/approval-gate.ts`

```typescript
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export type RiskLevel = 'read' | 'write-reversible' | 'write-irreversible' | 'exec-system';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  tool: string;
  params: Record<string, unknown>;
  riskLevel: RiskLevel;
  reasoning: string;     // why agent wants to do this
  createdAt: number;
  expiresAt: number;     // auto-reject after this
  status: ApprovalStatus;
  resolvedAt?: number;
  resolvedBy?: string;   // 'user' | 'timeout' | 'auto'
}

// Risk classification per tool name pattern
const RISK_MAP: Record<string, RiskLevel> = {
  'read_file': 'read',
  'list_directory': 'read',
  'web_search': 'read',
  'write_file': 'write-reversible',
  'create_file': 'write-reversible',
  'delete_file': 'write-irreversible',
  'exec_command': 'exec-system',
  'run_shell': 'exec-system',
  'send_message': 'write-reversible',
  'send_email': 'write-irreversible',
};

export class ApprovalGate {
  private pendingDir: string;
  private approvalTimeout: number;
  // Callback to send approval request to user's channel
  private notifyUser: (request: ApprovalRequest) => Promise<void>;

  constructor(opts: {
    workspaceDir: string;
    approvalTimeoutMs?: number;
    notifyUser: (request: ApprovalRequest) => Promise<void>;
  }) {
    this.pendingDir = path.join(opts.workspaceDir, 'memory', 'approvals');
    this.approvalTimeout = opts.approvalTimeoutMs ?? 5 * 60 * 1000; // 5 min default
    this.notifyUser = opts.notifyUser;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.pendingDir, { recursive: true });
  }

  classifyRisk(toolName: string): RiskLevel {
    for (const [pattern, level] of Object.entries(RISK_MAP)) {
      if (toolName.toLowerCase().includes(pattern)) return level;
    }
    // Unknown tools default to irreversible (safe-by-default)
    return 'write-irreversible';
  }

  requiresApproval(riskLevel: RiskLevel): boolean {
    return riskLevel === 'write-irreversible' || riskLevel === 'exec-system';
  }

  /** Request approval from user. Returns true if approved, false if rejected/timeout. */
  async requestApproval(opts: {
    sessionId: string;
    tool: string;
    params: Record<string, unknown>;
    reasoning: string;
  }): Promise<boolean> {
    const riskLevel = this.classifyRisk(opts.tool);
    if (!this.requiresApproval(riskLevel)) return true; // auto-approve safe ops
    
    const request: ApprovalRequest = {
      id: randomUUID(),
      sessionId: opts.sessionId,
      tool: opts.tool,
      params: opts.params,
      riskLevel,
      reasoning: opts.reasoning,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.approvalTimeout,
      status: 'pending'
    };

    // Persist pending request
    const filePath = path.join(this.pendingDir, `${request.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(request, null, 2));

    // Notify user via channel (async — non-blocking from agent perspective)
    await this.notifyUser(request);

    // Poll for resolution (with timeout)
    return this.waitForApproval(request.id, filePath);
  }

  /** Resolve a pending approval (called from channel handler when user responds) */
  async resolveApproval(approvalId: string, approved: boolean): Promise<void> {
    const filePath = path.join(this.pendingDir, `${approvalId}.json`);
    const raw = await fs.readFile(filePath, 'utf8');
    const request: ApprovalRequest = JSON.parse(raw);
    
    request.status = approved ? 'approved' : 'rejected';
    request.resolvedAt = Date.now();
    request.resolvedBy = 'user';
    
    await fs.writeFile(filePath, JSON.stringify(request, null, 2));
  }

  private async waitForApproval(id: string, filePath: string): Promise<boolean> {
    const maxWait = this.approvalTimeout;
    const pollInterval = 2000; // check every 2s
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));
      
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const req: ApprovalRequest = JSON.parse(raw);
        
        if (req.status === 'approved') {
          await fs.unlink(filePath).catch(() => {}); // cleanup
          return true;
        }
        if (req.status === 'rejected') {
          await fs.unlink(filePath).catch(() => {}); // cleanup
          return false;
        }
      } catch {
        // File removed externally = rejected
        return false;
      }
    }

    // Timeout — auto-reject
    await fs.unlink(filePath).catch(() => {});
    return false;
  }

  /** List all pending approvals (for dashboard/status) */
  async listPending(): Promise<ApprovalRequest[]> {
    const files = await fs.readdir(this.pendingDir).catch(() => [] as string[]);
    const requests: ApprovalRequest[] = [];
    
    for (const f of files.filter(f => f.endsWith('.json'))) {
      const raw = await fs.readFile(path.join(this.pendingDir, f), 'utf8');
      const req: ApprovalRequest = JSON.parse(raw);
      if (req.status === 'pending' && req.expiresAt > Date.now()) {
        requests.push(req);
      }
    }
    return requests;
  }
}
```

### Format pesan approval ke user (inject ke channel)

```typescript
// Di src/channels/gateway.ts atau message formatter

function formatApprovalRequest(req: ApprovalRequest): string {
  const riskEmoji = {
    'read': '📖',
    'write-reversible': '✏️',
    'write-irreversible': '⚠️',
    'exec-system': '🔴'
  }[req.riskLevel];
  
  const expiresIn = Math.round((req.expiresAt - Date.now()) / 60_000);
  
  return `${riskEmoji} **Approval Required**

**Tool**: \`${req.tool}\`
**Risk**: ${req.riskLevel}
**Reason**: ${req.reasoning}

**Params**:
\`\`\`json
${JSON.stringify(req.params, null, 2)}
\`\`\`

Reply **approve ${req.id.slice(0,8)}** or **reject ${req.id.slice(0,8)}**
Auto-rejects in ${expiresIn} minutes.`;
}
```

### Patch `src/security/tool-guard.ts`

Setelah `toolGuard.check(tool, params)` pass, cek approval:

```typescript
// Import
import { ApprovalGate } from './approval-gate';

// Di dalam tool execution:
const approved = await approvalGate.requestApproval({
  sessionId: ctx.sessionId,
  tool: toolName,
  params,
  reasoning: ctx.lastAgentThought ?? 'No reasoning provided'
});

if (!approved) {
  return { error: 'Action rejected by user or timed out.', tool: toolName };
}
// proceed with tool execution
```

### Parse user response di channel handler

```typescript
// Di src/channels/gateway.ts — incoming message handler
const approveMatch = userMessage.match(/^approve\s+([a-f0-9]{8})/i);
const rejectMatch = userMessage.match(/^reject\s+([a-f0-9]{8})/i);

if (approveMatch) {
  const shortId = approveMatch[1];
  const pending = await approvalGate.listPending();
  const req = pending.find(r => r.id.startsWith(shortId));
  if (req) {
    await approvalGate.resolveApproval(req.id, true);
    return { reply: `✅ Action approved. Orion will proceed.` };
  }
}

if (rejectMatch) {
  // similar, resolveApproval(id, false)
}
```

---

## OC-7: CONTEXT COMPACTION AUTO-TRIGGER

**Research basis**: arXiv 2512.10398 (Confucius Code Agent), arXiv 2512.09458 (Agentic AI Architecture)
**Gap**: `session-summarizer.ts` ada tapi tidak pernah di-trigger otomatis. Tidak ada tiered retention, tidak ada hindsight notes dari failures.

### Buat file baru: `src/memory/compaction-manager.ts`

```typescript
import { SessionSummarizer } from './session-summarizer';
import { promises as fs } from 'fs';
import path from 'path';

interface CompactionConfig {
  triggerThreshold: number;    // 0.0-1.0 — fraction of context window filled
  maxContextTokens: number;    // model context limit
  workspaceDir: string;
  model: string;               // model to use for summarization
}

interface CompactionResult {
  triggered: boolean;
  summary?: string;
  tokensBefore: number;
  tokensAfter?: number;
  hindsightNotes?: string[];   // failure lessons extracted
}

export class CompactionManager {
  private config: CompactionConfig;
  private summarizer: SessionSummarizer;

  constructor(config: CompactionConfig) {
    this.config = config;
    this.summarizer = new SessionSummarizer({ model: config.model });
  }

  /** Estimate token count (simple heuristic: 1 token ≈ 4 chars) */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Check if compaction should trigger */
  shouldCompact(currentContextText: string): boolean {
    const tokens = this.estimateTokens(currentContextText);
    const threshold = this.config.maxContextTokens * this.config.triggerThreshold;
    return tokens >= threshold;
  }

  /** Run compaction: summarize + extract hindsight from failures */
  async compact(opts: {
    messages: Array<{ role: string; content: string }>;
    recentN?: number;   // keep last N messages raw, summarize the rest
    sessionId: string;
  }): Promise<CompactionResult> {
    const keepN = opts.recentN ?? 10;
    const toSummarize = opts.messages.slice(0, -keepN);
    const toKeep = opts.messages.slice(-keepN);

    const contextText = toSummarize.map(m => `${m.role}: ${m.content}`).join('\n');
    const tokensBefore = this.estimateTokens(contextText);

    if (toSummarize.length === 0) {
      return { triggered: false, tokensBefore };
    }

    // Generate summary
    const summary = await this.summarizer.summarize(toSummarize);

    // Extract hindsight notes from failures in the to-summarize messages
    const hindsightNotes = await this.extractHindsight(toSummarize, opts.sessionId);

    const tokensAfter = this.estimateTokens(summary);

    return {
      triggered: true,
      summary,
      tokensBefore,
      tokensAfter,
      hindsightNotes
    };
  }

  /** Extract lessons from failed tool calls and agent errors */
  private async extractHindsight(
    messages: Array<{ role: string; content: string }>,
    sessionId: string
  ): Promise<string[]> {
    const errorMessages = messages.filter(m =>
      m.content.includes('Error:') ||
      m.content.includes('failed') ||
      m.content.includes('circuit-break') ||
      m.content.includes('loop detected')
    );

    if (errorMessages.length === 0) return [];

    // Simple extraction: for each error, note what happened
    const notes: string[] = errorMessages.map(m => {
      const date = new Date().toISOString().split('T')[0];
      return `[${date}] Failure noted: ${m.content.slice(0, 200)}`;
    });

    // Persist hindsight notes
    await this.saveHindsight(notes, sessionId);
    return notes;
  }

  /** Save hindsight notes to workspace/memory/hindsight/ */
  private async saveHindsight(notes: string[], sessionId: string): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const hindsightDir = path.join(this.config.workspaceDir, 'memory', 'hindsight');
    await fs.mkdir(hindsightDir, { recursive: true });

    const filePath = path.join(hindsightDir, `${date}.md`);
    const existing = await fs.readFile(filePath, 'utf8').catch(() => '');
    const newContent = existing + '\n' + notes.map(n => `- ${n}`).join('\n');
    await fs.writeFile(filePath, newContent.trim() + '\n');
  }
}
```

### Patch `src/core/bootstrap.ts` (atau main conversation loop)

Di tempat messages array dibangun sebelum dikirim ke LLM:

```typescript
import { CompactionManager } from '../memory/compaction-manager';

const compactionMgr = new CompactionManager({
  triggerThreshold: 0.70,          // trigger at 70% context fill
  maxContextTokens: 128_000,       // adjust per model
  workspaceDir: workspaceDir,
  model: 'gemini-flash'            // cheap model for summarization
});

// Before sending to LLM:
const contextText = messages.map(m => m.content).join('\n');

if (compactionMgr.shouldCompact(contextText)) {
  const result = await compactionMgr.compact({
    messages,
    recentN: 12,
    sessionId
  });

  if (result.triggered && result.summary) {
    // Replace old messages with summary + keep recent
    messages = [
      { role: 'system', content: `[Context Compacted]\n${result.summary}` },
      ...messages.slice(-12)
    ];
    logger.info(`[Compaction] ${result.tokensBefore}t → ${result.tokensAfter}t`);
    
    if (result.hindsightNotes?.length) {
      logger.info(`[Compaction] ${result.hindsightNotes.length} hindsight notes saved`);
    }
  }
}
```

---

## OC-8: ADAPTIVE ENGINE ROUTING (DIFFICULTY-AWARE)

**Research basis**: arXiv 2602.16873 (AdaptOrch), arXiv 2509.11079 (DAAO)
**Gap**: `src/engine/orchestrator.ts` routing flat — fixed priority list tanpa latency tracking, cost awareness, atau difficulty estimation.

### Buat file baru: `src/engine/difficulty-router.ts`

```typescript
export type TaskDifficulty = 1 | 2 | 3 | 4 | 5;

export interface EngineMetrics {
  name: string;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;       // 0-1
  costPer1kTokens: number; // USD
  lastUpdated: number;
}

// Default engine costs (adjust to actual pricing)
const ENGINE_COSTS: Record<string, number> = {
  'groq-llama-3.3-70b': 0.0006,
  'gemini-2.0-flash': 0.00015,
  'gemini-1.5-pro': 0.00125,
  'gpt-4o-mini': 0.00015,
  'gpt-4o': 0.0025,
  'claude-sonnet': 0.003,
  'qwen3': 0.0004,
};

// Difficulty-to-engine tier mapping
// Tier 1 = fast/cheap, Tier 3 = smart/expensive
const DIFFICULTY_TIERS: Record<TaskDifficulty, string[]> = {
  1: ['groq-llama-3.3-70b', 'gemini-2.0-flash', 'gpt-4o-mini'],
  2: ['gemini-2.0-flash', 'gpt-4o-mini', 'qwen3'],
  3: ['gemini-1.5-pro', 'gpt-4o', 'qwen3'],
  4: ['gpt-4o', 'claude-sonnet', 'gemini-1.5-pro'],
  5: ['claude-sonnet', 'gpt-4o'],
};

export class DifficultyRouter {
  private metrics: Map<string, EngineMetrics> = new Map();
  private latencyHistory: Map<string, number[]> = new Map();

  /** Estimate task difficulty based on heuristics */
  estimateDifficulty(prompt: string, taskType?: string): TaskDifficulty {
    const len = prompt.length;
    const hasCode = /```|function|class|import|def /.test(prompt);
    const hasMultiStep = /\band\b.*\bthen\b|\bstep\b|\bfirst\b.*\bnext\b/i.test(prompt);
    const hasReasoning = /why|explain|analyze|compare|critique/i.test(prompt);
    const isSimple = len < 200 && !hasCode && !hasMultiStep;

    if (taskType === 'code' || (hasCode && hasMultiStep)) return 4;
    if (taskType === 'reasoning' || hasReasoning) return 3;
    if (isSimple) return 1;
    if (len < 500 && !hasMultiStep) return 2;
    return 3; // default medium
  }

  /** Select best engine for given difficulty and constraints */
  selectEngine(difficulty: TaskDifficulty, opts?: {
    preferLowLatency?: boolean;
    maxCostPer1k?: number;
    excludeEngines?: string[];
  }): string {
    const candidates = DIFFICULTY_TIERS[difficulty]
      .filter(e => !(opts?.excludeEngines ?? []).includes(e))
      .filter(e => {
        const cost = ENGINE_COSTS[e] ?? Infinity;
        return !opts?.maxCostPer1k || cost <= opts.maxCostPer1k;
      });

    if (candidates.length === 0) {
      // Fallback: cheapest available
      return Object.entries(ENGINE_COSTS).sort((a, b) => a[1] - b[1])[0][0];
    }

    if (opts?.preferLowLatency) {
      // Sort by avg latency
      return candidates.sort((a, b) => {
        const la = this.metrics.get(a)?.avgLatencyMs ?? 5000;
        const lb = this.metrics.get(b)?.avgLatencyMs ?? 5000;
        return la - lb;
      })[0];
    }

    // Default: pick first (already ordered by preference per tier)
    return candidates[0];
  }

  /** Record actual latency after request completes */
  recordLatency(engine: string, latencyMs: number, success: boolean): void {
    if (!this.latencyHistory.has(engine)) {
      this.latencyHistory.set(engine, []);
    }
    const hist = this.latencyHistory.get(engine)!;
    hist.push(latencyMs);
    if (hist.length > 50) hist.shift(); // keep last 50

    const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    const sorted = [...hist].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;

    const existing = this.metrics.get(engine);
    const errRate = success
      ? (existing?.errorRate ?? 0) * 0.9    // decay error rate
      : Math.min(1, (existing?.errorRate ?? 0) + 0.1); // increase on error

    this.metrics.set(engine, {
      name: engine,
      avgLatencyMs: avg,
      p95LatencyMs: p95,
      errorRate: errRate,
      costPer1kTokens: ENGINE_COSTS[engine] ?? 0.001,
      lastUpdated: Date.now()
    });
  }

  /** Get current metrics for all tracked engines */
  getMetrics(): EngineMetrics[] {
    return [...this.metrics.values()];
  }
}
```

### Patch `src/engine/orchestrator.ts`

```typescript
import { DifficultyRouter } from './difficulty-router';

// Di dalam class Orchestrator:
private diffRouter = new DifficultyRouter();

// Ganti bagian pilih engine dari:
// const engine = this.engines[taskType]?.[0] ?? this.defaultEngine;
// Menjadi:
const difficulty = this.diffRouter.estimateDifficulty(prompt, taskType);
const engineName = this.diffRouter.selectEngine(difficulty, {
  excludeEngines: this.failedEngines,
  maxCostPer1k: this.costBudget
});
const engine = this.getEngineByName(engineName);

// Setelah request selesai, record latency:
const latencyMs = Date.now() - requestStart;
this.diffRouter.recordLatency(engineName, latencyMs, !isError);
```

---

## CHECKLIST IMPLEMENTASI

Jalankan ini secara berurutan:

```
[ ] OC-5: Buat src/core/loop-detector.ts
[ ] OC-5: Patch src/core/runner.ts (wrap tool calls + handle loop events)
[ ] OC-6: Buat src/security/approval-gate.ts
[ ] OC-6: Patch src/security/tool-guard.ts (tambah approval check)
[ ] OC-6: Patch src/channels/gateway.ts (parse approve/reject commands)
[ ] OC-7: Buat src/memory/compaction-manager.ts
[ ] OC-7: Patch bootstrap.ts / main conversation loop (compaction trigger)
[ ] OC-8: Buat src/engine/difficulty-router.ts
[ ] OC-8: Patch src/engine/orchestrator.ts (replace flat routing)
[ ] Test: npm run build — zero TypeScript errors
[ ] Test: Kirim pesan ke bot, verify loop detector aktif
[ ] Test: Kirim command yang trigger approval, verify pesan dikirim ke channel
[ ] Test: Send 200+ turns, verify compaction triggered at 70% context
[ ] Test: Kirim 10 task berbeda, verify engine selection bervariasi by difficulty
```

---

## SETELAH OC-5 SAMPAI OC-8 SELESAI

Feature parity Orion vs OpenClaw akan tercapai. Langkah selanjutnya (OC-9+):

- **OC-9**: Hindsight Memory upgrade — 4-network memory model (arXiv 2512.12818)
- **OC-10**: FTS fallback di LanceDB search (keyword search backup)
- **OC-11**: Token usage dashboard + per-session cost tracking
- **OC-12**: Talk Mode dua arah (receive voice → Whisper → respond)
- **OC-13**: Multi-tenant workspace isolation (SaaS foundation)
- **OC-14**: Conductor-style topology selection (arXiv 2512.04388)
