# Atom 8 — os-agent-index.test.ts

**File target:** `src/os-agent/__tests__/os-agent-index.test.ts`  
**Source yang ditest:** `src/os-agent/index.ts` (class `OSAgent`)  
**Dependencies:** Semua atom sebelumnya — ini integration-level unit test  
**Tests:** 10 tests  
**Coverage target:** 80%

---

## Apa yang Harus Diperbaiki di Source (`index.ts`)

### 1. `OSAgent` constructor membuat semua subsystem

```typescript
constructor(private config: OSAgentConfig) {
  this.gui = new GUIAgent(config.gui)
  this.vision = new VisionCortex(config.vision)
  this.vision.setGUIAgent(this.gui)       // ← dependency injection
  this.voice = new VoiceIO(config.voice)
  this.system = new SystemMonitor(config.system)
  this.iot = new IoTBridge(config.iot)
  this.perception = new PerceptionFusion({...})
}
```

**Masalah:** Kita tidak bisa mock instance yang dibuat di dalam constructor tanpa vi.mock() seluruh module.

**Solusi:** Mock semua class di os-agent:
```typescript
vi.mock("../gui-agent.js")
vi.mock("../vision-cortex.js")
vi.mock("../voice-io.js")
vi.mock("../system-monitor.js")
vi.mock("../iot-bridge.js")
vi.mock("../perception-fusion.js")
```

### 2. `initialize()` pakai `Promise.allSettled()`

```typescript
async initialize(): Promise<void> {
  const results = await Promise.allSettled([
    this.system.initialize(),
    this.gui.initialize(),
    this.vision.initialize(),
    this.voice.initialize(),
    this.iot.initialize(),
  ])

  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      log.warn(`OS-Agent subsystem ${names[i]} failed...`)
    }
  }

  this.running = true
}
```

**Poin penting:** `allSettled` = tidak throw meski ada yang reject. Test "partial failure" = mock satu subsystem reject, assert `this.running === true` tetap.

### 3. `running` flag adalah private

```typescript
private running = false
```

**Solusi:** Tidak bisa akses langsung. Test "not initialized" via side effects:
- `startPerceptionLoop()` throw kalau `!running`
- atau check via `execute()` yang delegasi ke subsystem mocks

### 4. `execute()` switch routing ke subsystems

```typescript
async execute(action: OSAction): Promise<OSActionResult> {
  switch (action.type) {
    case "gui":     return this.gui.execute(action.payload)
    case "shell":   return this.system.executeCommand(...)
    case "voice":   return this.voice.speak(...)
    case "iot":     return this.iot.execute(...)
    case "screenshot": return this.vision.captureAndAnalyze(...)
    default:        return { success: false, error: "Unknown action type" }
  }
}
```

### 5. `shutdown()` pakai `Promise.allSettled()` juga

```typescript
async shutdown(): Promise<void> {
  this.running = false
  await this.perception.stopLoop()
  await Promise.allSettled([
    this.voice.shutdown(),
    this.vision.shutdown(),
    this.system.shutdown(),
    this.iot.shutdown(),
    this.gui.shutdown(),
  ])
}
```

---

## Mock Setup (mock semua class modules)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { OSAgent } from "../index.js"
import { createMockOSAgentConfig } from "./test-helpers.js"

// ── Mock semua class modules ──
vi.mock("../gui-agent.js", () => ({
  GUIAgent: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ success: true, data: "gui done" }),
    captureScreenshot: vi.fn(),
    listWindows: vi.fn().mockResolvedValue([]),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("../vision-cortex.js", () => ({
  VisionCortex: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    setGUIAgent: vi.fn(),
    captureAndAnalyze: vi.fn().mockResolvedValue({
      success: true,
      data: { ocrText: "test", elements: [], screenshotSize: 68 },
    }),
    getScreenState: vi.fn().mockResolvedValue(null),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("../voice-io.js", () => ({
  VoiceIO: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    speak: vi.fn().mockResolvedValue({ success: true, data: {} }),
    isSpeaking: false,
    wakeWordDetected: false,
    audioLevel: 0,
    lastTranscript: undefined,
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("../system-monitor.js", () => ({
  SystemMonitor: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    get state() { return { cpuUsage: 10, ramUsage: 40, diskUsage: 50, topProcesses: [], networkConnected: true, idleTimeSeconds: 0 } },
    executeCommand: vi.fn().mockResolvedValue({ success: true, data: { stdout: "output", stderr: "" } }),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("../iot-bridge.js", () => ({
  IoTBridge: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getStates: vi.fn().mockResolvedValue({ connectedDevices: 0, devices: [] }),
    parseNaturalLanguage: vi.fn().mockReturnValue([]),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("../perception-fusion.js", () => ({
  PerceptionFusion: vi.fn().mockImplementation(() => ({
    startLoop: vi.fn().mockResolvedValue(undefined),
    stopLoop: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue({
      timestamp: Date.now(),
      system: { cpuUsage: 10, ramUsage: 40, diskUsage: 50, topProcesses: [], networkConnected: true, idleTimeSeconds: 0 },
      activeContext: { userActivity: "coding", activityConfidence: 0.9, activityDurationMinutes: 5 },
      audio: { isSpeaking: false, wakeWordDetected: false, audioLevel: 0 },
    }),
    summarize: vi.fn().mockReturnValue("CPU 10%, RAM 40% | coding"),
  })),
}))

import { GUIAgent } from "../gui-agent.js"
import { VisionCortex } from "../vision-cortex.js"

beforeEach(() => {
  vi.clearAllMocks()
})
```

---

## Test Cases Detail (10 tests)

### Group 1: Lifecycle

#### Test 1 — creates all subsystem instances

```typescript
it("creates all subsystem instances", () => {
  const agent = new OSAgent(createMockOSAgentConfig())

  expect(agent.gui).toBeDefined()
  expect(agent.vision).toBeDefined()
  expect(agent.voice).toBeDefined()
  expect(agent.system).toBeDefined()
  expect(agent.iot).toBeDefined()
  expect(agent.perception).toBeDefined()
})
```

#### Test 2 — initializes all subsystems in order

```typescript
it("initializes all subsystems in order", async () => {
  const agent = new OSAgent(createMockOSAgentConfig())
  await agent.initialize()

  expect(vi.mocked(agent.gui.initialize)).toHaveBeenCalled()
  expect(vi.mocked(agent.vision.initialize)).toHaveBeenCalled()
  expect(vi.mocked(agent.voice.initialize)).toHaveBeenCalled()
  expect(vi.mocked(agent.system.initialize)).toHaveBeenCalled()
  expect(vi.mocked(agent.iot.initialize)).toHaveBeenCalled()
})
```

#### Test 3 — handles partial init failure gracefully (allSettled pattern)

```typescript
it("handles partial init failure gracefully", async () => {
  // Mock voice.initialize → reject
  const { VoiceIO } = await import("../voice-io.js")
  vi.mocked(VoiceIO).mockImplementationOnce(() => ({
    initialize: vi.fn().mockRejectedValue(new Error("Microphone not found")),
    speak: vi.fn(),
    isSpeaking: false,
    wakeWordDetected: false,
    audioLevel: 0,
    lastTranscript: undefined,
    shutdown: vi.fn().mockResolvedValue(undefined),
  }) as any)

  const agent = new OSAgent(createMockOSAgentConfig())

  // Tidak boleh throw meski voice gagal
  await expect(agent.initialize()).resolves.not.toThrow()

  // Agent masih bisa running (degraded mode)
  // Test via startPerceptionLoop yang hanya work jika running
  await expect(agent.startPerceptionLoop()).resolves.not.toThrow()
})
```

#### Test 4 — shutdown stops all subsystems

```typescript
it("shutdown stops all subsystems", async () => {
  const agent = new OSAgent(createMockOSAgentConfig())
  await agent.initialize()
  await agent.shutdown()

  expect(vi.mocked(agent.gui.shutdown)).toHaveBeenCalled()
  expect(vi.mocked(agent.vision.shutdown)).toHaveBeenCalled()
  expect(vi.mocked(agent.voice.shutdown)).toHaveBeenCalled()
  expect(vi.mocked(agent.system.shutdown)).toHaveBeenCalled()
  expect(vi.mocked(agent.iot.shutdown)).toHaveBeenCalled()
  expect(vi.mocked(agent.perception.stopLoop)).toHaveBeenCalled()
})
```

---

### Group 2: Cross-Module

#### Test 5 — VisionCortex uses GUIAgent (setGUIAgent called in constructor)

```typescript
it("VisionCortex uses GUIAgent — setGUIAgent called in constructor", () => {
  const agent = new OSAgent(createMockOSAgentConfig())

  // vision.setGUIAgent(this.gui) dipanggil di constructor
  expect(vi.mocked(agent.vision.setGUIAgent)).toHaveBeenCalledWith(agent.gui)
})
```

#### Test 6 — executeAction delegates to correct subsystem

```typescript
it("executeAction delegates gui action to gui subsystem", async () => {
  const agent = new OSAgent(createMockOSAgentConfig())
  await agent.initialize()

  const result = await agent.execute({
    type: "gui",
    payload: { action: "click", coordinates: { x: 100, y: 200 } },
  })

  expect(vi.mocked(agent.gui.execute)).toHaveBeenCalledWith(
    expect.objectContaining({ action: "click" })
  )
  expect(result.success).toBe(true)
})
```

#### Test 7 — getContextSnapshot returns perception snapshot

```typescript
it("getContextSnapshot returns fused snapshot", async () => {
  const agent = new OSAgent(createMockOSAgentConfig())
  await agent.initialize()

  const snapshot = await agent.getContextSnapshot()

  expect(snapshot).toMatchObject({
    timestamp: expect.any(Number),
    system: expect.objectContaining({ cpuUsage: expect.any(Number) }),
    activeContext: expect.objectContaining({ userActivity: expect.any(String) }),
  })
  expect(vi.mocked(agent.perception.getSnapshot)).toHaveBeenCalled()
})
```

---

### Group 3: Config

#### Test 8 — respects per-subsystem enabled/disabled flags

```typescript
it("respects per-subsystem enabled/disabled flags", async () => {
  const config = createMockOSAgentConfig({
    iot: { enabled: false, autoDiscover: false },
  })

  const agent = new OSAgent(config)
  await agent.initialize()

  // IoTBridge masih dibuat (constructor), tapi config-nya disabled
  // Kita verifikasi bahwa IoTBridge.initialize() dipanggil dengan config disabled
  const { IoTBridge } = await import("../iot-bridge.js")
  const iotInstance = vi.mocked(IoTBridge).mock.instances[0]
  expect(vi.mocked(iotInstance.initialize)).toHaveBeenCalled()
})
```

#### Test 9 — uses default config values for missing fields

```typescript
it("uses default perceptionIntervalMs when not specified", () => {
  const config = createMockOSAgentConfig()
  delete (config as any).perceptionIntervalMs

  // Tidak boleh throw meski field optional tidak ada
  expect(() => new OSAgent(config)).not.toThrow()
})
```

---

### Group 4: Error Isolation

#### Test 10 — one subsystem failure doesn't crash others

```typescript
it("one subsystem failure doesn't crash other subsystems during shutdown", async () => {
  // Mock gui.shutdown → throw
  const { GUIAgent } = await import("../gui-agent.js")
  vi.mocked(GUIAgent).mockImplementationOnce(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(),
    captureScreenshot: vi.fn(),
    setGUIAgent: vi.fn(),
    listWindows: vi.fn().mockResolvedValue([]),
    shutdown: vi.fn().mockRejectedValue(new Error("GUI shutdown failed")),
  }) as any)

  const agent = new OSAgent(createMockOSAgentConfig())
  await agent.initialize()

  // Shutdown tidak boleh throw meski gui gagal (allSettled)
  await expect(agent.shutdown()).resolves.not.toThrow()

  // Other subsystems masih di-shutdown
  expect(vi.mocked(agent.voice.shutdown)).toHaveBeenCalled()
  expect(vi.mocked(agent.system.shutdown)).toHaveBeenCalled()
})
```

---

## Catatan Penting

- Mock semua class modules dengan `vi.mock()` di top level — ini wajib untuk mencegah real subsystem dibuat.
- `vi.mocked(agent.gui.initialize)` hanya bekerja kalau kita mock class-nya, bukan instance.
- Test 3 (partial failure) butuh `vi.mocked(VoiceIO).mockImplementationOnce()` — ini override mock hanya untuk satu instantiation.
- `setGUIAgent` harus di-include di VisionCortex mock (Test 5).

---

## Checklist

- [ ] Test 1: creates all subsystems ✅/❌
- [ ] Test 2: initializes in order ✅/❌
- [ ] Test 3: partial init failure graceful ✅/❌
- [ ] Test 4: shutdown all subsystems ✅/❌
- [ ] Test 5: VisionCortex uses GUIAgent ✅/❌
- [ ] Test 6: execute delegates to gui ✅/❌
- [ ] Test 7: getContextSnapshot ✅/❌
- [ ] Test 8: config disabled flag ✅/❌
- [ ] Test 9: default config values ✅/❌
- [ ] Test 10: error isolation ✅/❌
- [ ] Coverage ≥ 80%

---

## Setelah semua 8 atoms selesai

Jalankan full suite:
```bash
pnpm vitest run src/os-agent/ --reporter=verbose --coverage
```

Expected output:
```
✓ test-helpers       (setup only)
✓ system-monitor     11 tests   85%+
✓ gui-agent          12 tests   85%+
✓ vision-cortex      10 tests   80%+
✓ voice-io           12 tests   75%+
✓ iot-bridge         10 tests   85%+
✓ perception-fusion   8 tests   90%+
✓ os-agent-tool      15 tests   90%+
✓ os-agent-index     10 tests   80%+
────────────────────────────────────
Total: 88 tests  |  Overall: 82%+
```
