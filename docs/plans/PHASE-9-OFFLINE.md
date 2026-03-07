# Phase 9 — Full Offline / Self-Hosted Mode (Zero-Cloud)

**Prioritas:** 🔴 HIGH — Core goal: EDITH harus bisa jalan 100% tanpa internet
**Depends on:** Phase 1 (voice), Phase 3 (vision)
**Status Saat Ini:** 100% cloud-dependent (Groq, Edge TTS, Deepgram, dsb.) | Local LLM (Ollama) ✅ ada tapi belum jadi primary path | Zero-cloud mode ❌

---

## 1. Tujuan

Setiap komponen EDITH punya **local fallback** — sehingga saat internet mati, EDITH tetap berfungsi penuh. "EDITH offline mode" = JARVIS di bunker tanpa internet.

```mermaid
flowchart TD
    subgraph CloudPath["☁️ Cloud Path (default, fast)"]
        C_LLM["Groq API\nllama-3.3-70b"]
        C_STT["Deepgram nova-3\n~100ms"]
        C_TTS["Edge TTS\nen-US-AriaNeural"]
        C_EMBED["OpenAI text-embedding-3-small"]
        C_VISION["Gemini Vision API"]
    end

    subgraph LocalPath["🏠 Local Path (offline fallback)"]
        L_LLM["Ollama\nqwen2.5:7b or llama3.2:3b"]
        L_STT["whisper.cpp\n(nodejs-whisper)\nbase model"]
        L_TTS["Kokoro TTS\n82M params, offline\nor Piper TTS"]
        L_EMBED["all-MiniLM-L6-v2\n(ONNX, ~22MB)"]
        L_VISION["LLaVA / MiniCPM-V\nvia Ollama"]
    end

    Check{"internet +\nAPI key\navailable?"}

    Check -->|"✅ yes"| CloudPath
    Check -->|"❌ no"| LocalPath

    CloudPath & LocalPath --> EDITH["EDITH Core\n(always works)"]
```

---

## 2. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["9A\nLocal LLM Routing\n(Ollama primary path)"]
    B["9B\nNative STT\n(whisper.cpp TS)"]
    C["9C\nOffline TTS\n(Kokoro / Piper)"]
    D["9D\nLocal Embeddings\n(all-MiniLM ONNX)"]
    E["9E\nLocal Vision\n(LLaVA / MiniCPM-V)"]
    F["9F\nOffline Mode\nCoordinator + health check"]

    A & B & C & D & E --> F
```

---

### Phase 9A — Local LLM Routing (Ollama as Primary)

**Goal:** Jadikan Ollama bukan sekedar fallback tapi configurable sebagai **primary LLM provider** dengan model selection per use case.

**Model tiers untuk EDITH:**

```mermaid
quadrantChart
    title Local Model Selection (Speed vs Quality)
    x-axis Low Quality --> High Quality
    y-axis Slow --> Fast
    quadrant-1 "Best for voice"
    quadrant-2 "Too slow for voice"
    quadrant-3 "Not good enough"
    quadrant-4 "Best balance"
    llama3.2:3b: [0.55, 0.90]
    qwen2.5:3b: [0.60, 0.88]
    qwen2.5:7b: [0.75, 0.65]
    llama3.1:8b: [0.72, 0.60]
    gemma3:4b: [0.62, 0.80]
    mistral:7b: [0.68, 0.62]
    deepseek-r1:7b: [0.80, 0.45]
    phi4-mini:3.8b: [0.65, 0.78]
```

**Config routing logic:**

```mermaid
flowchart TD
    Task["LLM request\n+ context type"]

    Task --> Type{Request type?}

    Type -->|"voice interaction\n(low latency needed)"| Voice["voiceModel\ndefault: ollama/qwen2.5:3b\nTTFT target: <300ms"]
    Type -->|"complex reasoning\n(quality needed)"| Think["thinkModel\ndefault: ollama/qwen2.5:7b\nor Groq if online"]
    Type -->|"code generation"| Code["codeModel\ndefault: ollama/phi4-mini:3.8b\nor deepseek-r1:7b"]
    Type -->|"general chat"| Chat["model\ndefault: groq/llama-3.3-70b\nfallback: ollama/qwen2.5:7b"]
```

**edith.json:**
```json
{
  "llm": {
    "provider": "auto",
    "model": "groq/llama-3.3-70b-versatile",
    "voiceModel": "ollama/qwen2.5:3b",
    "thinkModel": "ollama/qwen2.5:7b",
    "codeModel": "ollama/phi4-mini:3.8b",
    "offlineMode": false,
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "keepAlive": "10m",
      "numCtx": 4096
    }
  }
}
```

**File:** `EDITH-ts/src/engines/orchestrator.ts` — extend routing logic ~+80 lines

---

### Phase 9B — Native STT: whisper.cpp (TypeScript Native)

**Goal:** Ganti Python subprocess untuk STT dengan `nodejs-whisper` — bindings langsung ke whisper.cpp. **No Python required.**

```mermaid
sequenceDiagram
    participant VIO as voice-io.ts
    participant WC as nodejs-whisper (whisper.cpp)
    participant Model as ggml-base.bin

    Note over VIO: speechEnd event with accumulatedPCM

    VIO->>WC: nodewhisper(audioPath, { modelName: 'base', language: 'auto' })
    WC->>Model: load GGML model (lazy, cached)
    Model-->>WC: inference result
    WC-->>VIO: { text: "halo edith apa kabar" }

    Note over VIO: No Python process spawned
```

**Model download size:**
| Model | Disk | RAM | Latency (5s audio, CPU) |
|-------|------|-----|------------------------|
| tiny | 75 MB | 273 MB | ~0.3s |
| base | 142 MB | 388 MB | ~0.5s ← **recommended** |
| small | 466 MB | 852 MB | ~1.2s |

**Bahasa Indonesia support:** Whisper `base` supports `id` language with reasonable accuracy. Use `language: "auto"` untuk auto-detect.

**Files:** `EDITH-ts/src/voice/providers.ts` — add `whisperCpp` provider option
**Dependency:** `pnpm add nodejs-whisper`

---

### Phase 9C — Offline TTS: Kokoro + Piper

**Goal:** Dua level offline TTS — Kokoro untuk kualitas, Piper untuk ultra-low latency.

```mermaid
flowchart LR
    subgraph TTS_Chain["TTS Selection Chain"]
        T1{"tts.engine\n= auto?"}
        T1 -->|"online"| Edge["Edge TTS\n~300ms TTFA\nbest quality\nen-US-AriaNeural"]
        T1 -->|"offline preferred\nor no internet"| Kokoro["Kokoro TTS\n82M params\n~80ms CPU\nApache 2.0"]
        T1 -->|"ultra-low latency\nnotifications only"| Piper["Piper TTS\nC++ binary\n~10ms CPU\nMIT license"]
    end
```

**Kokoro Python sidecar integration** (tambahan ke voice.py existing):
```python
# python/delivery/voice.py — add alongside existing pipeline
from kokoro import KPipeline
_kokoro_pipeline = None

def get_kokoro():
    global _kokoro_pipeline
    if _kokoro_pipeline is None:
        _kokoro_pipeline = KPipeline(lang_code='a')
    return _kokoro_pipeline

def synthesize_offline(text: str, voice: str = 'af_heart') -> bytes:
    pipeline = get_kokoro()
    audio, sr = pipeline(text, voice=voice, speed=1.0)
    # returns raw PCM bytes at 24kHz
    return audio.tobytes()
```

**Piper setup (Windows/Linux/Mac binary):**
```bash
# Download piper binary + voice model
curl -L https://github.com/rhasspy/piper/releases/latest/download/piper_windows_amd64.zip -o piper.zip
unzip piper.zip -d tools/piper/
# Voice model (en, high quality, ~65MB)
curl -L .../en_US-lessac-high.onnx -o models/piper-en.onnx
```

```typescript
// Integration in EdgeEngine or new OfflineTTSEngine
await execa('tools/piper/piper', [
  '--model', 'models/piper-en.onnx',
  '--output_file', '/tmp/edith-tts.wav',
], { input: text })
```

---

### Phase 9D — Local Embeddings (all-MiniLM ONNX)

**Goal:** Ganti `text-embedding-3-small` (OpenAI API, needs internet) dengan model ONNX lokal untuk vector search di memory.

**Model:** `all-MiniLM-L6-v2` (sentence-transformers) — 22MB, 384 dims, MIT license

```mermaid
flowchart TD
    Text["Text to embed"]
    Check{embedding.provider\ndi edith.json?}

    Text --> Check

    Check -->|"openai\n(default, cloud)"| OAI["OpenAI\ntext-embedding-3-small\n1536 dims, cloud"]
    Check -->|"local\n(offline)"| ONNX["all-MiniLM-L6-v2\nONNX Runtime\n384 dims, 22MB\n~5ms/text CPU"]
    Check -->|"ollama"| OLL["Ollama\nnomic-embed-text\n768 dims, local API"]

    OAI & ONNX & OLL --> Vector["LanceDB\nvector store"]
```

**Note:** Dimensi berbeda (384 vs 1536) — perlu migration atau separate index per provider. Gunakan `embeddings.dimension` di config untuk handle ini.

**Dependency:** `pnpm add @xenova/transformers` — runs ONNX models via Hugging Face Transformers.js

**File:** `EDITH-ts/src/memory/store.ts` — add local embedding provider path ~+60 lines

---

### Phase 9E — Local Vision (LLaVA / MiniCPM-V via Ollama)

**Goal:** Ganti Gemini Vision API dengan local multimodal LLM untuk `describeImage()`.

**Models via Ollama:**
| Model | Size | Quality | VRAM |
|-------|------|---------|------|
| `llava:7b` | 4.7 GB | Good | 6 GB |
| `llava:13b` | 8.0 GB | Better | 10 GB |
| `minicpm-v:8b` | 5.5 GB | Best (OCR+detail) | 8 GB |
| `moondream:1.8b` | 1.1 GB | Basic | 2 GB ← **low-spec recommended** |

```mermaid
flowchart TD
    Image["Screenshot / image bytes"]

    Check{vision.provider\ndi edith.json?}
    Image --> Check

    Check -->|"gemini (cloud)"| Gemini["Gemini Vision API\nBest quality"]
    Check -->|"openai (cloud)"| GPT4V["GPT-4o Vision\nBest for UI grounding"]
    Check -->|"ollama (local)"| Ollama["Ollama multimodal\nminicpm-v:8b / moondream\nFully offline"]

    Gemini & GPT4V & Ollama --> Desc["Image description\n→ VisionCortex.describeImage()"]
```

**File:** `EDITH-ts/src/os-agent/vision-cortex.ts` — implement `describeImage()` with provider routing (currently a stub!) ~+80 lines
**Dependency:** Already have Ollama in engine (just need base64 image support in the Ollama adapter)

---

### Phase 9F — Offline Mode Coordinator

Central health checker yang monitor semua services dan route ke offline alternatives:

```mermaid
stateDiagram-v2
    [*] --> ONLINE : startup with internet
    [*] --> OFFLINE : startup without internet
    ONLINE --> DEGRADED : some cloud APIs unreachable
    ONLINE --> OFFLINE : all internet lost
    OFFLINE --> ONLINE : internet restored
    DEGRADED --> ONLINE : APIs back
    DEGRADED --> OFFLINE : full disconnect

    note right of ONLINE : All cloud APIs active\nBest quality
    note right of DEGRADED : Mix of cloud + local\nSelective fallback
    note right of OFFLINE : All local models\nFull functionality maintained
```

```typescript
// EDITH-ts/src/core/offline-coordinator.ts (NEW)
export class OfflineCoordinator {
  private status: 'online' | 'degraded' | 'offline' = 'online'

  async checkConnectivity(): Promise<void> {
    const checks = await Promise.allSettled([
      this.pingGroq(),
      this.pingDeepgram(),
      this.pingEdgeTTS(),
    ])
    // Update status + emit event for re-routing
  }

  getProvider(type: 'llm' | 'stt' | 'tts' | 'embed'): string {
    if (this.status === 'offline') return this.localProviders[type]
    return this.config[type].preferred
  }
}
```

**TTS/STT/LLM availability dashboard va EDITH voice:**
```
"Sir, Groq API is currently unreachable.
 Switching to local Ollama (qwen2.5:3b) for this session.
 All features remain available."
```

---

## 3. Self-Hosted Stack Overview

```mermaid
flowchart TD
    subgraph FullOfflineStack["🏠 Full Offline EDITH Stack"]
        direction TB
        LLM["🤖 LLM\nOllama qwen2.5:7b\nor llama3.2:3b (voice)"]
        STT["🎤 STT\nwhisper.cpp base\n(nodejs-whisper)"]
        TTS["🔊 TTS\nKokoro 82M\nor Piper ~10ms"]
        WAKE["👂 Wake Word\nOpenWakeWord\nhey_edith.onnx"]
        VAD["⚡ VAD\nSilero ONNX\n2MB model"]
        EMBED["🔢 Embeddings\nall-MiniLM-L6-v2\n22MB ONNX"]
        VISION["👁️ Vision\nOllama moondream:1.8b\nor minicpm-v:8b"]
        DB["💾 Database\nSQLite (local)\nLanceDB (local)"]
    end

    style LLM fill:#1a1a2e,color:#fff
    style STT fill:#16213e,color:#fff
    style TTS fill:#16213e,color:#fff
    style WAKE fill:#16213e,color:#fff
    style VAD fill:#16213e,color:#fff
    style EMBED fill:#16213e,color:#fff
    style VISION fill:#16213e,color:#fff
    style DB fill:#0f3460,color:#fff
```

**Minimum hardware untuk full offline:**
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| VRAM | 0 GB (CPU only) | 6 GB GPU |
| Storage | 8 GB | 20 GB |
| CPU | i5/Ryzen 5 | i7/Ryzen 7 |

---

## 4. File Changes Summary

| File | Action | Est. Lines |
|------|--------|-----------|
| `EDITH-ts/src/engines/orchestrator.ts` | Route by request type + offline fallback | +80 |
| `EDITH-ts/src/voice/providers.ts` | Add whisperCpp provider | +60 |
| `EDITH-ts/src/voice/bridge.ts` | Offline TTS chain (Kokoro/Piper) | +80 |
| `EDITH-ts/src/memory/store.ts` | Local embedding provider | +60 |
| `EDITH-ts/src/os-agent/vision-cortex.ts` | Implement describeImage() with Ollama | +80 |
| `EDITH-ts/src/core/offline-coordinator.ts` | NEW — health check + routing | +150 |
| `EDITH-ts/src/config/edith-config.ts` | offlineMode, voiceModel, localModel schemas | +50 |
| `python/delivery/voice.py` | Add Kokoro TTS synthesize_offline() | +40 |
| `EDITH-ts/src/__tests__/offline.test.ts` | NEW — offline mode tests | +100 |
| **Total** | | **~700 lines** |

**New deps:**
```bash
pnpm add nodejs-whisper          # whisper.cpp TS native STT
pnpm add @xenova/transformers    # local ONNX embeddings
pip install kokoro soundfile     # offline TTS (Python sidecar)
# piper — binary download, no npm package
```
