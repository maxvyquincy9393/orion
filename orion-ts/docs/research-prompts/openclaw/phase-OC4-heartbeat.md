# Phase OC-4 — Proactive Heartbeat (Inner Thoughts Pattern)

## Paper Backing
**[1] Inner Thoughts for Proactive AI Assistants (CHI 2025)**
Verified from web research. CHI 2025.
AI punya "thought reservoir" yang terus diisi dari memory dan context.
Setiap thought punya intrinsic motivation score.
AI interrupt hanya kalau score melewati threshold.
Ini jauh lebih sophisticated dari "check setiap 60 detik."

**[2] Goldilocks Timing Window**
arXiv: 2504.09332 | April 2025
Formalize timing optimal untuk intervene:
- Terlalu awal: false positive tinggi
- Terlalu late: efek berkurang
- Window optimal: setelah context change, sebelum user lanjut ke activity baru

**[3] OpenClaw Heartbeat Architecture (Production Pattern)**
"The agent wakes itself periodically, reviews recent context, reflects,
and decides whether action is needed." — from leonisnewsletter.substack.com
Ini bukan polling. Ini conscious reflection cycle.

## OpenClaw vs Orion Heartbeat

OpenClaw approach:
- Agent "tidur" untuk duration adaptive
- Saat bangun: baca recent context → reflect → decide
- Tidak hanya check YAML triggers — agent reason tentang apakah ada yang perlu dilakukan
- HEARTBEAT.md adalah checklist yang di-inject ke system prompt saat heartbeat run

Orion sekarang:
- `daemon.ts` polling setiap 10-60 detik
- Evaluate YAML-defined triggers
- VoI calculator ada tapi triggers masih static
- Tidak ada reflection phase

Perbedaan fundamental: OpenClaw heartbeat adalah **agent reasoning run**,
bukan hanya trigger evaluation. Agent bisa notice hal yang tidak ada di trigger list.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Upgrade proactive system ke heartbeat pattern.
Reference: OpenClaw heartbeat architecture + CHI 2025 Inner Thoughts paper

### TASK: Phase OC-4 — Heartbeat Architecture

Target files:
- `workspace/HEARTBEAT.md` (file baru — heartbeat instructions)
- `src/background/heartbeat.ts` (file baru — replaces simple polling)
- `src/background/daemon.ts` (refactor — use new heartbeat)

#### Step 1: Buat workspace/HEARTBEAT.md

Ini adalah checklist yang di-inject saat heartbeat run.
Agent akan reasoning berdasarkan ini:

```markdown
# Orion Heartbeat Protocol

When running a heartbeat check, review the following:

## Check 1: Pending Items
- Are there any tasks or requests from the user that I said I would do?
- Are there any follow-ups I promised but haven't done?
- Did the user ask me to remind them about something?

## Check 2: Context Relevance
- Has anything new happened (based on recent memory) that the user should know about?
- Are there patterns I've noticed that might be worth sharing?
- Is there a better time to share something I've been waiting to share?

## Check 3: Timing Assessment
- What time is it locally for the user?
- When did we last interact? How long ago?
- Is this a reasonable time to interrupt them?

## Check 4: Value Assessment
- If I send a message, will it genuinely help them right now?
- Or am I sending it because it's interesting to ME, not them?
- Can this wait until they reach out?

## Response Protocol
- If nothing needs attention: reply HEARTBEAT_OK (this reply is stripped and not shown)
- If something needs attention: compose and send the message
- Never send more than one proactive message per heartbeat unless truly urgent
```

#### Step 2: Buat src/background/heartbeat.ts

```typescript
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import { getHistory } from "../database/index.js"
import { identityManager } from "../core/identity.js"
import { voiCalculator } from "../core/voi.js"
import { contextPredictor } from "../core/context-predictor.js"
import { channelManager } from "../channels/manager.js"
import { sandbox, PermissionAction } from "../permissions/sandbox.js"
import config from "../config.js"
import fs from "node:fs/promises"
import path from "node:path"

const log = createLogger("background.heartbeat")

const HEARTBEAT_MD = path.resolve(process.cwd(), "workspace", "HEARTBEAT.md")
const HEARTBEAT_OK_MARKER = "HEARTBEAT_OK"

// Adaptive intervals
const INTERVAL_AFTER_RECENT_ACTIVITY = 2 * 60 * 1000    // 2 menit setelah activity
const INTERVAL_NORMAL = 10 * 60 * 1000                   // 10 menit normal
const INTERVAL_INACTIVE = 30 * 60 * 1000                 // 30 menit kalau sudah lama tidak aktif
const INACTIVITY_THRESHOLD = 60 * 60 * 1000              // 1 jam dianggap inactive

export class HeartbeatEngine {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private lastActivityTime = Date.now()
  private lastHeartbeatTime = 0
  private consecutiveSkips = 0

  start(): void {
    if (this.running) return
    this.running = true
    log.info("heartbeat engine started")
    this.scheduleNext()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.running = false
    log.info("heartbeat engine stopped")
  }

  recordActivity(): void {
    this.lastActivityTime = Date.now()
  }

  isRunning(): boolean {
    return this.running
  }

  private scheduleNext(): void {
    const interval = this.calculateInterval()
    this.timer = setTimeout(async () => {
      await this.runHeartbeat()
      if (this.running) {
        this.scheduleNext()
      }
    }, interval)
  }

  private calculateInterval(): number {
    const timeSinceActivity = Date.now() - this.lastActivityTime

    if (timeSinceActivity < 5 * 60 * 1000) {
      return INTERVAL_AFTER_RECENT_ACTIVITY
    }
    if (timeSinceActivity > INACTIVITY_THRESHOLD) {
      return INTERVAL_INACTIVE
    }
    return INTERVAL_NORMAL
  }

  private async runHeartbeat(): Promise<void> {
    const userId = config.DEFAULT_USER_ID
    this.lastHeartbeatTime = Date.now()

    try {
      // Load heartbeat instructions
      let heartbeatInstructions: string
      try {
        heartbeatInstructions = await fs.readFile(HEARTBEAT_MD, "utf-8")
      } catch {
        log.debug("HEARTBEAT.md not found, skipping heartbeat reasoning")
        return
      }

      // Load recent context for agent to reason over
      const recentHistory = await getHistory(userId, 20)
      const recentSummary = recentHistory
        .slice(0, 10)
        .map(m => `${m.role}: ${m.content.slice(0, 100)}`)
        .join("\n")

      const identityContext = await identityManager.buildIdentityContext({ isDM: true, isSubagent: true })
      const currentTime = new Date().toLocaleString()

      // Agent reasoning run — bukan hanya trigger check
      const heartbeatPrompt = `${identityContext}

${heartbeatInstructions}

Current time: ${currentTime}
Time since last user interaction: ${Math.round((Date.now() - this.lastActivityTime) / 60000)} minutes

Recent conversation summary:
${recentSummary || "(no recent conversations)"}

Run the heartbeat check. If nothing needs attention, reply only with: ${HEARTBEAT_OK_MARKER}
If something needs attention, compose the message to send.`

      const response = await orchestrator.generate("fast", { prompt: heartbeatPrompt })

      // Check if agent decided nothing to do
      if (response.trim() === HEARTBEAT_OK_MARKER || response.includes(HEARTBEAT_OK_MARKER)) {
        this.consecutiveSkips++
        log.debug("heartbeat: no action needed", { consecutiveSkips: this.consecutiveSkips })
        return
      }

      this.consecutiveSkips = 0

      // VoI check before sending
      const channel = "webchat"
      const context = await contextPredictor.predict(userId, channel)
      const voi = voiCalculator.calculate({
        userId,
        messageContent: response,
        triggerType: "heartbeat",
        triggerPriority: "normal",
        currentHour: new Date().getHours(),
        context,
      })

      if (!voi.shouldSend) {
        log.info("heartbeat: VoI blocked message", { score: voi.score, reasoning: voi.reasoning })
        return
      }

      // Permission check
      const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, userId)
      if (!allowed) {
        log.info("heartbeat: sandbox blocked proactive message")
        return
      }

      // Send
      const sent = await channelManager.send(userId, response)
      if (sent) {
        this.recordActivity()
        log.info("heartbeat: proactive message sent", { length: response.length })
      }
    } catch (error) {
      log.error("heartbeat run failed", error)
    }
  }
}

export const heartbeat = new HeartbeatEngine()
```

#### Step 3: Refactor daemon.ts
Ganti simple polling dengan heartbeat engine:

```typescript
import { heartbeat } from "./heartbeat.js"

// Di OrionDaemon.start():
async start(): Promise<void> {
  if (this.running) return
  this.running = true
  log.info("daemon started")

  // Start heartbeat engine (replaces polling loop)
  heartbeat.start()

  // Keep existing trigger YAML evaluation as fallback
  // (untuk backward compat dengan triggers.yaml yang sudah ada)
}

// Di OrionDaemon.stop():
stop(): void {
  heartbeat.stop()
  this.running = false
}

// Record activity dari channel messages:
// Tambahkan di channelManager.send() atau di main.ts loop:
// heartbeat.recordActivity()
```

### Constraints
- Heartbeat run harus pakai engine "fast" (Groq) — hemat biaya
- HEARTBEAT_OK response harus di-strip, tidak dikirim ke user
- Adaptive interval harus berdasarkan actual activity, bukan hardcoded
- Consecutive skips boleh dipakai untuk adjust interval (lebih banyak skips → interval lebih panjang)
- Zero TypeScript errors
- Heartbeat tidak boleh jam overlap (timer-based, bukan interval-based)
```

## Cara Test
```bash
pnpm dev --mode gateway
# Wait 2-3 menit tanpa interaksi
# Check logs: grep "heartbeat" logs/orion*.log
# Harusnya ada: "heartbeat: no action needed" atau "heartbeat: proactive message sent"

# Edit HEARTBEAT.md untuk test proactive behavior:
# Tambahkan: "If more than 2 minutes have passed, remind the user to take a break."
# Tunggu 2 menit → Orion harusnya kirim reminder
```

## Expected Outcome
- Orion bukan hanya reactive (tunggu user ngomong) tapi genuinely proactive
- Heartbeat reasoning menggunakan full context — bukan hanya static triggers
- Timing intelligent: tidak interrupt saat subuh atau saat user baru saja aktif
- Pesan proaktif terasa natural, bukan automated spam
- User bisa control behavior dengan edit HEARTBEAT.md
