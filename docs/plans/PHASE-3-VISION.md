# Phase 3 — Vision Intelligence: EDITH Sees The World

> *"JARVIS, what am I looking at?"*
> *"You're looking at a 3-layer multimodal pipeline, sir. I'd recommend we build it properly this time."*

**Durasi Estimasi:** 2 minggu
**Prioritas:** 🔴 CRITICAL — Tanpa mata, EDITH cuma AI biasa
**Status Saat Ini:** Screenshot ✅ | OCR (Tesseract) ✅ | describeImage ❌ (placeholder) | UI Grounding ❌

---

## Cara Tony Stark Mikir Waktu Bikin Ini

Tony nggak langsung nulis kode. Dia duduk di workshop, liatin problem-nya dari semua sudut, terus tanya: **"Apa yang sebenernya harus bisa dilakukan sistem ini?"**

Jawabannya bukan "deskripsi gambar". Jawabannya adalah:

1. **EDITH harus bisa ngerti state layar kapanpun** — sama kayak Tony minta JARVIS "tunjukin saya apa yang ada di depan gua"
2. **EDITH harus bisa nemuin elemen UI dan klik** — bukan dengan xpath atau DOM, tapi dengan mata
3. **EDITH harus inget apa yang pernah dia lihat** — bukan cuma describe sekali terus lupa

Dari 3 requirement itu lahir seluruh arsitektur Phase 3. Semuanya bekerja ke atas dari sana.

---

## 1. Landasan Riset — Paper Terbaik 2024–2025

File lama kita pakai 6 paper. Ini versi upgrade: **9 paper**, termasuk yang lebih baru dan lebih relevan.

---

### Paper 1: OmniParser V2 (Microsoft Research, Feb 2025)
**arXiv/Source:** Microsoft Research Blog + `arXiv:2408.00203` (V1), V2 weights di HuggingFace `microsoft/OmniParser-v2.0`

**Apa isinya:**
OmniParser mengkonversi screenshot UI menjadi elemen terstruktur — teks, ikon, bounding box — tanpa perlu akses DOM atau HTML. V2 adalah upgrade besar dari V1: dataset deteksi elemen interaktif diperbesar, model caption icon diganti lebih ringan, sehingga latency turun **60%** (rata-rata 0.6 detik/frame di A100, 0.8 detik di RTX 4090 single). Pipeline-nya: YOLOv8 fine-tuned untuk deteksi region interaktif, Florence-2 fine-tuned untuk caption icon. Kombinasi OmniParser V2 + GPT-4o mencapai **39.6% average accuracy** di ScreenSpot Pro benchmark — state of the art untuk grounding benchmark resolusi tinggi.

**Yang EDITH adopt:**
- Strategi deteksi dua langkah: detect regions dulu (YOLO), baru caption (Florence/LLM)
- Fallback ke LLM-vision kalau accessibility API gagal
- Rate: max 1 vision call per 10 detik untuk cost control

---

### Paper 2: UI-TARS — Native GUI Agent (ByteDance, Jan 2025)
**arXiv:** `2501.12326`

**Apa isinya:**
UI-TARS adalah model end-to-end yang input-nya pure screenshot, output-nya aksi keyboard/mouse. Yang revolusioner: model ini bukan wrapper di atas GPT-4o, tapi model native yang ditraining dari nol dengan 4 inovasi utama. **(1) Enhanced Perception** — dataset besar screenshot GUI untuk caption yang context-aware. **(2) Unified Action Modeling** — action space yang di-standardisasi lintas platform: "click" di Windows = "tap" di Android, model bisa transfer knowledge antar OS. **(3) System-2 Reasoning** — model bisa decompose task, reflect, milestone tracking — bukan cuma "lihat terus klik". **(4) Iterative Training with Reflective Traces** — model ditraining di ratusan VM virtual, belajar dari kesalahannya sendiri. Hasilnya: di OSWorld benchmark, UI-TARS score **24.6** (50 steps) mengalahkan Claude Computer Use (22.0). Di AndroidWorld, score **46.6** mengalahkan GPT-4o (34.5).

**Yang EDITH adopt:**
- Loop kognitif: **Perceive → Decompose → Act → Reflect** (bukan cuma Capture → Describe)
- Unified action vocabulary: `click`, `type`, `scroll`, `drag`, `hotkey` yang konsisten di semua platform
- Reflection setelah setiap aksi: "apakah screen berubah sesuai ekspektasi?"

---

### Paper 3: Qwen2.5-VL Technical Report (Alibaba/Qwen Team, Feb 2025)
**arXiv:** `2502.13923`

**Apa isinya:**
Qwen2.5-VL adalah multimodal model yang bisa jadi backbone vision agent langsung — tanpa butuh OmniParser eksternal. Inovasinya: **(1) Native Dynamic Resolution** — ViT di-train dari nol dengan window attention, bisa handle gambar berbagai ukuran tanpa normalisasi koordinat tradisional. **(2) Absolute Coordinate Grounding** — model langsung output koordinat bounding box dalam skala asli gambar, bukan nilai 0-1 ternormalisasi. **(3) Computer Use native** — model bisa navigate desktop dan mobile tanpa fine-tuning tambahan. Flagship Qwen2.5-VL-72B setara GPT-4o dan Claude 3.5 Sonnet di banyak benchmark. Model 7B-nya sudah cukup kuat untuk grounding tasks di resource terbatas.

**Yang EDITH adopt:**
- Qwen2.5-VL-7B sebagai **kandidat local model** untuk grounding (bisa jalan di consumer GPU)
- Absolute coordinate output — tidak perlu konversi koordinat lagi
- Sebagai 4th provider di orchestrator fallback chain

---

### Paper 4: GUI-Actor — Coordinate-Free Visual Grounding (Microsoft, Jun 2025)
**arXiv:** `2506.03143`

**Apa isinya:**
GUI-Actor memperkenalkan pendekatan berbeda dari semua paper di atas: bukan prediksi koordinat XY, tapi "attention-based action head" yang di-attach ke frozen VLM. Model belajar untuk "attend" ke visual patch yang relevan, lalu produce multiple candidate regions per forward pass. Ada optional grounding verifier yang scoring kandidat untuk pilih yang terbaik. Hasilnya di ScreenSpot-Pro: GUI-Actor-7B **mengalahkan UI-TARS-72B** — model 7x lebih kecil bisa mengalahkan model 10x lebih besar karena pendekatan spatialnya lebih akurat. Hanya fine-tune ~100 juta parameter di atas Qwen2.5-VL.

**Yang EDITH adopt:**
- Konsep multi-candidate grounding — generate beberapa kandidat klik, pilih yang paling confident
- Verifier pattern: sebelum klik, verify dulu dengan confidence score
- Referensi untuk future fine-tuning EDITH di UI spesifik

---

### Paper 5: ScreenAgent — VLM-Driven Computer Control (IJCAI 2024)

**Apa isinya:**
ScreenAgent mendefinisikan framework Plan → Act → Reflect untuk agen yang kontrol komputer via VLM. Tiga fase ini bukan cuma alur, tapi masing-masing bisa di-cache dan di-test secara independen. Plan phase menghasilkan action tree. Act phase mengeksekusi satu langkah. Reflect phase mengevaluasi apakah layar berubah sesuai rencana — kalau tidak, revise plan. Paper ini juga membahas challenge practical: screenshot timing (harus capture setelah animasi selesai), handling modal dialogs, dan recovery dari unexpected states.

**Yang EDITH adopt:**
- Pipeline separation: setiap tahap (Plan/Act/Reflect) testable independen
- Screenshot timing: delay 300ms setelah aksi sebelum capture untuk tunggu animasi
- Unexpected state recovery: kalau 3x reflect gagal, escalate ke user

---

### Paper 6: OSWorld — Benchmarking Multimodal Agents (arXiv:2404.07972)
**arXiv:** `2404.07972`

**Apa isinya:**
OSWorld menyediakan 369 OS-level tasks di real VM — bukan simulasi, tapi aplikasi nyata: VS Code, Chrome, LibreOffice, GIMP, dll. Setiap task punya automated evaluator (bukan LLM judge) yang verify apakah task benar-benar selesai. Paper ini expose kelemahan utama VLM saat ini: mereka lemah di multi-step tasks yang butuh state tracking, mereka sering klik elemen yang mirip tapi salah, dan mereka tidak bisa recover dari errors. Ini benchmark gold standard untuk mengevaluasi agent seperti EDITH.

**Yang EDITH adopt:**
- Pattern evaluasi: setelah task selesai, verify state final (bukan cuma assume sukses)
- Rate limiting: max 1 vision call per 10 detik (dari OSWorld cost analysis)
- Multi-provider fallback: Gemini → OpenAI → Anthropic (dari OSWorld evaluation approach)

---

### Paper 7: Set-of-Mark (SoM) Visual Prompting (arXiv:2310.11441)
**arXiv:** `2310.11441`

**Apa isinya:**
SoM memperkenalkan teknik sederhana tapi powerful: overlay numbered markers di atas UI elements sebelum kasih ke LLM. Alih-alih minta LLM predict koordinat XY (yang sering inaccurate), kita tanya "klik nomor berapa?" LLM jauh lebih akurat menjawab pertanyaan berbasis ID daripada memprediksi posisi pixel. OmniParser, UI-TARS, dan hampir semua paper modern menggunakan SoM sebagai teknik prompting.

**Yang EDITH adopt:**
- Untuk `findElement()`: overlay numbered bounding boxes sebelum query LLM
- LLM jawab "element #7" → mapping ke koordinat aktual di belakang layar

---

### Paper 8: MemGPT — LLMs as Operating Systems (arXiv:2310.08560)
**arXiv:** `2310.08560`

**Apa isinya:**
MemGPT mengusulkan arsitektur memori hierarki untuk LLM: main context (working memory, fast), external storage (long-term memory, slow), dan mekanisme paging di antara keduanya. Ketika context penuh, model bisa evict informasi ke storage dan retrieve kapanpun dibutuhkan — persis seperti OS manage RAM. Untuk vision agent, ini berarti screenshot history tidak harus selalu ada di context — bisa di-store sebagai embedding dan di-retrieve saat relevan.

**Yang EDITH adopt:**
- Visual context store: setiap screenshot di-describe, di-embed, di-store dengan TTL 7 hari
- Retrieval saat task perlu context historis: "tadi window mana yang aktif?"
- Auto-expire untuk kontrol storage

---

### Paper 9: GPT-4V System Card (OpenAI, 2023)

**Apa isinya:**
System card GPT-4V mendokumentasikan batas-batas praktis multimodal model: ukuran gambar optimal, format yang didukung, dan risiko keamanan. Recommendation utama: max 20MB per gambar, resize ke max 2048px di sisi terpanjang, validasi MIME type sebelum kirim ke API. Rate limiting penting untuk cegah cost explosion di production.

**Yang EDITH adopt:**
- Image validation: size check (max 20MB), format check (PNG/JPEG/WebP/GIF), resize otomatis >2048px
- Cost guard: vision call rate limit, log setiap call dengan estimasi cost

---

## 2. Arsitektur — Blueprint EDITH Vision

Kalau Tony gambar di hologram, ini yang dia lihat:

```
╔══════════════════════════════════════════════════════════════════╗
║                   EDITH VISION CORTEX v3                         ║
║          "Dipercaya - Diuji - Bisa Diandalkan"                   ║
╚══════════════════════════════════════════════════════════════════╝

  INPUT SOURCES
  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐
  │  Desktop    │   │  Mobile      │   │  File/URL       │
  │  Screenshot │   │  Camera      │   │  Image          │
  └──────┬──────┘   └──────┬───────┘   └────────┬────────┘
         └─────────────────┼────────────────────┘
                           ▼
  ╔══════════════════════════════════════════════╗
  ║  IMAGE SANITIZER (GPT-4V Card principles)    ║
  ║  • MIME type validation                      ║
  ║  • Size guard: max 20MB                      ║
  ║  • Auto-resize: max 2048px edge              ║
  ║  • Base64 encoding untuk API transport       ║
  ╚══════════════════════╦═══════════════════════╝
                         ║
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌──────────┐    ┌───────────┐    ┌─────────────┐
  │  OCR     │    │ MULTIMOD  │    │ UI GROUNDING│
  │  PATH    │    │ LLM PATH  │    │ PATH        │
  │          │    │           │    │             │
  │Tesseract │    │Gemini 2.0 │    │Accessibility│
  │(local,   │    │Flash      │    │API first    │
  │ fast)    │    │→ GPT-4o   │    │→ OmniParser │
  │          │    │→ Claude   │    │  fallback   │
  │Text only │    │→Qwen2.5VL │    │→ LLM+SoM   │
  └────┬─────┘    └────┬──────┘    └──────┬──────┘
       └───────────────┼──────────────────┘
                       ▼
  ╔══════════════════════════════════════════════╗
  ║  VISION RESULT AGGREGATOR                    ║
  ║  (ScreenAgent pipeline pattern)              ║
  ║  {                                           ║
  ║    ocrText: string,                          ║
  ║    description: string,                      ║
  ║    elements: UIElement[],                    ║
  ║    screenState: { activeWindow, resolution } ║
  ║    confidence: number,                       ║
  ║    provider: string,                         ║
  ║    latencyMs: number                         ║
  ║  }                                           ║
  ╚══════════════════════╦═══════════════════════╝
                         ║
                         ▼
  ╔══════════════════════════════════════════════╗
  ║  COGNITIVE LOOP (UI-TARS System-2 pattern)  ║
  ║  Perceive → Decompose → Act → Reflect        ║
  ║  • Jika reflect gagal 3x: escalate to user   ║
  ║  • Screenshot timing: +300ms setelah aksi    ║
  ╚══════════════════════╦═══════════════════════╝
                         ║
                         ▼
  ╔══════════════════════════════════════════════╗
  ║  VISUAL MEMORY (MemGPT pattern)              ║
  ║  category: "visual_context"                  ║
  ║  ttlDays: 7                                  ║
  ║  embedding: dari description text            ║
  ╚══════════════════════════════════════════════╝
```

### 2.1 Multi-Provider Orchestrator — Urutan Prioritas

```
Provider Chain (OSWorld evaluation strategy):
  1. Gemini 2.0 Flash     → Terbaik untuk value, cepat
  2. GPT-4o               → Fallback, ScreenSpot evaluated
  3. Anthropic Claude     → Fallback ke-2
  4. Qwen2.5-VL-7B (local)→ Offline fallback, gratis
```

Ini bukan pilihan random. Ini berdasarkan benchmark OSWorld dan ScreenSpot Pro yang udah gua pelajari dari paper 1–4. Qwen2.5-VL-7B bisa jalan lokal — artinya EDITH bisa vision bahkan tanpa internet.

### 2.2 UI Grounding Strategy — Tiga Lapis

Paper OmniParser + GUI-Actor ngajarin kita bahwa accuracy grounding bergantung pada layering:

```
Lapis 1: Accessibility API (< 50ms, highest accuracy)
  → Windows UI Automation / macOS Accessibility
  → Return: { bounds, controlType, name, isEnabled }
  → Gunakan ini kalau tersedia

Lapis 2: OmniParser approach (< 800ms, medium accuracy)
  → YOLO detect regions → Florence-2 caption → SoM overlay
  → LLM pilih element berdasarkan ID, bukan koordinat
  → Gunakan sebagai fallback dari Lapis 1

Lapis 3: Pure LLM grounding (1-3s, lower accuracy)
  → Kirim screenshot langsung ke multimodal LLM
  → LLM output koordinat XY + confidence
  → Gunakan multi-candidate + verifier (GUI-Actor pattern)
  → Fallback terakhir
```

### 2.3 Cognitive Loop Detail

Ini yang Tony maksud waktu bilang "JARVIS bisa mikir". Bukan cuma execute:

```
TASK: "Buka file config.json di VS Code"

1. PERCEIVE
   → captureScreen()
   → describeImage() → "VS Code terbuka, ada file tree di kiri"
   → extractElements() → [taskbar, editor, file tree, ...]

2. DECOMPOSE (UI-TARS System-2)
   → subtask[0]: "Locate file tree panel"
   → subtask[1]: "Navigate to config.json"
   → subtask[2]: "Click to open"
   → milestone: "config.json tab aktif di editor"

3. ACT
   → findElement("file tree") → coordinates
   → click(coordinates)
   → wait(300ms)  ← penting! tunggu animasi

4. REFLECT (ScreenAgent pattern)
   → captureScreen()
   → isGoalMet("file tree focused") → true/false
   → Jika false: retry atau revise plan
   → Jika 3x gagal: "Sir, saya butuh bantuan dengan ini"
```

---

## 3. Implementasi — Yang Harus Dibangun

### 3.1 `describeImage()` — Real Implementation

**File:** `EDITH-ts/src/os-agent/vision-cortex.ts`
**Paper basis:** ScreenAgent (visual understanding) + OmniParser (structured output)

```typescript
async describeImage(
  imageBuffer: Buffer,
  question?: string,
  options?: { structured?: boolean; maxTokens?: number }
): Promise<DescribeResult> {
  // GPT-4V Card: validasi dulu sebelum kirim
  const sanitized = await this.sanitizeImage(imageBuffer)
  
  const prompt = options?.structured
    ? `Analyze this UI screenshot. Return JSON: { description, activeWindow, primaryAction, elements[] }`
    : (question ?? "Describe what you see in this screenshot in detail.")

  // OSWorld: provider chain dengan fallback
  const result = await getOrchestrator().generate("multimodal", {
    prompt,
    image: { data: sanitized.base64, mimeType: sanitized.mimeType },
    maxTokens: options?.maxTokens ?? 1024,
  })

  // MemGPT: store ke visual memory
  await this.storeVisualContext({
    description: result.text,
    timestamp: Date.now(),
    activeWindow: result.metadata?.activeWindow ?? "unknown",
  })

  return { text: result.text, provider: result.provider, latencyMs: result.latencyMs }
}
```

### 3.2 `findElement()` — Three-Layer Grounding

**File:** `EDITH-ts/src/os-agent/vision-cortex.ts`
**Paper basis:** OmniParser (lapis 2), GUI-Actor (multi-candidate + verifier), SoM (ID-based)

```typescript
async findElement(
  screenshot: Buffer,
  query: string,
  options?: { preferLayer?: 1 | 2 | 3 }
): Promise<ElementResult | null> {
  
  // Lapis 1: Accessibility API (< 50ms)
  if (options?.preferLayer !== 2 && options?.preferLayer !== 3) {
    const axResult = await this.findViaAccessibility(query)
    if (axResult?.confidence > 0.8) return axResult
  }

  // Lapis 2: SoM + LLM (GUI-Actor pattern)
  const elements = await this.detectElements(screenshot)   // YOLO-style detection
  const annotated = await this.overlayMarkers(screenshot, elements)  // SoM overlay
  
  const llmChoice = await getOrchestrator().generate("multimodal", {
    prompt: `These UI elements are numbered. Which number corresponds to: "${query}"? Reply with just the number.`,
    image: { data: annotated.base64, mimeType: "image/png" },
    maxTokens: 10,
  })
  
  const chosenId = parseInt(llmChoice.text.trim())
  if (!isNaN(chosenId) && elements[chosenId]) {
    const candidate = elements[chosenId]
    
    // GUI-Actor: verify confidence sebelum return
    if (candidate.confidence > 0.7) return candidate
  }

  // Lapis 3: Pure LLM coordinates (last resort)
  return await this.findViaLLMCoordinates(screenshot, query)
}
```

### 3.3 `cognitiveLoop()` — Plan → Act → Reflect

**File:** `EDITH-ts/src/os-agent/vision-cortex.ts`
**Paper basis:** UI-TARS (System-2 reasoning) + ScreenAgent (reflect loop)

```typescript
async executeCognitiveLoop(
  task: string,
  maxRetries: number = 3
): Promise<CognitiveResult> {
  
  // 1. PERCEIVE
  const screen = await this.captureScreen()
  const context = await this.describeImage(screen, undefined, { structured: true })
  
  // 2. DECOMPOSE (UI-TARS System-2)
  const plan = await this.decomposeTask(task, context)
  
  for (const subtask of plan.steps) {
    let attempts = 0
    let success = false
    
    while (!success && attempts < maxRetries) {
      // 3. ACT
      const element = await this.findElement(screen, subtask.targetElement)
      if (!element) {
        attempts++
        continue
      }
      await this.executeAction(subtask.action, element)
      
      // ScreenAgent: tunggu animasi selesai
      await sleep(300)
      
      // 4. REFLECT
      const newScreen = await this.captureScreen()
      const reflected = await this.describeImage(newScreen, `Did "${subtask.goal}" succeed?`)
      
      success = this.evaluateReflection(reflected.text, subtask.goal)
      attempts++
    }
    
    if (!success) {
      // UI-TARS: escalate setelah retry habis
      return { success: false, reason: `Subtask failed: ${subtask.goal}`, needsHuman: true }
    }
  }
  
  return { success: true, completedSteps: plan.steps.length }
}
```

### 3.4 Orchestrator Multimodal Extension

**File:** `src/engines/adapters/gemini.ts`, `openai.ts`, `anthropic.ts`

Setiap adapter perlu support image payload. Format beda di tiap provider:

```typescript
// Gemini (default — OmniParser V2 recommended)
contents: [{ parts: [
  { text: prompt },
  { inlineData: { mimeType, data: base64 } }
]}]

// OpenAI GPT-4o (ScreenSpot evaluated)
messages: [{ role: "user", content: [
  { type: "text", text: prompt },
  { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
]}]

// Anthropic Claude (fallback)
content: [
  { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
  { type: "text", text: prompt }
]
```

---

## 4. Testing Strategy

Kalau JARVIS bisa ditest per subsistem sebelum Tony naro di suit, begitu juga ini.

### Unit Tests (10 tests, ScreenAgent pipeline separation)

| # | Test | Layer | Paper |
|---|------|-------|-------|
| 1 | `sanitizeImage()` nolak gambar >20MB | Sanitizer | GPT-4V Card |
| 2 | `sanitizeImage()` resize otomatis >2048px | Sanitizer | GPT-4V Card |
| 3 | `describeImage()` kirim payload multimodal yang benar ke orchestrator | describeImage | ScreenAgent |
| 4 | `describeImage()` handle provider failure dengan graceful fallback | describeImage | OSWorld |
| 5 | `findElement()` Lapis 1: accessibility API return match dengan confidence tinggi | findElement | OmniParser |
| 6 | `findElement()` Lapis 2: SoM overlay + LLM pilih element ID dengan benar | findElement | SoM + OmniParser |
| 7 | `findElement()` Lapis 3 dipakai kalau Lapis 1 dan 2 gagal | findElement | GUI-Actor |
| 8 | `storeVisualContext()` buat memory node dengan TTL 7 hari | Visual Memory | MemGPT |
| 9 | Gateway `vision_analyze` route ke handler yang benar (ocr/describe/find) | Gateway | — |
| 10 | Rate limiter block panggilan ke-2 dalam 10 detik | Cost Guard | OSWorld |

### Integration Tests (3 tests)

| # | Test | Kondisi | Paper |
|---|------|---------|-------|
| 1 | Screenshot → describeImage → deskripsi meaningful tentang UI aktif | Desktop end-to-end | ScreenAgent full loop |
| 2 | `cognitiveLoop("buka notepad")` → Notepad terbuka → reflect sukses | Cognitive loop | UI-TARS System-2 |
| 3 | Visual store → retrieve context melalui conversational query | Memory | MemGPT |

---

## 5. Risiko & Mitigasi

Sama kayak Tony selalu punya plan B (dan C):

| Risiko | Kenapa Bisa Terjadi | Mitigasi |
|--------|---------------------|----------|
| Multimodal API cost explosion | Vision call mahal, bisa terpanggil berulang | Rate limit: max 1 call/10s + cost logging per call |
| Grounding akurasi rendah di resolusi tinggi | UI kecil, icon mepet | GUI-Actor multi-candidate + verifier; SoM bounding box |
| Reflect loop infinite | Task memang impossible | Max 3 retry per subtask; escalate ke user |
| Gemini/OpenAI down semua | API outage | Qwen2.5-VL-7B sebagai local fallback offline |
| Screenshot timing race condition | Animasi belum selesai pas capture | 300ms delay post-action (ScreenAgent recommendation) |
| Mobile image upload lambat di 3G | File besar | Compress ke JPEG 85%, resize ke max 1024px di sisi mobile |

---

## 6. References

| # | Paper | ID | Kenapa Lebih Baik dari Versi Lama |
|---|-------|----|-----------------------------------|
| 1 | OmniParser V2 | MS Research Feb 2025 | **+60% speed** dari V1, dataset lebih besar, Florence-2 caption lebih akurat |
| 2 | UI-TARS | arXiv:2501.12326 | Paper baru Jan 2025, **SOTA di 10+ benchmark**, melampaui Claude Computer Use |
| 3 | Qwen2.5-VL | arXiv:2502.13923 | Paper baru Feb 2025, bisa jalan **lokal**, absolute coordinate grounding |
| 4 | GUI-Actor | arXiv:2506.03143 | Paper baru Jun 2025, 7B model **mengalahkan 72B** UI-TARS di ScreenSpot-Pro |
| 5 | ScreenAgent | IJCAI 2024 | Plan→Act→Reflect pipeline, dipertahankan karena battle-tested |
| 6 | OSWorld | arXiv:2404.07972 | Gold standard benchmark, dipertahankan untuk evaluation strategy |
| 7 | Set-of-Mark (SoM) | arXiv:2310.11441 | Teknik prompting universal, dipakai semua paper modern |
| 8 | MemGPT | arXiv:2310.08560 | Dipertahankan, visual memory architecture masih relevan |
| 9 | GPT-4V System Card | OpenAI 2023 | Dipertahankan, image safety bounds masih gold standard |

---

## 7. File Changes Summary

| File | Action | Estimasi Lines | Priority |
|------|--------|----------------|----------|
| `src/os-agent/vision-cortex.ts` | Rewrite total: sanitizeImage, describeImage, findElement (3-layer), cognitiveLoop, storeVisualContext | +350 | WEEK 1 |
| `src/engines/orchestrator.ts` | Tambah multimodal payload routing per provider | +80 | WEEK 1 |
| `src/engines/adapters/gemini.ts` | Image payload support | +40 | WEEK 1 |
| `src/engines/adapters/openai.ts` | Image payload support | +40 | WEEK 1 |
| `src/engines/adapters/anthropic.ts` | Image payload support | +40 | WEEK 1 |
| `src/gateway/server.ts` | WebSocket `vision_analyze` handler | +50 | WEEK 2 |
| `apps/mobile/components/VisionButton.tsx` | NEW: Camera + compress + analyze UI | +200 | WEEK 2 |
| `src/os-agent/__tests__/vision-cortex.test.ts` | 10 unit + 3 integration tests | +150 | WEEK 2 |
| **Total** | | **~950 lines** | |

---

## 8. Definition of Done

Phase 3 selesai ketika:

- [ ] `describeImage()` return meaningful description dari screenshot nyata (bukan placeholder)
- [ ] `findElement("tombol X")` bisa locate dan klik elemen di UI aktif
- [ ] `cognitiveLoop()` sukses selesaikan task 3-step tanpa human intervention
- [ ] Semua 13 tests pass (10 unit + 3 integration)
- [ ] Mobile bisa kirim gambar, terima deskripsi dari server
- [ ] Vision calls ter-rate-limit dan ter-log dengan cost estimate
- [ ] Provider fallback chain tested: matiin Gemini → OpenAI ambil alih → matiin OpenAI → Claude ambil alih

> *"Ini bukan selesai kalau dia jalan. Ini selesai kalau gua bisa matiin satu provider dan yang lain langsung ambil alih tanpa error. Itu baru sistem yang layak dipercaya."*
> — Tony Stark, kalau dia yang review PR ini
