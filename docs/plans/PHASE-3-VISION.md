# Phase 3 — Vision Intelligence (Screen Understanding + Multimodal)

**Durasi Estimasi:** 2 minggu  
**Prioritas:** 🟠 HIGH — Kunci untuk GUI automation yang cerdas  
**Status Saat Ini:** Screenshot ✅ | OCR (Tesseract) ✅ | describeImage ❌ (placeholder) | UI Grounding ❌  

---

## 1. Tujuan

Upgrade VisionCortex dari "bisa screenshot + OCR" menjadi "bisa memahami layar":
1. **describeImage** → Kirim screenshot ke multimodal LLM (Gemini/GPT-4V) dan dapatkan deskripsi
2. **UI Grounding** → Identifikasi elemen UI yang bisa diklik berdasarkan instruksi natural language
3. **Visual Memory** → Simpan visual context ke memory system untuk recall nanti
4. **Mobile Camera Vision** → Android bisa kirim foto/screenshot untuk dianalisis server

---

## 2. Arsitektur Sistem

### 2.1 Vision Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Vision Intelligence Pipeline                   │
│                                                                   │
│  Input Sources:                                                   │
│  ┌─────────┐  ┌─────────────┐  ┌──────────────┐                │
│  │ Screen   │  │ Mobile      │  │ File/URL     │                │
│  │ Capture  │  │ Camera/     │  │ Image        │                │
│  │ (desktop)│  │ Screenshot  │  │ (shared)     │                │
│  └────┬─────┘  └──────┬──────┘  └──────┬───────┘                │
│       │               │               │                          │
│       └───────────────┼───────────────┘                          │
│                       ▼                                           │
│  ┌────────────────────────────────────────────────┐              │
│  │             Image Router                        │              │
│  │                                                 │              │
│  │  • Size check (max 20MB)                       │              │
│  │  • Format validation (PNG/JPEG/WebP/GIF)       │              │
│  │  • Resolution normalization (max 2048px edge)   │              │
│  │  • Base64 encoding for API transport            │              │
│  └──────────────────┬─────────────────────────────┘              │
│                     │                                             │
│     ┌───────────────┼───────────────┐                            │
│     ▼               ▼               ▼                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐                   │
│  │ OCR      │  │ Multimod │  │ UI Element   │                   │
│  │ Path     │  │ LLM Path │  │ Detection    │                   │
│  │          │  │          │  │              │                   │
│  │ Tesseract│  │ Gemini   │  │ Accessibility│                   │
│  │ (local)  │  │ GPT-4V   │  │ API (Win)    │                   │
│  │          │  │ Claude   │  │              │                   │
│  │ Text     │  │          │  │ OmniParser   │                   │
│  │ Extract  │  │ Describe │  │ (YOLO-based) │                   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘                   │
│       │              │               │                            │
│       └──────────────┼───────────────┘                            │
│                      ▼                                            │
│  ┌────────────────────────────────────────────────┐              │
│  │           Vision Result Aggregator              │              │
│  │                                                 │              │
│  │  {                                              │              │
│  │    ocrText: "File Edit View ...",               │              │
│  │    description: "VS Code with TypeScript...",   │              │
│  │    elements: [ {type:"button", text:"Run"} ],   │              │
│  │    screenState: { activeWindow, resolution },   │              │
│  │    confidence: 0.92,                            │              │
│  │    timestamp: 1234567890                        │              │
│  │  }                                              │              │
│  └──────────────────┬─────────────────────────────┘              │
│                     │                                             │
│                     ▼                                             │
│  ┌────────────────────────────────────────┐                      │
│  │       Visual Memory (Optional)          │                      │
│  │  Store as MemoryNode with:              │                      │
│  │  - category: "visual_context"           │                      │
│  │  - embedding: dari description text     │                      │
│  │  - metadata: { screenshot hash, etc. }  │                      │
│  └────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Multimodal LLM Integration (via Orchestrator)

```
┌───────────────────────────────────────────────────────┐
│              Engine Orchestrator (existing)             │
│                                                        │
│  Task: "multimodal"                                    │
│  Route: gemini → openai → anthropic → openrouter      │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Gemini (Recommended — Best value)                │ │
│  │                                                   │ │
│  │  POST generativelanguage.googleapis.com/v1beta/   │ │
│  │  models/gemini-2.0-flash:generateContent          │ │
│  │                                                   │ │
│  │  {                                                │ │
│  │    contents: [{                                   │ │
│  │      parts: [                                     │ │
│  │        { text: "Describe..." },                   │ │
│  │        { inlineData: {                            │ │
│  │            mimeType: "image/png",                 │ │
│  │            data: "<base64>"                       │ │
│  │        }}                                         │ │
│  │      ]                                            │ │
│  │    }]                                             │ │
│  │  }                                                │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  OpenAI GPT-4V (Fallback)                         │ │
│  │                                                   │ │
│  │  POST api.openai.com/v1/chat/completions          │ │
│  │  model: "gpt-4o"                                  │ │
│  │                                                   │ │
│  │  messages: [{                                     │ │
│  │    role: "user",                                  │ │
│  │    content: [                                     │ │
│  │      { type: "text", text: "Describe..." },       │ │
│  │      { type: "image_url", image_url: {            │ │
│  │          url: "data:image/png;base64,<data>"      │ │
│  │      }}                                           │ │
│  │    ]                                              │ │
│  │  }]                                               │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Anthropic Claude (Fallback)                      │ │
│  │                                                   │ │
│  │  POST api.anthropic.com/v1/messages               │ │
│  │  model: "claude-sonnet-4-20250514"                │ │
│  │                                                   │ │
│  │  content: [                                       │ │
│  │    { type: "image", source: {                     │ │
│  │        type: "base64",                            │ │
│  │        media_type: "image/png",                   │ │
│  │        data: "<base64>"                           │ │
│  │    }},                                            │ │
│  │    { type: "text", text: "Describe..." }          │ │
│  │  ]                                                │ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

### 2.3 Mobile Vision Architecture (Android/iOS)

```
┌────────────────────────────────────────────┐
│         MOBILE (React Native Expo)          │
│                                             │
│  ┌───────────────┐  ┌─────────────────┐   │
│  │ expo-camera    │  │ expo-image-     │   │
│  │ (take photo)   │  │ picker (gallery)│   │
│  └───────┬───────┘  └───────┬─────────┘   │
│          │                   │              │
│          └─────────┬─────────┘              │
│                    ▼                         │
│  ┌─────────────────────────────────────┐   │
│  │  Image Preprocessor                  │   │
│  │  - Resize to max 1024px             │   │
│  │  - Convert to JPEG (quality 85%)    │   │
│  │  - Base64 encode                     │   │
│  └─────────────┬───────────────────────┘   │
│                │                            │
│                ▼                             │
│  ┌─────────────────────────────────────┐   │
│  │  WebSocket → Gateway                 │   │
│  │                                      │   │
│  │  { type: "vision_analyze",           │   │
│  │    image: "<base64>",                │   │
│  │    question: "What's this?",         │   │
│  │    mode: "describe" | "ocr" |        │   │
│  │           "find_element"  }          │   │
│  └─────────────┬───────────────────────┘   │
│                │                            │
│                ▼                             │
│  ┌─────────────────────────────────────┐   │
│  │  Response Display                    │   │
│  │  ← { type: "vision_result",          │   │
│  │      description: "...",             │   │
│  │      ocrText: "...",                 │   │
│  │      elements: [...] }              │   │
│  └─────────────────────────────────────┘   │
└────────────────────────────────────────────┘
         │
         │ WebSocket
         ▼
┌────────────────────────────────────────────┐
│          SERVER (Orion Gateway)              │
│                                             │
│  vision_analyze → VisionCortex              │
│    → describeImage (multimodal LLM)         │
│    → extractText (Tesseract OCR)            │
│    → detectElements (accessibility/YOLO)    │
│                                             │
│  Result → vision_result                     │
└────────────────────────────────────────────┘
```

---

## 3. Komponen yang Harus Dibangun

### 3.1 describeImage — Real Implementation

**File:** `orion-ts/src/os-agent/vision-cortex.ts` → `describeImage()`

**Status:** ❌ Returns placeholder string

**Implementasi:**
```typescript
async describeImage(imageBuffer: Buffer, question?: string): Promise<string> {
  const base64 = imageBuffer.toString("base64")
  const mimeType = this.detectMimeType(imageBuffer)
  const prompt = question ?? "Describe what you see in this image in detail."
  
  // Use engine orchestrator with multimodal task type
  const { getOrchestrator } = await import("../engines/orchestrator.js")
  const orchestrator = getOrchestrator()
  
  const result = await orchestrator.generate("multimodal", {
    prompt,
    context: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image", data: base64, mimeType }
      ]
    }],
    maxTokens: 1024,
  })
  
  return result.text
}
```

**Provider-specific payload formatting diperlukan di orchestrator level** — masing-masing provider (Gemini, OpenAI, Anthropic) punya format berbeda untuk image content.

### 3.2 UI Grounding — Find Element by Description

**File:** `orion-ts/src/os-agent/vision-cortex.ts` → NEW `findElement()`

**Purpose:** User bilang "click the blue submit button" → Nova perlu tahu koordinat button tersebut.

**Approach:**
```
Strategy A — Accessibility API First (Fast, Reliable):
  1. Get all UI elements via accessibility API
  2. Match element text/name with user description
  3. Return bounding box coordinates

Strategy B — Visual Grounding via LLM (Flexible, Slower):  
  1. Take screenshot
  2. Send to multimodal LLM with prompt: 
     "Find the {description} in this image. Return its coordinates."
  3. Parse coordinate response
  4. Return bounding box

Combined Strategy (Recommended):
  1. Try accessibility API first (< 200ms)
  2. If no match → fall back to visual grounding via LLM (~2s)
  3. Cache results for repeated queries
```

### 3.3 Visual Memory Integration

**File:** `orion-ts/src/os-agent/vision-cortex.ts` → NEW `storeVisualContext()`

**Purpose:** Simpan apa yang dilihat Nova di layar ke memory system agar bisa recall nanti.

```typescript
async storeVisualContext(snapshot: {
  description: string
  ocrText: string
  activeWindow: string
  timestamp: number
}): Promise<void> {
  const { memoryService } = await import("../memory/store.js")
  
  await memoryService.storeMemory({
    userId: "owner",
    content: `[Visual Context] ${snapshot.activeWindow}: ${snapshot.description}`,
    category: "visual_context",
    metadata: {
      ocrText: snapshot.ocrText.slice(0, 500), // Truncate
      activeWindow: snapshot.activeWindow,
      capturedAt: snapshot.timestamp,
    },
    importance: 0.3, // Low importance unless explicitly referenced
    ttlDays: 7,      // Auto-expire after 1 week
  })
}
```

### 3.4 Orchestrator Multimodal Extension

**File:** `orion-ts/src/engines/orchestrator.ts`

**Status:** Routes `multimodal` task, tapi payload format untuk image tidak dihandle per-provider.

**Yang perlu ditambah:**
```typescript
// Di masing-masing engine adapter:

// gemini-adapter.ts
function formatMultimodalPayload(prompt: string, images: ImageContent[]): GeminiRequest {
  return {
    contents: [{
      parts: [
        { text: prompt },
        ...images.map(img => ({
          inlineData: { mimeType: img.mimeType, data: img.base64 }
        }))
      ]
    }]
  }
}

// openai-adapter.ts  
function formatMultimodalPayload(prompt: string, images: ImageContent[]): OpenAIRequest {
  return {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...images.map(img => ({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
        }))
      ]
    }]
  }
}
```

### 3.5 Gateway vision_analyze Handler

**File:** `orion-ts/src/gateway/server.ts`

**Status:** ❌ Belum ada handler

**Tambahkan:**
```typescript
case "vision_analyze": {
  const { image, question, mode } = payload
  const imageBuffer = Buffer.from(image, "base64")
  
  if (mode === "ocr") {
    const text = await visionCortex.extractText(imageBuffer)
    send({ type: "vision_result", ocrText: text })
  } else if (mode === "describe") {
    const description = await visionCortex.describeImage(imageBuffer, question)
    send({ type: "vision_result", description })
  } else if (mode === "find_element") {
    const elements = await visionCortex.findElement(imageBuffer, question)
    send({ type: "vision_result", elements })
  }
  break
}
```

---

## 4. Dependency Tree

```
Production Dependencies (Desktop):
├── tesseract            # OCR — sudah digunakan ✅
├── (orchestrator)       # Multimodal LLM — sudah ada ✅ (perlu extension)
└── (no new npm deps)    # Semua via existing engine providers

Production Dependencies (Mobile — tambahan):
├── expo-camera          # Camera access (capture foto untuk vision)
├── expo-image-picker    # Pick dari gallery
└── expo-file-system     # Read/resize image

Dev Dependencies:
└── (none new)
```

---

## 5. Implementation Roadmap

### Week 1: describeImage + Orchestrator Extension

| Task | File | Detail |
|------|------|--------|
| Audit orchestrator multimodal support | orchestrator.ts | Trace `generate("multimodal", ...)` flow |
| Add image payload formatting — Gemini | engines/gemini/ | `inlineData` format |
| Add image payload formatting — OpenAI | engines/openai/ | `image_url` format |
| Add image payload formatting — Anthropic | engines/anthropic/ | `source.base64` format |
| Implement real `describeImage()` | vision-cortex.ts | Call orchestrator with image data |
| Add `findElement()` method | vision-cortex.ts | Accessibility + LLM fallback |
| Test describeImage with screenshot | manual test | Verify output quality |
| Image size/format validation | vision-cortex.ts | Max 20MB, resize if >2048px |

### Week 2: Visual Memory + Mobile + Polish

| Task | File | Detail |
|------|------|--------|
| Visual memory integration | vision-cortex.ts | Store visual context periodically |
| Gateway vision_analyze handler | server.ts | WebSocket message handler |
| Mobile: add expo-camera | apps/mobile/ | `pnpm add expo-camera` |
| Mobile: VisionButton component | apps/mobile/ | Take photo → send → display result |
| Mobile: screenshot share | apps/mobile/ | Share screenshot from other apps to Nova |
| Unit tests for describeImage | __tests__/ | Mock orchestrator, verify payload format |
| Unit tests for findElement | __tests__/ | Mock accessibility API + LLM |
| Integration test: mobile → server | __tests__/ | WS vision_analyze flow |

---

## 6. Android-Specific Considerations

### Permissions
```json
// app.json (Expo config)
{
  "expo": {
    "plugins": [
      ["expo-camera", {
        "cameraPermission": "Nova needs camera to analyze what you're looking at"
      }],
      ["expo-image-picker", {
        "photosPermission": "Nova needs gallery access to analyze images"  
      }]
    ]
  }
}
```

### Image Optimization for Android
- **Camera resolution:** Capture at 1024px max width (16:9) — reduce upload size
- **Compression:** JPEG quality 85% — good balance quality vs size
- **Upload size:** ~100-300KB per image after optimization
- **Bandwidth:** Single image upload ~300ms on 4G
- **Timeout:** 10s for LLM vision analysis

### Share Intent (Android-Specific)
```
AndroidManifest.xml:
<intent-filter>
  <action android:name="android.intent.action.SEND" />
  <category android:name="android.intent.category.DEFAULT" />
  <data android:mimeType="image/*" />
</intent-filter>
```
*Allows user to share images from any app (Gallery, Chrome, etc.) to Nova for analysis.*

### Battery/Performance
- Image processing (resize, encode) di background thread
- Cache recent analysis results (avoid re-analyzing same screenshot)
- Limit to 1 concurrent vision request

---

## 7. Testing Strategy

```
Unit Tests (10 tests — dari Phase 2):
├── describeImage calls orchestrator with correct multimodal payload
├── describeImage handles orchestrator failure gracefully
├── findElement via accessibility API returns matching element
├── findElement falls back to LLM when accessibility fails
├── Image format detection (PNG/JPEG/WebP)
├── Image resize for oversized inputs
├── storeVisualContext creates memory node
├── Gateway vision_analyze routing (ocr/describe/find)
├── Mobile VisionButton sends correct WS message
└── Mobile displays vision_result correctly

Integration Tests (3 tests):
├── Screenshot → describeImage → meaningful description
├── Mobile camera → WS → server vision → response to mobile
└── Visual memory store → retrieve via conversation context
```

---

## 8. Risiko & Mitigasi

| Risiko | Impact | Mitigasi |
|--------|--------|---------|
| Multimodal LLM quota/cost | Expensive for frequent screenshots | Rate limit: max 1 vision call per 10s, cache results |
| Gemini API image size limit (20MB) | Large screenshots rejected | Auto-resize to max 2048px edge before upload |
| Tesseract accuracy poor | Bad OCR results | Use multimodal LLM as fallback for text extraction |
| UI grounding coordinates accuracy | Click wrong element | Combine accessibility API + LLM, validate with screenshot |
| Mobile image upload slow on 3G | Poor UX | Aggressive compression, show loading state, timeout+retry |
| Visual memory storage bloat | Database grows fast | TTL 7 days, max 100 visual memories, auto-prune |

---

## 9. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `src/os-agent/vision-cortex.ts` | Rewrite describeImage, add findElement, visual memory | +200 |
| `src/engines/orchestrator.ts` | Add multimodal payload formatting per provider | +60 |
| `src/engines/adapters/gemini.ts` | Image payload support | +30 |
| `src/engines/adapters/openai.ts` | Image payload support | +30 |
| `src/engines/adapters/anthropic.ts` | Image payload support | +30 |
| `src/gateway/server.ts` | Add vision_analyze WS handler | +40 |
| `apps/mobile/components/VisionButton.tsx` | NEW: Camera + analyze UI | +180 |
| `apps/mobile/App.tsx` | Wire VisionButton | +20 |
| `src/os-agent/__tests__/vision-cortex.test.ts` | Extended tests | +100 |
| **Total** | | **~690 lines** |
