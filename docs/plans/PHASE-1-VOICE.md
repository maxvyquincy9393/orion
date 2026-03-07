# Phase 1 — Voice Input Pipeline (Full-Duplex EDITH Voice)

**Durasi Estimasi:** 2–3 minggu  
**Prioritas:** 🔴 CRITICAL — Ini adalah fondasi interaksi EDITH  
**Status Saat Ini:** TTS via EdgeEngine ✅ | VAD ❌ | Wake Word ❌ | STT ❌  

---

## 1. Tujuan

Membangun pipeline voice end-to-end sehingga user bisa berbicara ke EDITH seperti EDITH:
1. Selalu mendengarkan (always-on VAD)
2. Deteksi wake word ("Hey EDITH")  
3. Speech-to-Text real-time
4. Proses melalui EDITH pipeline
5. Text-to-Speech response
6. Bisa diinterupsi mid-speech (barge-in / full-duplex)

**Harus jalan di:**  
- 🖥️ Windows/macOS/Linux (desktop daemon — native mic)
- 📱 Android/iOS (React Native Expo — `expo-av` mic → WebSocket streaming ke server)

---

## 2. Arsitektur Sistem

### 2.1 Desktop Architecture (Server-Side Voice)

```
┌─────────────────────────────────────────────────────────────┐
│                    DESKTOP (Node.js Daemon)                  │
│                                                              │
│  ┌──────────┐   ┌───────────┐   ┌───────────────┐          │
│  │ Mic Input │──▶│ Silero VAD │──▶│ Wake Word     │          │
│  │ (portaudio│   │ (ONNX RT)  │   │ (Porcupine/   │          │
│  │  16kHz    │   │ 30ms chunk │   │  OpenWakeWord) │          │
│  │  mono)    │   └─────┬─────┘   └───────┬───────┘          │
│  └──────────┘         │                  │                    │
│                       │ isSpeech         │ wakeWordDetected   │
│                       ▼                  ▼                    │
│              ┌────────────────────────────────┐              │
│              │    STT Engine (streaming)       │              │
│              │  ┌─────────────────────────┐   │              │
│              │  │ Option A: whisper.cpp    │   │              │
│              │  │   (local, via binding)   │   │              │
│              │  ├─────────────────────────┤   │              │
│              │  │ Option B: Deepgram WS   │   │              │
│              │  │   (cloud, ~100ms lat.)   │   │              │
│              │  └─────────────────────────┘   │              │
│              └──────────────┬─────────────────┘              │
│                             │ transcription text              │
│                             ▼                                 │
│  ┌──────────────────────────────────────────────────┐        │
│  │              EDITH Core Pipeline                    │        │
│  │  context build → MemRL → engine call → feedback   │        │
│  └──────────────────────┬───────────────────────────┘        │
│                         │ response text                       │
│                         ▼                                     │
│  ┌──────────────────────────────────┐                        │
│  │       TTS (Edge Engine)          │──▶ 🔊 Speaker          │
│  │   - msedge-tts (free, offline)   │                        │
│  │   - voice: en-US-GuyNeural       │                        │
│  │   - streaming MP3 → play         │                        │
│  └──────────────────────────────────┘                        │
│                                                              │
│  ┌──────────────────────────────────┐                        │
│  │     Barge-In Controller          │                        │
│  │  - VAD detects speech during TTS │                        │
│  │  - AbortController cancels TTS   │                        │
│  │  - New STT session starts        │                        │
│  └──────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Mobile Architecture (Android/iOS via Expo)

```
┌──────────────────────────────────────────┐
│         MOBILE (React Native Expo)        │
│                                           │
│  ┌───────────────┐   ┌───────────────┐   │
│  │  expo-av       │   │  UI: Push-to- │   │
│  │  Audio.Record  │   │  Talk / Always │   │
│  │  (16kHz PCM)   │   │  Listen toggle │   │
│  └───────┬───────┘   └───────────────┘   │
│          │ audio chunks (base64)          │
│          ▼                                │
│  ┌───────────────────────────┐           │
│  │  WebSocket to Gateway     │           │
│  │  ws://IP:18789/ws         │           │
│  │                           │           │
│  │  → { type: "voice_start" }│           │
│  │  → { type: "voice_chunk", │           │
│  │      data: base64PCM }    │           │
│  │  → { type: "voice_stop" } │           │
│  │                           │           │
│  │  ← { type:                │           │
│  │    "voice_transcript",    │           │
│  │    text: "..." }          │           │
│  │  ← { type:                │           │
│  │    "voice_audio",         │           │
│  │    data: base64MP3 }      │           │
│  └───────────────────────────┘           │
│          │                                │
│          ▼                                │
│  ┌───────────────────────────┐           │
│  │  expo-av Audio.Sound      │           │
│  │  Play TTS response MP3    │           │
│  └───────────────────────────┘           │
│                                           │
│  ┌───────────────────────────┐           │
│  │  Local VAD (optional)     │           │
│  │  WebRTC VAD in JS or      │           │
│  │  expo-speech for on-device│           │
│  └───────────────────────────┘           │
└──────────────────────────────────────────┘
          │
          │  WebSocket
          ▼
┌──────────────────────────────────────────┐
│           SERVER (EDITH Gateway)          │
│                                           │
│  voice_chunk → Accumulate → STT          │
│  STT text → EDITH Pipeline                 │
│  Response → TTS → voice_audio chunks     │
│                                           │
└──────────────────────────────────────────┘
```

### 2.3 Message Protocol (WebSocket)

| Direction | Message Type | Payload | Description |
|-----------|-------------|---------|-------------|
| Client→Server | `voice_start` | `{ sampleRate?: 16000, encoding?: "pcm16" }` | Mulai voice session |
| Client→Server | `voice_chunk` | `{ data: string (base64 PCM) }` | Audio chunk (~100ms) |
| Client→Server | `voice_stop` | `{}` | Akhiri recording |
| Server→Client | `voice_transcript` | `{ text: string, isFinal: boolean }` | STT result (streaming) |
| Server→Client | `assistant_transcript` | `{ text: string }` | LLM response text |
| Server→Client | `voice_audio` | `{ data: string (base64 MP3), index: number }` | TTS audio chunk |
| Server→Client | `voice_started` | `{ sessionId: string }` | Konfirmasi session dimulai |
| Server→Client | `voice_stopped` | `{ sessionId: string }` | Konfirmasi session selesai |

---

## 3. Komponen yang Harus Dibangun

### 3.1 VAD — Voice Activity Detection

**File:** `EDITH-ts/src/os-agent/voice-io.ts` → `initializeVAD()` + `startVADLoop()`

**Status:** ❌ Placeholder (hanya log)

**Implementasi:**
```
Dependencies:
  - onnxruntime-node (untuk Silero VAD ONNX model)
  - node-portaudio ATAU mic (npm) untuk audio capture

Langkah:
  1. Download Silero VAD v5 model: silero_vad.onnx (~2MB)
  2. Load model via onnxruntime-node InferenceSession
  3. Capture mic audio: 16kHz mono PCM16
  4. Feed 30ms chunks (480 samples) ke model
  5. Output: isSpeech probability (0.0 - 1.0)
  6. Threshold: 0.5 → speech detected
  7. Emit event: "speechStart" / "speechEnd"
```

**Alternatif untuk resource-constrained:**
- WebRTC VAD (`@aspect-build/re-audio-vad`) — lebih ringan tapi kurang akurat
- Threshold-based energy detection — paling ringan tapi unreliable

### 3.2 Wake Word Detection

**File:** `EDITH-ts/src/os-agent/voice-io.ts` → `initializeWakeWord()`

**Status:** ❌ Placeholder

**Opsi A — Picovoice Porcupine (Recommended):**
```
Package: @picovoice/porcupine-node
Pros:
  - Pre-trained "Hey EDITH" model (atau custom via console.picovoice.ai)
  - Free tier: 3 custom keywords
  - Ultra-low CPU usage (~1% core)
  - Cross-platform (Windows, Mac, Linux, Android, iOS)
Cons:  
  - Requires API key (free-tier ada limit)
  - Binary blob (closed source)

Setup:
  1. npm install @picovoice/porcupine-node
  2. Create "Hey EDITH" keyword at console.picovoice.ai
  3. Download .ppn file → config/hey-edith.ppn
  4. Process 512-sample frames (16kHz) → returns keyword index
```

**Opsi B — OpenWakeWord (Open Source):**
```
Python bridge: spawn Python process + socket
Package: pip install openwakeword
Pros:
  - Fully open source
  - Train custom keywords
  - No API key needed
Cons:
  - Requires Python runtime
  - ~50ms latency per inference
  - More setup complexity

Setup:
  1. pip install openwakeword onnxruntime
  2. Train custom "hey edith" model (or use pre-trained)  
  3. Bridge: Node spawns Python subprocess
  4. Communication via stdin/stdout JSON
```

### 3.3 Speech-to-Text (STT)

**File:** `EDITH-ts/src/os-agent/voice-io.ts` → `initializeSTT()`

**Status:** ❌ Placeholder

**Opsi A — Whisper.cpp Local (Recommended for Privacy):**
```
Package: whisper-node (bindings ke whisper.cpp)
Models: tiny (39MB) → base (74MB) → small (244MB)
Latency: ~1-3s untuk utterance 5s (GPU accelerated: ~200ms)
Languages: 99 bahasa termasuk Bahasa Indonesia

Setup:
  1. npm install whisper-node
  2. Download model: npx whisper-node download base
  3. Feed accumulated PCM audio setelah silence detected
  4. Returns: { text: string, language: string }
```

**Opsi B — Deepgram Streaming (Recommended for Quality):**
```
Package: @deepgram/sdk
Latency: ~100ms (real-time streaming)
Quality: Superior untuk conversational speech
Cost: Free tier 200 minutes/month

Setup:
  1. npm install @deepgram/sdk  
  2. Open WebSocket to api.deepgram.com
  3. Stream raw PCM chunks in real-time
  4. Receive partial + final transcriptions
  5. Support interim results (show typing indicator)
```

**Opsi C — Google Cloud Speech (Fallback):**
```
Package: @google-cloud/speech
Setup: Service account key
Streaming: yes, ~200ms latency
```

### 3.4 Gateway Voice Protocol Extension

**File:** `EDITH-ts/src/gateway/server.ts`

**Status:** ⚠️ Has `voice_start`/`voice_stop` handlers but no streaming audio support

**Yang perlu ditambah:**
```typescript
// Handle voice audio chunks dari mobile client
case "voice_chunk": {
  const { data } = payload  // base64 PCM audio
  const pcmBuffer = Buffer.from(data, "base64")
  
  // Accumulate in voice session buffer
  activeVoiceSessions.get(clientId)?.pushAudio(pcmBuffer)
  
  // If using streaming STT (Deepgram), forward chunk immediately
  activeVoiceSessions.get(clientId)?.sttStream?.write(pcmBuffer)
  break
}
```

### 3.5 Mobile Voice UI (Android/iOS)

**File:** `apps/mobile/App.tsx` + new `apps/mobile/components/VoiceButton.tsx`

**Status:** ❌ Belum ada voice feature di mobile

**Implementasi:**
```typescript
// VoiceButton.tsx — Push-to-talk + always-listen toggle
import { Audio } from "expo-av"

// 1. Request mic permission
await Audio.requestPermissionsAsync()

// 2. Configure recording
await Audio.setAudioModeAsync({
  allowsRecordingIOS: true,
  playsInSilentModeIOS: true,
})

// 3. Start recording
const recording = new Audio.Recording()
await recording.prepareToRecordAsync({
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT, 
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: { ... },
  web: { ... },
})

// 4. Send chunks via WebSocket
// Option A: Send full recording on stop
// Option B: Use expo-av onRecordingStatusUpdate untuk periodic send
```

---

## 4. Dependency Tree

```
Production Dependencies:
├── onnxruntime-node         # Silero VAD ONNX runtime
├── @picovoice/porcupine-node # Wake word (atau openwakeword via Python)
├── whisper-node             # Local STT (atau @deepgram/sdk untuk cloud)
├── node-portaudio           # Mic input (atau mic / node-record-lpcm16)  
└── msedge-tts              # TTS (sudah installed ✅)

Mobile (Expo):
├── expo-av                 # ✅ Sudah installed (~13.10.0)
└── (tidak perlu tambahan — semua processing di server)

Dev/Test Dependencies:
├── @types/node             # Type definitions
└── vitest                  # ✅ Sudah installed
```

---

## 5. Implementation Roadmap

### Week 1: VAD + Wake Word

| Task | File | Detail |
|------|------|--------|
| Install onnxruntime-node | package.json | `pnpm add onnxruntime-node` |
| Download Silero VAD model | scripts/ | Download `silero_vad.onnx` ke `models/` |
| Implement VAD class | voice-io.ts | Load ONNX, process 30ms chunks, emit events |
| Install mic capture | package.json | `pnpm add mic` atau `node-portaudio` |
| Audio capture loop | voice-io.ts | 16kHz mono, feed chunks ke VAD |
| Install Porcupine | package.json | `pnpm add @picovoice/porcupine-node` |
| Create "Hey EDITH" keyword | Picovoice console | Download .ppn file |
| Integrate wake word | voice-io.ts | Process frames → detect "Hey EDITH" |
| Tests: VAD + Wake Word | `__tests__/` | Mock audio, verify detections |

### Week 2: STT + Pipeline Integration

| Task | File | Detail |
|------|------|--------|
| Install whisper-node | package.json | `pnpm add whisper-node` + download model |
| Implement STT | voice-io.ts | Accumulate audio post-wake → transcribe |
| Wire STT → Pipeline | voice-io.ts | `handleIncomingUserMessage(userId, text, "voice")` |
| TTS response streaming | voice-io.ts | Generate audio → chunk → stream |
| Barge-in support | voice-io.ts | VAD during TTS → cancel → new STT |
| Gateway voice_chunk | server.ts | Handle streaming audio dari mobile |
| Voice session manager | gateway/ | Track active sessions, buffer management |
| Tests: full pipeline | `__tests__/` | End-to-end voice flow test |

### Week 3: Mobile Integration + Polish

| Task | File | Detail |
|------|------|--------|
| VoiceButton component | apps/mobile/ | Push-to-talk UI |
| Mic recording | VoiceButton.tsx | expo-av recording, send base64 chunks |
| TTS playback | VoiceButton.tsx | Receive voice_audio, play via expo-av |
| Always-listen mode | VoiceButton.tsx | Toggle persistent recording |
| Visual feedback | App.tsx | Waveform animation, status indicator |
| Latency optimization | voice-io.ts | Pre-buffer, warm model, parallel TTS |
| Error handling | All | Timeout, reconnect, graceful degradation |
| Integration tests | `__tests__/` | Mobile simulator → gateway → voice flow |

---

## 6. Keputusan yang Perlu Diambil

| # | Keputusan | Opsi | Rekomendasi |
|---|-----------|------|-------------|
| 1 | Wake Word Engine | Porcupine vs OpenWakeWord | **Porcupine** — lebih mudah setup, lower CPU, free tier cukup |
| 2 | STT Engine (Primary) | Whisper.cpp vs Deepgram | **Deepgram** untuk real-time streaming, **Whisper** sebagai offline fallback |
| 3 | Audio Capture Library | node-portaudio vs mic (npm) | **mic** — lebih mudah install, cross-platform |
| 4 | Mobile Voice Mode | Push-to-talk vs Always-listen | **Push-to-talk** dulu (hemat baterai), always-listen sebagai toggle option |
| 5 | STT Language | English-only vs Multilingual | **Multilingual** — user pakai Bahasa Indonesia + English |

---

## 7. Testing Strategy

```
Unit Tests (8 tests):
├── VAD: process known speech/silence samples → correct detection
├── Wake Word: process "Hey EDITH" audio → triggers
├── Wake Word: process non-keyword audio → no false trigger
├── STT: short utterance → correct transcription  
├── STT: empty audio → empty string (no crash)
├── TTS: generate & play → completes without error
├── Barge-in: speech during TTS → cancels playback
└── Pipeline: voice input → text → response → audio output

Integration Tests (5 tests):
├── Full voice loop: mic → VAD → wake → STT → pipeline → TTS
├── Gateway voice_chunk streaming → STT → response
├── Mobile WS voice protocol → server processing → audio response
├── Concurrent voice sessions (multi-user)
└── Graceful degradation: STT provider down → fallback

Performance Benchmarks:
├── VAD latency: < 5ms per 30ms chunk  
├── Wake word latency: < 10ms per frame
├── STT latency: < 2s (local) / < 500ms (cloud)
├── TTS generation: < 1s for typical response
└── End-to-end: wake word → response audio < 4s
```

---

## 8. Risiko & Mitigasi

| Risiko | Impact | Mitigasi |
|--------|--------|---------|
| `onnxruntime-node` build gagal di Windows | Block VAD | Fallback ke WebRTC VAD (JS pure) |
| `node-portaudio` binary compatibility | Block mic input | Fallback ke `mic` package yang shell ke sox/arecord |
| Porcupine free tier limit | Block wake word | Switch ke OpenWakeWord via Python bridge |
| Whisper.cpp slow tanpa GPU | Slow STT | Use Deepgram cloud as primary, Whisper as offline fb |
| High latency pada mobile | Poor UX | Pre-buffer audio, parallel STT+TTS, WebSocket keep-alive |
| Battery drain (always-listen mobile) | User complaint | Default push-to-talk, optimize VAD duty cycle |

---

## 9. Android-Specific Considerations

### Permissions
```xml
<!-- AndroidManifest.xml (auto-configured by Expo) -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
```

### Audio Configuration
- `expo-av` handles Android AudioRecord automatically
- Sample rate: 16kHz mono (optimal untuk speech)
- Format: PCM16 → convert ke base64 untuk WebSocket
- Background recording: memerlukan foreground service notification

### Battery Optimization
- Push-to-talk mode: recording hanya saat button held
- Always-listen mode: 
  - Local WebRTC VAD di device (JS-based, sangat ringan)
  - Hanya kirim audio chunk saat speech detected
  - Duty cycle: check setiap 100ms, bukan continuous streaming

### Network
- WebSocket persistent connection with auto-reconnect (sudah ada di App.tsx ✅)
- Audio chunk size: ~3.2KB per 100ms (16kHz × 16bit × 100ms)
- Bandwidth: ~256kbps saat streaming (acceptable untuk 4G)

---

## 10. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `EDITH-ts/src/os-agent/voice-io.ts` | Major rewrite: real VAD, wake word, STT | +400 |
| `EDITH-ts/src/gateway/server.ts` | Add voice_chunk handler, session manager | +80 |
| `EDITH-ts/src/gateway/voice-session.ts` | NEW: Voice session manager class | +150 |
| `apps/mobile/components/VoiceButton.tsx` | NEW: Push-to-talk + always-listen UI | +200 |
| `apps/mobile/App.tsx` | Wire VoiceButton into chat screen | +30 |
| `EDITH-ts/src/os-agent/__tests__/voice.test.ts` | NEW: Voice pipeline tests | +150 |
| `EDITH-ts/package.json` | Add dependencies | +5 |
| **Total** | | **~1015 lines** |
