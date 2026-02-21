# Phase F — Real-time Architecture: Event-Driven

## Papers
**[1] Asynchronous Tool Usage for Real-Time Agents**
arXiv: 2410.21620 | Oct 2024 | Event-driven FSM for AI agents

**[2] X-Talk: Modular Speech-to-Speech with Centralized Event Bus**
arXiv: 2512.18706 | Dec 2025 | Event bus architecture, full-duplex

**[3] ALAS: Adaptive LLM Agent Scheduler**
arXiv: 2505.12501 | May 2025 | Event-driven multi-agent execution

## Core Idea dari Papers
Daemon Orion sekarang: polling setiap 10-60 detik.
Masalah: lambat, miss events, waste API calls kalau tidak ada activity.

Event-driven architecture (dari X-Talk dan ALAS):
- Internal event bus menggunakan EventEmitter atau BullMQ
- Setiap komponen subscribe ke events yang relevan
- Action terjadi segera ketika event masuk, bukan tunggu polling interval

Event types untuk Orion:
```
user.message.received      → trigger memory save + response generation
user.message.sent          → trigger memrl feedback update
channel.connected          → trigger welcome message
channel.disconnected       → log + cleanup
trigger.fired              → daemon proactive action
memory.threshold.reached   → trigger consolidation
system.health              → periodic health check
```

Manfaat konkret:
- Response latency turun (tidak tunggu polling cycle)
- Daemon tidak perlu loop — hanya react ke events
- Memory operations bisa overlap dengan response generation (parallel)

## Gap di Orion Sekarang
`background/daemon.ts` — polling loop setiap N detik.
`main.ts` — sequential: save memory → build context → generate → save response.
Memory save dan LLM call bisa diparalel tapi tidak.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Implementasi event-driven architecture.
Paper referensi: arXiv 2410.21620, 2512.18706

### TASK: Phase F — Event Bus Architecture

Target files:
- `src/core/event-bus.ts` (file baru)
- `src/background/daemon.ts` (refactor)
- `src/main.ts` (optimize — parallelkan operasi)

#### Step 1: Buat src/core/event-bus.ts

Gunakan Node.js built-in EventEmitter (zero dependency).

```typescript
import { EventEmitter } from "node:events"
import { createLogger } from "../logger.js"

const log = createLogger("core.event-bus")

// Definisi semua event types
export type OrionEvent =
  | { type: "user.message.received"; userId: string; content: string; channel: string; timestamp: number }
  | { type: "user.message.sent"; userId: string; content: string; channel: string; timestamp: number }
  | { type: "memory.save.requested"; userId: string; content: string; metadata: Record<string, unknown> }
  | { type: "trigger.fired"; triggerName: string; userId: string; message: string; priority: string }
  | { type: "channel.connected"; channelName: string }
  | { type: "channel.disconnected"; channelName: string; reason?: string }
  | { type: "memory.consolidate.requested"; userId: string }
  | { type: "profile.update.requested"; userId: string; content: string }
  | { type: "causal.update.requested"; userId: string; content: string }
  | { type: "system.heartbeat"; timestamp: number }

class OrionEventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
  }

  emit<T extends OrionEvent["type"]>(
    eventType: T,
    data: Extract<OrionEvent, { type: T }>
  ): boolean {
    log.debug("event emitted", { type: eventType })
    return super.emit(eventType, data)
  }

  on<T extends OrionEvent["type"]>(
    eventType: T,
    listener: (data: Extract<OrionEvent, { type: T }>) => void | Promise<void>
  ): this {
    return super.on(eventType, (data) => {
      const result = listener(data)
      if (result instanceof Promise) {
        result.catch((error) => log.error(`Event handler error for ${eventType}`, error))
      }
    })
  }

  // Fire and forget — emit without waiting
  dispatch<T extends OrionEvent["type"]>(
    eventType: T,
    data: Omit<Extract<OrionEvent, { type: T }>, "type">
  ): void {
    const fullData = { ...data, type: eventType } as Extract<OrionEvent, { type: T }>
    this.emit(eventType, fullData)
  }
}

export const eventBus = new OrionEventBus()
```

#### Step 2: Refactor background/daemon.ts
Ganti polling loop dengan event listener:

```typescript
// Hapus setInterval/setTimeout loop
// Ganti dengan event-based triggers

import { eventBus } from "../core/event-bus.js"

// Di method start():
async start(): Promise<void> {
  if (this.running) return

  this.running = true
  log.info("daemon started (event-driven mode)")

  // Subscribe ke events yang relevan untuk proactive behavior
  eventBus.on("user.message.received", async (data) => {
    this.lastActivityTime = data.timestamp
    // Reset interval jika ada activity
  })

  eventBus.on("system.heartbeat", async (data) => {
    // Jalankan trigger evaluation setiap heartbeat
    await this.runCycle()
  })

  // Start heartbeat — ini yang gantikan polling loop
  // Interval tetap ada tapi lebih sederhana
  this.startHeartbeat()
}

private startHeartbeat(): void {
  const tick = () => {
    eventBus.dispatch("system.heartbeat", { timestamp: Date.now() })
    
    // Adaptive interval
    const timeSinceActivity = Date.now() - this.lastActivityTime
    const nextInterval = timeSinceActivity > INACTIVITY_THRESHOLD_MS
      ? INTERVAL_LOW_MS
      : INTERVAL_NORMAL_MS

    this.interval = setTimeout(tick, nextInterval)
  }
  
  this.interval = setTimeout(tick, INTERVAL_NORMAL_MS)
}
```

#### Step 3: Optimize main.ts — Parallelkan Operasi
Sekarang di main.ts, urutan sequential:
1. saveMessage → 2. memory.save → 3. buildContext → 4. generate → 5. save response

Yang bisa diparalel:
- Memory save dan profiler extraction bisa jalan bersamaan
- Causal graph update bisa async (tidak perlu ditunggu)
- Memory save AFTER generate bisa async

```typescript
// SEBELUM (sequential):
await saveMessage(...)
await memory.save(...)
const context = await memory.buildContext(...)
const response = await orchestrator.generate(...)
await saveMessage(userId, "assistant", response, ...)
await memory.save(userId, response, ...)

// SESUDAH (parallelized):
// 1. Dispatch events untuk background operations
eventBus.dispatch("memory.save.requested", { userId, content: text, metadata: {...} })
eventBus.dispatch("profile.update.requested", { userId, content: text })
eventBus.dispatch("causal.update.requested", { userId, content: text })

// 2. Database save dan context build bisa parallel
const [, context] = await Promise.all([
  saveMessage(userId, "user", text, "cli", {...}),
  memory.buildContext(userId, text),
])

// 3. Generate response
const response = await orchestrator.generate("reasoning", {...})

// 4. Response saves juga parallel
eventBus.dispatch("memory.save.requested", {
  userId,
  content: response,
  metadata: { role: "assistant", ... }
})
await saveMessage(userId, "assistant", response, ...)  // hanya ini yang harus ditunggu
```

Setup event listeners di start():
```typescript
eventBus.on("memory.save.requested", async (data) => {
  await memory.save(data.userId, data.content, data.metadata)
})

eventBus.on("profile.update.requested", async (data) => {
  const { facts, opinions } = await profiler.extractFromMessage(data.userId, data.content, "user")
  await profiler.updateProfile(data.userId, facts, opinions)
})

eventBus.on("causal.update.requested", async (data) => {
  await causalGraph.extractAndUpdate(data.userId, data.content)
})
```

### Constraints
- EventEmitter sudah built-in Node.js, zero new dependencies
- Semua event handlers harus punya error handling (try-catch atau .catch)
- Jangan paralel operasi yang dependent satu sama lain
- Heartbeat harus bisa di-stop bersih saat shutdown
- Zero TypeScript errors
- Jangan hapus existing daemon logic, hanya restructure
```

## Cara Test
```bash
pnpm dev --mode text
# Check logs untuk timing
# Sebelum: sequential, setiap operation punya timestamp sendiri
# Sesudah: memory saves terjadi background, response lebih cepat
# Benchmark: waktu dari user input ke response output

# Check dengan time command:
time echo "halo" | pnpm dev --mode text
```

## Expected Outcome
- Response latency berkurang karena operasi background diparalel
- Daemon tidak waste CPU saat tidak ada activity
- System lebih reactive: kalau ada event masuk, action segera
- Foundation untuk real-time features (Phase G)
