# Atom 6 — perception-fusion.test.ts

**File target:** `src/os-agent/__tests__/perception-fusion.test.ts`  
**Source yang ditest:** `src/os-agent/perception-fusion.ts`  
**Dependencies:** Semua atom sebelumnya (semua subsystem di-mock)  
**Tests:** 8 tests  
**Coverage target:** 90% — ini safety-critical layer

---

## Apa yang Harus Diperbaiki di Source (`perception-fusion.ts`)

### 1. `PerceptionFusion` menerima `deps` object (bukan config)

```typescript
interface PerceptionDeps {
  gui: GUIAgent
  vision: VisionCortex
  voice: VoiceIO
  system: SystemMonitor
  iot: IoTBridge
}

constructor(private deps: PerceptionDeps) {}
```

**Implikasi test:** Kita tidak perlu instan class nyata — cukup buat **mock object** yang punya methods yang diperlukan. Ini jauh lebih simpel.

### 2. `getSnapshot()` menyimpan cache dan check staleness

```typescript
async getSnapshot(): Promise<PerceptionSnapshot> {
  if (!this.lastSnapshot) {
    await this.refresh()
  }

  const age = Date.now() - this.lastSuccessfulRefresh
  if (age > PerceptionFusion.STALE_THRESHOLD_MS) {
    // STALE_THRESHOLD_MS = 10_000
    try {
      await this.refresh()
    } catch { }
  }

  return this.lastSnapshot!
}
```

**Test staleness:** Mock `Date.now()` advance > 10_000ms setelah snapshot diambil.

### 3. `detectActivity()` adalah private

```typescript
private detectActivity(screen: ScreenState | null): ActiveContext {
  // Match window patterns...
}
```

**Solusi:** Test ini via `getSnapshot()` — buat mock `vision.getScreenState()` return screen state dengan title tertentu, lalu assert `snapshot.activeContext.userActivity`.

### 4. `summarize()` adalah public pure method

```typescript
summarize(): string {
  if (!this.lastSnapshot) return "No perception data available."
  // Build string dari lastSnapshot...
}
```

**Test:** Get snapshot dulu, lalu call summarize(), assert format output.

### 5. `refresh()` memanggil deps secara parallel

```typescript
private async refresh(): Promise<void> {
  const [screen, iotState] = await Promise.all([
    this.deps.vision.getScreenState().catch(() => null),
    this.deps.iot.getStates().catch(() => ({ connectedDevices: 0, devices: [] })),
  ])
  const systemState = this.deps.system.state
  // ...
}
```

**Implikasi:** Semua deps harus punya method yang di-mock:
- `deps.vision.getScreenState()` → return ScreenState
- `deps.iot.getStates()` → return IoTState
- `deps.system.state` → getter return SystemState
- `deps.voice.isSpeaking` → getter
- `deps.voice.wakeWordDetected` → getter
- `deps.voice.audioLevel` → getter
- `deps.voice.lastTranscript` → getter
- `deps.system.startMonitoring()` → void
- `deps.system.stopMonitoring()` → void

---

## Mock Setup

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { PerceptionFusion } from "../perception-fusion.js"
import {
  createMockSystemState,
  createMockScreenState,
  createMockIoTState,
} from "./test-helpers.js"
import type { GUIAgent } from "../gui-agent.js"
import type { VisionCortex } from "../vision-cortex.js"
import type { VoiceIO } from "../voice-io.js"
import type { SystemMonitor } from "../system-monitor.js"
import type { IoTBridge } from "../iot-bridge.js"

// Helper: buat mock deps object
function createMockDeps(overrides: Partial<{
  screenState: any,
  iotState: any,
  systemState: any,
  voiceState: any,
}> = {}) {
  const screenState = overrides.screenState ?? createMockScreenState()
  const iotState = overrides.iotState ?? createMockIoTState()
  const systemState = overrides.systemState ?? createMockSystemState()

  return {
    gui: {} as GUIAgent,
    vision: {
      getScreenState: vi.fn().mockResolvedValue(screenState),
    } as unknown as VisionCortex,
    voice: {
      isSpeaking: false,
      wakeWordDetected: false,
      audioLevel: 0,
      lastTranscript: undefined,
    } as unknown as VoiceIO,
    system: {
      get state() { return systemState },
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
    } as unknown as SystemMonitor,
    iot: {
      getStates: vi.fn().mockResolvedValue(iotState),
    } as unknown as IoTBridge,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})
```

---

## Test Cases Detail (8 tests)

### Group 1: Snapshot

#### Test 1 — collects full perception snapshot from all modules

```typescript
it("collects full perception snapshot from all modules", async () => {
  const deps = createMockDeps()
  const fusion = new PerceptionFusion(deps)

  const snapshot = await fusion.getSnapshot()

  expect(snapshot).toMatchObject({
    timestamp: expect.any(Number),
    system: expect.objectContaining({
      cpuUsage: expect.any(Number),
      ramUsage: expect.any(Number),
    }),
    activeContext: expect.objectContaining({
      userActivity: expect.any(String),
      activityConfidence: expect.any(Number),
    }),
    audio: expect.objectContaining({
      isSpeaking: false,
      wakeWordDetected: false,
    }),
  })
})
```

#### Test 2 — snapshot includes system metrics, screen state, active window

```typescript
it("includes system metrics, screen state, active window", async () => {
  const deps = createMockDeps({
    screenState: createMockScreenState({
      activeWindowTitle: "test.ts - MyProject - Visual Studio Code",
      activeWindowProcess: "Code",
    }),
    systemState: createMockSystemState({ cpuUsage: 42, ramUsage: 67 }),
  })

  const fusion = new PerceptionFusion(deps)
  const snapshot = await fusion.getSnapshot()

  expect(snapshot.system.cpuUsage).toBe(42)
  expect(snapshot.system.ramUsage).toBe(67)
  expect(snapshot.screen?.activeWindowTitle).toContain("Visual Studio Code")
})
```

---

### Group 2: Activity Detection

#### Test 3 — detects 'coding' from VS Code window title

```typescript
it("detects 'coding' pattern from VS Code window title", async () => {
  const deps = createMockDeps({
    screenState: createMockScreenState({
      activeWindowTitle: "index.ts - EDITH - Visual Studio Code",
      activeWindowProcess: "Code",
    }),
  })

  const fusion = new PerceptionFusion(deps)
  const snapshot = await fusion.getSnapshot()

  expect(snapshot.activeContext.userActivity).toBe("coding")
  expect(snapshot.activeContext.activityConfidence).toBeGreaterThan(0.7)
})
```

#### Test 4 — detects 'browsing' from Chrome title

```typescript
it("detects 'browsing' from Chrome/Firefox title", async () => {
  const deps = createMockDeps({
    screenState: createMockScreenState({
      activeWindowTitle: "Google - Google Chrome",
      activeWindowProcess: "chrome",
    }),
  })

  const fusion = new PerceptionFusion(deps)
  const snapshot = await fusion.getSnapshot()

  expect(snapshot.activeContext.userActivity).toBe("browsing")
})
```

#### Test 5 — detects 'communicating' from Zoom title

```typescript
it("detects 'video_conference'-style activity from Zoom/Meet title", async () => {
  const deps = createMockDeps({
    screenState: createMockScreenState({
      activeWindowTitle: "Zoom Meeting",
      activeWindowProcess: "zoom",
    }),
  })

  const fusion = new PerceptionFusion(deps)
  const snapshot = await fusion.getSnapshot()

  // Source menggunakan 'communicating' bukan 'video_conference'
  expect(snapshot.activeContext.userActivity).toBe("communicating")
})
```

#### Test 6 — returns 'unknown' for unrecognized window

```typescript
it("returns 'unknown' for unrecognized window", async () => {
  const deps = createMockDeps({
    screenState: createMockScreenState({
      activeWindowTitle: "Aplikasi Aneh Yang Tidak Dikenal v1.0",
      activeWindowProcess: "unknown_app",
    }),
    systemState: createMockSystemState({ idleTimeSeconds: 0 }),
  })

  const fusion = new PerceptionFusion(deps)
  const snapshot = await fusion.getSnapshot()

  expect(snapshot.activeContext.userActivity).toBe("unknown")
})
```

---

### Group 3: Summarize

#### Test 7 — generates one-line context summary

```typescript
it("generates one-line context summary", async () => {
  const deps = createMockDeps({
    systemState: createMockSystemState({ cpuUsage: 20, ramUsage: 55 }),
    screenState: createMockScreenState({ activeWindowTitle: "README.md - VS Code" }),
  })

  const fusion = new PerceptionFusion(deps)
  await fusion.getSnapshot() // populate lastSnapshot

  const summary = fusion.summarize()

  expect(typeof summary).toBe("string")
  expect(summary.length).toBeGreaterThan(0)
  expect(summary).not.toBe("No perception data available.")
  // Summary harus contain CPU dan RAM info
  expect(summary).toContain("CPU")
  expect(summary).toContain("RAM")
})
```

---

### Group 4: Staleness

#### Test 8 — detects stale perception (>10s) and auto-retries

```typescript
it("detects stale perception (>10s) and auto-retries", async () => {
  const deps = createMockDeps()
  const fusion = new PerceptionFusion(deps)

  // Ambil snapshot pertama
  await fusion.getSnapshot()

  const initialCallCount = vi.mocked(deps.vision.getScreenState).mock.calls.length

  // Mock Date.now() advance 11 seconds
  const realDateNow = Date.now
  const futureTime = realDateNow() + 11_000
  vi.spyOn(Date, "now").mockReturnValue(futureTime)

  // Ambil snapshot lagi → harus trigger refresh
  await fusion.getSnapshot()

  // vision.getScreenState harus dipanggil lagi (fresh fetch)
  expect(vi.mocked(deps.vision.getScreenState).mock.calls.length).toBeGreaterThan(initialCallCount)

  vi.spyOn(Date, "now").mockRestore()
})
```

---

## Catatan Penting

- `PerceptionFusion` tidak punya `initialized` check — bisa langsung dipanggil setelah `new`.
- `startLoop()` memanggil `deps.system.startMonitoring()` — test yang pakai loop harus mock ini.
- `detectActivity()` private tapi testable via `getSnapshot().activeContext.userActivity`.
- Activity pattern "communicating" di source — bukan "video_conference" — pastikan test labels match source code.

---

## Checklist

- [ ] Test 1: full snapshot shape ✅/❌
- [ ] Test 2: system metrics + screen state ✅/❌
- [ ] Test 3: coding detection ✅/❌
- [ ] Test 4: browsing detection ✅/❌
- [ ] Test 5: communicating (Zoom) detection ✅/❌
- [ ] Test 6: unknown window ✅/❌
- [ ] Test 7: summarize one-line ✅/❌
- [ ] Test 8: stale detection + retry ✅/❌
- [ ] Coverage ≥ 90%
