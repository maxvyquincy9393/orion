# Atom 0 — test-helpers.ts

**File target:** `src/os-agent/__tests__/test-helpers.ts`  
**Tujuan:** Shared factory functions, mock responses, dan fake buffers yang dipakai semua test file  
**Harus selesai SEBELUM** semua atom lainnya

---

## Apa yang Harus Diperbaiki / Dibangun

File ini BELUM ADA. Kita bikin dari scratch.

### Yang perlu dibuat:

**1. Config factory functions**

Setiap class di os-agent punya constructor yang menerima config object dengan banyak fields. Tanpa factory, setiap test harus menulis config lengkap berulang-ulang — rawan typo dan verbose.

```typescript
// Masalah: config punya banyak required fields
const gui = new GUIAgent({
  enabled: true,
  backend: "native",
  screenshotMethod: "native",
  requireConfirmation: false,
  maxActionsPerMinute: 60,
})
// Harus ditulis di SETIAP test → factory function menyelesaikan ini
```

**2. Fake buffers**

`captureScreenshot()` mengembalikan `Buffer`. Tests yang mock `fs.readFile` harus return buffer yang valid secara shape (bukan kosong), karena beberapa path check `buffer.length > 0`.

```typescript
// FAKE_PNG: buffer 68 bytes (1×1 PNG minimal valid)
// FAKE_MP3: buffer 4 bytes (MP3 frame header)
// SPEECH_FRAME: buffer 320 bytes, byte[0] = 0xFF (VAD marker)
// SILENCE_FRAME: buffer 320 bytes, byte[0] = 0x00
```

**3. Mock response builders**

`execa` di source code dipanggil dengan format berbeda-beda:
- `execa("powershell", ["-command", script])`
- `execa("tesseract", [tmpIn, tmpOut, "-l", "eng+ind"])`
- `execa("ping", ["-c", "1", "-W", "2", "8.8.8.8"])`

Factory `mockExeca(stdout)` dan `mockExecaFail(message)` menyederhanakan setup.

**4. Fixture files JSON**

`iot-bridge.test.ts` memerlukan sample HA entity list dan service response.

---

## File Structure

```
src/os-agent/__tests__/
├── test-helpers.ts          ← file ini
├── fixtures/
│   ├── ha-entities.json     ← sample Home Assistant entities
│   └── ha-service-response.json
├── gui-agent.test.ts
├── vision-cortex.test.ts
├── voice-io.test.ts
├── system-monitor.test.ts
├── iot-bridge.test.ts
├── perception-fusion.test.ts
├── os-agent-tool.test.ts
└── os-agent-index.test.ts
```

---

## Konten `test-helpers.ts`

### Import types yang diperlukan

```typescript
import { vi } from "vitest"
import type {
  GUIConfig,
  VisionConfig,
  VoiceIOConfig,
  SystemConfig,
  IoTConfig,
  OSAgentConfig,
  SystemState,
  ScreenState,
  IoTState,
} from "../types.js"
```

### Config Factory Functions

```typescript
export function createMockGUIConfig(overrides: Partial<GUIConfig> = {}): GUIConfig {
  return {
    enabled: true,
    backend: "native",
    screenshotMethod: "native",
    requireConfirmation: false,
    maxActionsPerMinute: 60,
    ...overrides,
  }
}

export function createMockVisionConfig(overrides: Partial<VisionConfig> = {}): VisionConfig {
  return {
    enabled: true,
    ocrEngine: "tesseract",
    elementDetection: "accessibility",
    multimodalEngine: "anthropic",
    monitorIntervalMs: 1000,
    ...overrides,
  }
}

export function createMockVoiceConfig(overrides: Partial<VoiceIOConfig> = {}): VoiceIOConfig {
  return {
    enabled: true,
    mode: "push-to-talk",
    wakeWord: "edith",
    wakeWordEngine: "openwakeword",
    sttEngine: "auto",
    vadEngine: "silero",
    fullDuplex: false,
    language: "auto",
    ...overrides,
  }
}

export function createMockSystemConfig(overrides: Partial<SystemConfig> = {}): SystemConfig {
  return {
    enabled: true,
    watchPaths: [],
    watchClipboard: false,
    watchActiveWindow: false,
    resourceCheckIntervalMs: 5000,
    cpuWarningThreshold: 80,
    ramWarningThreshold: 85,
    diskWarningThreshold: 90,
    ...overrides,
  }
}

export function createMockIoTConfig(overrides: Partial<IoTConfig> = {}): IoTConfig {
  return {
    enabled: false,
    autoDiscover: false,
    ...overrides,
  }
}

export function createMockOSAgentConfig(overrides: Partial<OSAgentConfig> = {}): OSAgentConfig {
  return {
    gui: createMockGUIConfig(),
    vision: createMockVisionConfig(),
    voice: createMockVoiceConfig(),
    system: createMockSystemConfig(),
    iot: createMockIoTConfig(),
    perceptionIntervalMs: 1000,
    ...overrides,
  }
}
```

### Mock Response Builders

```typescript
/** Buat mock execa yang sukses dengan stdout tertentu */
export function mockExecaSuccess(stdout = "", stderr = "") {
  return vi.fn().mockResolvedValue({ stdout, stderr, exitCode: 0 })
}

/** Buat mock execa yang gagal dengan error message */
export function mockExecaFail(message = "command failed") {
  return vi.fn().mockRejectedValue(new Error(message))
}

/** Buat mock fetch response sukses */
export function mockFetchOk(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status,
    statusText: "OK",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

/** Buat mock fetch response gagal */
export function mockFetchFail(status = 500, statusText = "Internal Server Error") {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({ error: statusText }),
  })
}
```

### Fake Buffers

```typescript
/**
 * 1×1 pixel PNG (68 bytes) — valid PNG header + IHDR + IDAT + IEND
 * Dipakai sebagai fake screenshot buffer
 */
export const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
)

/**
 * Minimal MP3 frame header (4 bytes)
 * Dipakai sebagai fake TTS audio buffer
 */
export const FAKE_MP3 = Buffer.from([0xFF, 0xFB, 0x90, 0x00])

/**
 * VAD speech frame (320 bytes, byte[0] = 0xFF)
 * Dipakai sebagai marker "ini speech" di voice-io tests
 */
export const SPEECH_FRAME = Buffer.from([0xFF, ...Array(319).fill(0x80)])

/**
 * VAD silence frame (320 bytes, byte[0] = 0x00)
 * Dipakai sebagai marker "ini silence"
 */
export const SILENCE_FRAME = Buffer.from(Array(320).fill(0x00))
```

### Mock State Snapshots

```typescript
/** Fake SystemState untuk dipakai di perception-fusion tests */
export function createMockSystemState(overrides = {}): SystemState {
  return {
    cpuUsage: 15,
    ramUsage: 45,
    diskUsage: 60,
    topProcesses: ["Code", "Chrome", "node"],
    networkConnected: true,
    idleTimeSeconds: 5,
    ...overrides,
  }
}

/** Fake ScreenState */
export function createMockScreenState(overrides = {}): ScreenState {
  return {
    activeWindowTitle: "EDITH - Visual Studio Code",
    activeWindowProcess: "Code",
    resolution: { width: 1920, height: 1080 },
    ...overrides,
  }
}

/** Fake IoTState */
export function createMockIoTState(overrides = {}): IoTState {
  return {
    connectedDevices: 3,
    devices: [
      { entityId: "light.bedroom", friendlyName: "Bedroom Light", state: "on", domain: "light" },
      { entityId: "climate.living_room", friendlyName: "AC Ruang Tamu", state: "cool", domain: "climate" },
      { entityId: "lock.front_door", friendlyName: "Kunci Depan", state: "locked", domain: "lock" },
    ],
    ...overrides,
  }
}
```

---

## Konten `fixtures/ha-entities.json`

```json
[
  {
    "entity_id": "light.bedroom",
    "state": "on",
    "attributes": { "friendly_name": "Bedroom Light", "brightness": 255 },
    "last_changed": "2024-01-01T00:00:00Z"
  },
  {
    "entity_id": "climate.living_room",
    "state": "cool",
    "attributes": { "friendly_name": "AC Ruang Tamu", "temperature": 24, "current_temperature": 26 },
    "last_changed": "2024-01-01T00:00:00Z"
  },
  {
    "entity_id": "lock.front_door",
    "state": "locked",
    "attributes": { "friendly_name": "Kunci Depan" },
    "last_changed": "2024-01-01T00:00:00Z"
  }
]
```

## Konten `fixtures/ha-service-response.json`

```json
[
  {
    "entity_id": "light.bedroom",
    "state": "on",
    "attributes": { "friendly_name": "Bedroom Light", "brightness": 255 }
  }
]
```

---

## Checklist

- [ ] Buat `src/os-agent/__tests__/test-helpers.ts`
- [ ] Buat `src/os-agent/__tests__/fixtures/ha-entities.json`
- [ ] Buat `src/os-agent/__tests__/fixtures/ha-service-response.json`
- [ ] Verifikasi semua tipe import tidak error (`pnpm tsc --noEmit`)
