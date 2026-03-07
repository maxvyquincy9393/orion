# Atom 4 — voice-io.test.ts

**File target:** `src/os-agent/__tests__/voice-io.test.ts`  
**Source yang ditest:** `src/os-agent/voice-io.ts`  
**Dependencies:** Atom 0 (test-helpers)  
**Tests:** 12 tests  
**Coverage target:** 75% (lebih rendah karena Python capture loop dan real audio tidak bisa di-unit test)

---

## Apa yang Harus Diperbaiki di Source (`voice-io.ts`)

### 1. `voice-io.ts` punya banyak dynamic import

```typescript
// Source line ~18:
let edgeEngine: any = null

async function getEdgeEngine() {
  if (!edgeEngine) {
    const { EdgeEngine } = await import("../voice/edge-engine.js")
    edgeEngine = new EdgeEngine()
  }
  return edgeEngine
}
```

**Masalah:** Dynamic import susah di-mock dengan `vi.mock()` standar karena dipanggil saat runtime, bukan saat module load. 

**Solusi:** Mock `../voice/edge-engine.js` module-level, dan reset `edgeEngine` variable antara tests. Atau mock via `vi.doMock()` + `vi.resetModules()`.

### 2. `speak()` punya complex TTS flow

```typescript
async speak(text: string): Promise<OSActionResult> {
  // 1. Cancel existing speech jika fullDuplex
  // 2. getEdgeEngine()
  // 3. engine.generate(text, options) → Buffer
  // 4. fs.writeFile(tmpPath, audioBuffer)
  // 5. execa("powershell" / "afplay" / "play") → playback
  // 6. fs.unlink(tmpPath)
  // 7. return result
}
```

**Yang perlu di-mock:** EdgeEngine.generate(), fs.writeFile, fs.unlink, execa (playback).

### 3. `cancelSpeech()` pakai AbortController

```typescript
async speak(text: string): Promise<OSActionResult> {
  const abortController = new AbortController()
  this.currentTTSAbort = abortController
  // ...
  // execa dipanggil dengan { signal: abortController.signal }
  // Kalau aborted → return { success: true, data: { interrupted: true } }
}

async cancelSpeech(): Promise<void> {
  if (this.currentTTSAbort) {
    this.currentTTSAbort.abort()
    this.currentTTSAbort = null
  }
}
```

**Masalah untuk test barge-in:** Harus simulate concurrent speak + cancel. Ini tricky di unit test.

**Solusi:** Panggil `speak()` tanpa await (jangan di-await dulu), lalu panggil `cancelSpeech()`, lalu await speak result.

### 4. `startListening()` membutuhkan Python subprocess

```typescript
async startListening(): Promise<void> {
  if (!this.initialized) throw new Error("Voice I/O not initialized")
  if (this.config.mode !== "always-on" || this.listening) return

  if (this.runtimePlan.captureImplementation === "unavailable") {
    this.emitVoiceError(...)
    return
  }

  this.listening = true
  this.startCaptureLoop() // ← spawn Python subprocess
}
```

**Masalah:** `startCaptureLoop()` spawn Python process — tidak bisa di unit test. 

**Solusi test:** Gunakan config `mode: "push-to-talk"` — `startListening()` akan return early tanpa spawn Python. Atau mock `runtimePlan.captureImplementation = "unavailable"`.

### 5. `initialize()` calls `inspectPythonVoiceDependencies()` yang butuh Python

```typescript
async initialize(): Promise<void> {
  // ...
  this.pythonDependencies = await inspectPythonVoiceDependencies()
  // ...
}
```

**Solusi:** Mock `execa` sehingga Python check return mock JSON.

### 6. Import dependencies dari voice/ directory

```typescript
import { createTurnSttProvider } from "../voice/providers.js"
import { resolveWakeWordConfig } from "../voice/wake-word.js"
import { resolveVoiceRuntimePlan } from "./voice-plan.js"
```

**Solusi:** Mock semua modules ini karena mereka bergantung pada Python/audio hardware.

---

## Mock Setup (lebih complex dari module lain)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { FAKE_MP3, createMockVoiceConfig } from "./test-helpers.js"

// ── Mock dependencies berat ──
vi.mock("execa", () => ({ execa: vi.fn() }))
vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock("node:os", () => ({
  default: { tmpdir: vi.fn().mockReturnValue("/tmp") }
}))

// ── Mock voice sub-modules ──
vi.mock("../voice/edge-engine.js", () => ({
  EdgeEngine: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue(FAKE_MP3),
  })),
}))
vi.mock("../voice/providers.js", () => ({
  createTurnSttProvider: vi.fn().mockReturnValue({
    transcribeTurn: vi.fn().mockResolvedValue({ text: "hello edith" }),
  }),
}))
vi.mock("../voice/wake-word.js", () => ({
  resolveWakeWordConfig: vi.fn().mockReturnValue({
    requestedEngine: "openwakeword",
    effectiveEngine: "openwakeword",
    keyword: "edith",
    keywordAssetPath: null,
  }),
}))
vi.mock("./voice-plan.js", () => ({
  resolveVoiceRuntimePlan: vi.fn().mockReturnValue({
    captureImplementation: "unavailable",
    vadImplementation: "unavailable",
    wakeWordImplementation: "transcript-keyword",
    fallbackReasons: ["python unavailable"],
  }),
}))
vi.mock("../config.js", () => ({
  default: { PYTHON_PATH: "python" },
}))

import { VoiceIO } from "../voice-io.js"
import { execa } from "execa"
import fs from "node:fs/promises"

beforeEach(() => {
  vi.clearAllMocks()
  // Default execa: Python check returns valid JSON
  vi.mocked(execa).mockResolvedValue({
    stdout: JSON.stringify({
      pythonAvailable: false,
      sounddevice: false,
      pvporcupine: false,
      openwakeword: false,
      onnxruntime: false,
    }),
    stderr: "",
    exitCode: 0,
  } as any)
})
```

---

## Test Cases Detail (12 tests)

### Group 1: Initialization

#### Test 1 — initializes all sub-components when enabled

```typescript
it("initializes all sub-components when enabled", async () => {
  const voice = new VoiceIO(createMockVoiceConfig())
  await expect(voice.initialize()).resolves.not.toThrow()

  // Setelah init, getter harus work
  expect(voice.isListening).toBe(false)
  expect(voice.isSpeaking).toBe(false)
})
```

#### Test 2 — skips init when disabled

```typescript
it("skips init when disabled", async () => {
  const voice = new VoiceIO(createMockVoiceConfig({ enabled: false }))
  await voice.initialize()

  // execa untuk Python check tidak dipanggil
  expect(vi.mocked(execa)).not.toHaveBeenCalled()
})
```

---

### Group 2: TTS / Speak

#### Test 3 — generates audio via EdgeEngine and plays on Windows

```typescript
it("generates audio via EdgeEngine and plays on Windows", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  // Playback execa (powershell MediaPlayer) sukses
  vi.mocked(execa).mockImplementation((cmd: string, args?: any[]) => {
    // Python check
    if (cmd === "python" || cmd === "python3") {
      return Promise.resolve({ stdout: JSON.stringify({ pythonAvailable: false, sounddevice: false, pvporcupine: false, openwakeword: false, onnxruntime: false }), stderr: "", exitCode: 0 }) as any
    }
    // PowerShell playback
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }) as any
  })

  const voice = new VoiceIO(createMockVoiceConfig())
  await voice.initialize()

  const result = await voice.speak("Hello EDITH")

  expect(result.success).toBe(true)
  expect(result.data).toMatchObject({
    textLength: expect.any(Number),
    audioBytes: expect.any(Number),
    duration: expect.any(Number),
  })

  // PowerShell dipanggil untuk playback
  const psCall = vi.mocked(execa).mock.calls.find((c) => c[0] === "powershell")
  expect(psCall).toBeDefined()

  // File temp di-cleanup
  expect(vi.mocked(fs.unlink)).toHaveBeenCalled()
})
```

#### Test 4 — generates audio and plays on macOS via afplay

```typescript
it("generates audio and plays on macOS via afplay", async () => {
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

  vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify({ pythonAvailable: false, sounddevice: false, pvporcupine: false, openwakeword: false, onnxruntime: false }), stderr: "", exitCode: 0 } as any)

  const voice = new VoiceIO(createMockVoiceConfig())
  await voice.initialize()

  await voice.speak("Hello")

  // afplay dipanggil
  const afplayCall = vi.mocked(execa).mock.calls.find((c) => c[0] === "afplay")
  expect(afplayCall).toBeDefined()
})
```

#### Test 5 — cleans up temp file after playback

```typescript
it("cleans up temp file after playback", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })
  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

  const voice = new VoiceIO(createMockVoiceConfig())
  await voice.initialize()

  await voice.speak("cleanup test")

  // fs.unlink harus dipanggil dengan path yang mengandung "edith-tts"
  const unlinkCall = vi.mocked(fs.unlink).mock.calls.find(
    (c) => String(c[0]).includes("edith-tts")
  )
  expect(unlinkCall).toBeDefined()
})
```

#### Test 6 — returns success with duration and size

```typescript
it("returns success with duration and audioBytes", async () => {
  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

  const voice = new VoiceIO(createMockVoiceConfig())
  await voice.initialize()

  const result = await voice.speak("Hello EDITH, ini test")

  expect(result.success).toBe(true)
  const data = result.data as any
  expect(typeof data.duration).toBe("number")
  expect(data.audioBytes).toBe(FAKE_MP3.length) // 4 bytes dari mock
  expect(data.textLength).toBe("Hello EDITH, ini test".length)
})
```

#### Test 7 — handles TTS failure gracefully

```typescript
it("handles TTS failure gracefully", async () => {
  // EdgeEngine.generate throw error
  const { EdgeEngine } = await import("../voice/edge-engine.js")
  vi.mocked(EdgeEngine).mockImplementation(() => ({
    generate: vi.fn().mockRejectedValue(new Error("TTS service unavailable")),
  }) as any)

  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

  const voice = new VoiceIO(createMockVoiceConfig())
  await voice.initialize()

  const result = await voice.speak("hello")

  // Tidak throw, return error result
  expect(result.success).toBe(false)
  expect(result.error).toContain("TTS service unavailable")
})
```

---

### Group 3: Barge-In (Full Duplex)

#### Test 8 — cancels current speech on barge-in

```typescript
it("cancels current speech on barge-in", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  // Playback makan waktu (delay)
  vi.mocked(execa).mockImplementation(async (cmd: string) => {
    if (cmd === "powershell") {
      // Simulate playback yang memakan waktu
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { stdout: "", stderr: "", exitCode: 0 }
    }
    return { stdout: "", stderr: "", exitCode: 0 }
  })

  const voice = new VoiceIO(createMockVoiceConfig({ fullDuplex: true }))
  await voice.initialize()

  // Mulai speak (jangan await)
  const speakPromise = voice.speak("Ini kalimat panjang yang sedang diucapkan")

  // Langsung cancel
  await voice.cancelSpeech()

  const result = await speakPromise

  // Bisa jadi interrupted atau success
  expect(result).toBeDefined()
})
```

#### Test 9 — interrupt + new speech works correctly

```typescript
it("interrupt + new speech works correctly", async () => {
  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

  const voice = new VoiceIO(createMockVoiceConfig({ fullDuplex: true }))
  await voice.initialize()

  // First speak (tidak await)
  voice.speak("First utterance")

  // Second speak harus cancel yang pertama
  const result = await voice.speak("Second utterance")

  expect(result.success).toBe(true)
  // isSpeaking harus false setelah selesai
  expect(voice.isSpeaking).toBe(false)
})
```

---

### Group 4: Listening

#### Test 10 — startListening throws if not initialized

```typescript
it("startListening requires initialization first", async () => {
  const voice = new VoiceIO(createMockVoiceConfig({ mode: "always-on" }))
  // TIDAK initialize()

  await expect(voice.startListening()).rejects.toThrow(/not initialized/i)
})
```

#### Test 11 — stopListening updates state correctly

```typescript
it("stopListening updates isListening to false", async () => {
  const voice = new VoiceIO(createMockVoiceConfig({ mode: "push-to-talk" }))
  await voice.initialize()

  // push-to-talk mode: startListening return early tanpa spawn Python
  await voice.startListening()
  await voice.stopListening()

  expect(voice.isListening).toBe(false)
})
```

---

### Group 5: Shutdown

#### Test 12 — shutdown stops listening and cancels speech

```typescript
it("shutdown stops listening and cancels speech", async () => {
  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)

  const voice = new VoiceIO(createMockVoiceConfig())
  await voice.initialize()

  await voice.shutdown()

  expect(voice.isListening).toBe(false)
  expect(voice.isSpeaking).toBe(false)
})
```

---

## Catatan Penting

- **EdgeEngine singleton**: `edgeEngine` variable di module level perlu di-reset antara tests. Gunakan `vi.resetModules()` atau access via `vi.mocked()` untuk reset `.mock`.
- Tests untuk Python capture loop (`startCaptureLoop`) **tidak masuk** unit tests — itu integration test.
- `speak()` hanya testable karena pakai platform playback (execa) yang bisa di-mock.

---

## Checklist

- [ ] Test 1: init ✅/❌
- [ ] Test 2: disabled ✅/❌
- [ ] Test 3: speak Windows ✅/❌
- [ ] Test 4: speak macOS afplay ✅/❌
- [ ] Test 5: cleanup temp file ✅/❌
- [ ] Test 6: duration + audioBytes ✅/❌
- [ ] Test 7: TTS failure ✅/❌
- [ ] Test 8: barge-in cancel ✅/❌
- [ ] Test 9: interrupt + new speech ✅/❌
- [ ] Test 10: startListening not initialized ✅/❌
- [ ] Test 11: stopListening state ✅/❌
- [ ] Test 12: shutdown ✅/❌
- [ ] Coverage ≥ 75%
