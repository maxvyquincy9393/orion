# Phase 2 — OS-Agent Test Suite (88+ Tests)

**Durasi Estimasi:** 1–2 minggu  
**Prioritas:** 🟠 HIGH — Zero test coverage untuk OS-Agent layer  
**Status Saat Ini:** 453 tests passing (61 files), 0 tests untuk OS-Agent  

---

## 1. Tujuan

Membangun test suite komprehensif untuk seluruh OS-Agent layer:
- 10 source files × rata-rata 8–12 tests = **88+ unit tests**
- Mock semua system calls (PowerShell, execa, fetch, file I/O)
- Integration tests untuk cross-module flows
- Target coverage: **≥80% line coverage** untuk os-agent/

---

## 2. Arsitektur Testing

### 2.1 Test Infrastructure

```
┌─────────────────────────────────────────────────────┐
│                  Vitest Test Runner                   │
│              (vitest.config.ts — sudah ada ✅)        │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              Mock Layer                         │  │
│  │                                                 │  │
│  │  ┌─────────────┐  ┌──────────────┐            │  │
│  │  │ execa mock   │  │ fetch mock   │            │  │
│  │  │ (PowerShell, │  │ (HA REST,    │            │  │
│  │  │  tesseract,  │  │  Deepgram,   │            │  │
│  │  │  sox, etc.)  │  │  embeddings) │            │  │
│  │  └─────────────┘  └──────────────┘            │  │
│  │                                                 │  │
│  │  ┌─────────────┐  ┌──────────────┐            │  │
│  │  │ fs mock      │  │ os mock      │            │  │
│  │  │ (temp files, │  │ (cpus, mem,  │            │  │
│  │  │  write/read) │  │  platform)   │            │  │
│  │  └─────────────┘  └──────────────┘            │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │            Test Suites (8 files)                │  │
│  │                                                 │  │
│  │  gui-agent.test.ts      (12 tests)             │  │
│  │  vision-cortex.test.ts  (10 tests)             │  │
│  │  voice-io.test.ts       (12 tests)             │  │
│  │  system-monitor.test.ts (11 tests)             │  │
│  │  iot-bridge.test.ts     (10 tests)             │  │
│  │  perception.test.ts     (8 tests)              │  │
│  │  os-agent-tool.test.ts  (15 tests)             │  │
│  │  os-agent-index.test.ts (10 tests)             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │         Test Helpers / Fixtures                  │  │
│  │                                                 │  │
│  │  test-helpers.ts        (shared mocks/utils)   │  │
│  │  fixtures/              (sample images, audio)  │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 2.2 Mock Strategy

```
┌─────────────────────┐     ┌─────────────────────┐
│   Real Dependency    │     │      Mock            │
├─────────────────────┤     ├─────────────────────┤
│ execa (PowerShell)   │ ──▶ │ vi.mock("execa")    │
│ global fetch         │ ──▶ │ vi.fn() per test    │
│ fs/promises          │ ──▶ │ vi.mock("fs/prom.") │
│ os module            │ ──▶ │ vi.mock("os")       │
│ onnxruntime-node     │ ──▶ │ vi.mock("onnxrt")   │
│ @picovoice/porcupine │ ──▶ │ vi.mock("porcupine")│
│ whisper-node         │ ──▶ │ vi.mock("whisper")  │
│ EdgeEngine           │ ──▶ │ vi.mock("edge-eng") │
│ crypto.randomUUID    │ ──▶ │ deterministic mock  │
└─────────────────────┘     └─────────────────────┘
```

---

## 3. Test Suites Detail

### 3.1 gui-agent.test.ts (12 tests)

```typescript
describe("GUIAgent", () => {
  // ── Initialization ──
  it("initializes on Windows with native backend")
  it("initializes on macOS with native backend")
  it("skips init when disabled")
  
  // ── Screenshot ──
  it("captures screenshot on Windows via PowerShell")
  it("captures screenshot on macOS via screencapture")
  it("captures region screenshot with bounds")
  
  // ── Mouse Actions ──
  it("clicks at coordinates using PowerShell mouse_event")
  it("double-clicks at coordinates")
  it("drags from source to target (mouse down→move→up)")
  
  // ── Keyboard Actions ──  
  it("types text via SendKeys")
  it("sends hotkey combination (Ctrl+S)")
  
  // ── Safety ──
  it("rejects actions when rate limit exceeded")
})
```

**Mock Pattern:**
```typescript
vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}))

// Verify correct PowerShell command was generated
expect(execa).toHaveBeenCalledWith(
  "powershell", 
  ["-command", expect.stringContaining("mouse_event")]
)
```

### 3.2 vision-cortex.test.ts (10 tests)

```typescript
describe("VisionCortex", () => {
  // ── Initialization ──
  it("initializes with tesseract verified")
  it("warns when tesseract not found")
  it("skips when disabled")
  
  // ── Screenshot + Analysis ──
  it("captureAndAnalyze returns OCR text + elements")
  it("delegates screenshot to GUIAgent when available")
  it("falls back to own capture when no GUIAgent")
  
  // ── OCR ──
  it("extracts text via tesseract subprocess")
  it("handles tesseract failure gracefully")
  
  // ── UI Elements ──
  it("detects accessibility elements on Windows")
  
  // ── Screen State ──
  it("returns active window title and resolution")
})
```

### 3.3 voice-io.test.ts (12 tests)

```typescript
describe("VoiceIO", () => {
  // ── Initialization ──
  it("initializes all sub-components when enabled")
  it("skips init when disabled")
  
  // ── TTS / Speak ──
  it("generates audio via EdgeEngine and plays on Windows")
  it("generates audio and plays on macOS via afplay")
  it("cleans up temp file after playback")
  it("returns success with duration and size")
  it("handles TTS failure gracefully")
  
  // ── Barge-In ──
  it("cancels current speech on barge-in")
  it("interrupt + new speech works correctly")
  
  // ── Listening ──
  it("startListening requires initialization first")
  it("stopListening updates state correctly")
  
  // ── Shutdown ──
  it("shutdown stops listening and cancels speech")
})
```

### 3.4 system-monitor.test.ts (11 tests)

```typescript
describe("SystemMonitor", () => {
  // ── Initialization ──
  it("initializes and collects baseline metrics")
  it("skips when disabled")
  
  // ── CPU ──
  it("measures CPU usage with two-sample delta")
  it("returns percentage between 0-100")
  
  // ── Memory ──
  it("returns RAM usage from os.totalmem/freemem")
  
  // ── Disk ──
  it("gets disk usage via PowerShell on Windows")
  it("gets disk usage via df on Unix")
  
  // ── Network ──
  it("checks network connectivity via ping")
  it("handles network failure gracefully")
  
  // ── Process List ──
  it("returns running processes list")
  
  // ── Clipboard ──
  it("reads clipboard content on Windows")
  
  // ── Idle Time ──
  it("detects user idle time")
})
```

### 3.5 iot-bridge.test.ts (10 tests)

```typescript
describe("IoTBridge", () => {
  // ── Initialization ──
  it("connects to Home Assistant and discovers entities")
  it("warns when HA token missing")
  it("skips when disabled")
  
  // ── HA Execution ──
  it("calls HA service API for light.turn_on")
  it("handles HA API error response")
  it("rate-limits entity refresh to 30s")
  
  // ── Natural Language ──
  it("parses 'nyalakan lampu kamar' → light.turn_on bedroom")
  it("parses 'set suhu 24' → climate.set_temperature 24")
  it("parses 'kunci pintu' → lock.lock front_door")
  
  // ── States ──
  it("returns device states with friendly names")
})
```

### 3.6 perception-fusion.test.ts (8 tests)

```typescript
describe("PerceptionFusion", () => {
  // ── Snapshot ──
  it("collects full perception snapshot from all modules")
  it("includes system metrics, screen state, active window")
  
  // ── Activity Detection ──
  it("detects 'coding' pattern from VS Code window title")
  it("detects 'browsing' from Chrome/Firefox title")
  it("detects 'video_conference' from Zoom/Meet title")
  it("returns 'unknown' for unrecognized window")
  
  // ── Summarize ──
  it("generates one-line context summary")
  
  // ── Staleness ──
  it("detects stale perception (>10s) and auto-retries")
})
```

### 3.7 os-agent-tool.test.ts (15 tests)

```typescript
describe("OSAgentTool", () => {
  // ── Action Routing ──
  it("routes 'click' to gui.execute")
  it("routes 'type_text' to gui.execute")
  it("routes 'screenshot' to vision.captureAndAnalyze")
  it("routes 'speak' to voice.speak")
  it("routes 'system_info' to system.getMetrics")
  it("routes 'iot_control' to iot.execute")
  
  // ── Confirmation Gate ──
  it("requires confirmation for 'run_command'")
  it("requires confirmation for 'open_app'")
  it("does NOT require confirmation for 'screenshot'")
  
  // ── Input Validation ──
  it("validates required 'x' and 'y' for click action")
  it("validates required 'text' for type_text action")
  it("rejects unknown action type")
  
  // ── Error Handling ──
  it("returns error result when subsystem not initialized")
  it("returns error for malformed payload")
  
  // ── Tool Registration ──
  it("registers all 19 action tools in novaTools registry")
})
```

### 3.8 os-agent-index.test.ts (10 tests)

```typescript
describe("OSAgent (index)", () => {
  // ── Lifecycle ──
  it("creates all subsystem instances")
  it("initializes all subsystems in order")
  it("handles partial init failure gracefully")
  it("shutdown stops all subsystems")
  
  // ── Cross-Module ──
  it("VisionCortex uses GUIAgent screenshot (no duplication)")
  it("executeAction delegates to correct subsystem")
  it("getPerception returns fused snapshot")
  
  // ── Config ──
  it("respects per-subsystem enabled/disabled flags")
  it("uses default config values for missing fields")
  
  // ── Error Isolation ──
  it("one subsystem failure doesn't crash others")
})
```

---

## 4. Test Helpers & Fixtures

### 4.1 Shared Test Helpers

**File:** `orion-ts/src/os-agent/__tests__/test-helpers.ts`

```typescript
// Factory functions for configs with safe defaults
export function createMockGUIConfig(overrides?: Partial<GUIConfig>): GUIConfig
export function createMockVisionConfig(overrides?: Partial<VisionConfig>): VisionConfig
export function createMockVoiceConfig(overrides?: Partial<VoiceIOConfig>): VoiceIOConfig
export function createMockSystemConfig(overrides?: Partial<SystemConfig>): SystemConfig
export function createMockIoTConfig(overrides?: Partial<IoTConfig>): IoTConfig
export function createMockOSAgentConfig(overrides?: Partial<OSAgentConfig>): OSAgentConfig

// Common mock responses
export const mockPowershellExeca = (stdout: string) => 
  vi.fn().mockResolvedValue({ stdout, stderr: "", exitCode: 0 })

export const mockFetchResponse = (data: unknown, status = 200) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(data) })

// Fake image buffer (1x1 PNG)
export const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
)

// Fake audio buffer (minimal MP3 header)  
export const FAKE_MP3 = Buffer.from([0xFF, 0xFB, 0x90, 0x00, /* ... */])
```

### 4.2 Fixtures

```
orion-ts/src/os-agent/__tests__/fixtures/
├── fake-screenshot.png     # 100x100 test image
├── fake-audio.mp3          # 1s silence MP3
├── sample-ocr-output.txt   # Expected OCR output
├── ha-entities.json        # Sample Home Assistant entities
└── ha-service-response.json # Sample HA service call response
```

---

## 5. Android/Mobile Test Considerations

### 5.1 Mobile Test Strategy

```
┌──────────────────────────────────────────────────┐
│              Mobile Tests (Jest/Expo)              │
│                                                    │
│  ┌────────────────────────────────────────────┐   │
│  │  VoiceButton.test.tsx                       │   │
│  │  - renders push-to-talk button              │   │
│  │  - starts recording on press                │   │
│  │  - sends voice_start WS message             │   │
│  │  - sends voice_chunk with audio data         │   │
│  │  - sends voice_stop on release              │   │
│  │  - plays received voice_audio               │   │
│  │  - handles permission denied                │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
│  ┌────────────────────────────────────────────┐   │
│  │  WebSocket Voice Protocol Tests             │   │
│  │  - voice_start → voice_started handshake    │   │
│  │  - voice_chunk streaming → transcript       │   │
│  │  - voice_stop → final response + audio      │   │
│  │  - reconnect during voice session           │   │
│  │  - concurrent text + voice messages         │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### 5.2 Mocking expo-av

```typescript
// __mocks__/expo-av.ts
export const Audio = {
  requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  Recording: vi.fn().mockImplementation(() => ({
    prepareToRecordAsync: vi.fn(),
    startAsync: vi.fn(),
    stopAndUnloadAsync: vi.fn(),
    getURI: vi.fn().mockReturnValue("file:///fake-recording.wav"),
    getStatusAsync: vi.fn().mockResolvedValue({ isRecording: true }),
  })),
  Sound: vi.fn().mockImplementation(() => ({
    loadAsync: vi.fn(),
    playAsync: vi.fn(),
    unloadAsync: vi.fn(),
  })),
}
```

---

## 6. Implementation Roadmap

### Week 1: Core Unit Tests

| Day | Task | Tests |
|-----|------|-------|
| 1 | Setup test helpers + fixtures | 0 (infra) |
| 1 | gui-agent.test.ts | 12 |
| 2 | vision-cortex.test.ts | 10 |
| 2 | system-monitor.test.ts | 11 |
| 3 | voice-io.test.ts | 12 |
| 3 | iot-bridge.test.ts | 10 |
| 4 | perception-fusion.test.ts | 8 |
| 4 | os-agent-tool.test.ts | 15 |
| 5 | os-agent-index.test.ts | 10 |
| **Total** | | **88 tests** |

### Week 2: Integration + CI

| Day | Task | Detail |
|-----|------|--------|
| 1 | Integration test: voice pipeline | End-to-end mock flow |
| 2 | Integration test: vision pipeline | Screenshot → OCR → analysis |
| 3 | Mobile voice protocol tests | WS voice_chunk streaming |
| 4 | Coverage analysis + gap filling | Target ≥80% |
| 5 | CI integration | Add os-agent tests to pipeline |

---

## 7. CI Integration

```yaml
# .github/workflows/test.yml (addition)
- name: Run OS-Agent Tests
  run: pnpm vitest run src/os-agent/ --reporter=verbose --coverage
  
- name: Check Coverage Threshold
  run: |
    pnpm vitest run src/os-agent/ --coverage --coverage.thresholds.lines=80
```

---

## 8. Coverage Targets

| Module | Target | Key Metrics |
|--------|--------|-------------|
| gui-agent.ts | 85% | All public methods, error paths |
| vision-cortex.ts | 80% | captureAndAnalyze, OCR, elements |
| voice-io.ts | 75% | speak (real), VAD/STT (mock placeholders) |
| system-monitor.ts | 85% | All metric collection methods |
| iot-bridge.ts | 85% | HA API, NL parsing, states |
| perception-fusion.ts | 90% | Snapshot, activity detect, summarize |
| os-agent-tool.ts | 90% | All 19 action routes, validation |
| index.ts | 80% | Lifecycle, delegation, error isolation |
| **Overall os-agent/** | **≥80%** | |

---

## 9. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `src/os-agent/__tests__/test-helpers.ts` | NEW | +80 |
| `src/os-agent/__tests__/gui-agent.test.ts` | NEW | +200 |
| `src/os-agent/__tests__/vision-cortex.test.ts` | NEW | +180 |
| `src/os-agent/__tests__/voice-io.test.ts` | NEW | +200 |
| `src/os-agent/__tests__/system-monitor.test.ts` | NEW | +190 |
| `src/os-agent/__tests__/iot-bridge.test.ts` | NEW | +180 |
| `src/os-agent/__tests__/perception-fusion.test.ts` | NEW | +130 |
| `src/os-agent/__tests__/os-agent-tool.test.ts` | NEW | +250 |
| `src/os-agent/__tests__/os-agent-index.test.ts` | NEW | +160 |
| `src/os-agent/__tests__/fixtures/` | NEW | +50 |
| **Total** | | **~1620 lines** |
