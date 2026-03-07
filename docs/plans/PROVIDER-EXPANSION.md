# EDITH Provider Expansion — All Supported LLM Providers

> *"JARVIS, expand the available systems."*
> *"Currently running on 6 engines, sir. I've identified 9 additional providers we can wire in. User sets the key in edith.json — done."*

**Status:** Plan dokumen — belum diimplementasi
**Depends on:** engines/ architecture (existing), edith-config.ts (existing), config.ts (existing)
**Goal:** User cukup isi API key di `edith.json` → provider langsung aktif. Zero env file setup.

---

## Cara Kerjanya Sekarang

```
edith.json
  └── "env": {
        "GROQ_API_KEY": "gsk_...",
        "GEMINI_API_KEY": "AIza...",
        "DEEPSEEK_API_KEY": "sk-..."   ← tinggal tambah ini
      }
          │
          ▼ (injectEdithJsonEnv() di startup)
    process.env.GROQ_API_KEY = "gsk_..."
    process.env.DEEPSEEK_API_KEY = "sk-..."
          │
          ▼ (config.ts parse process.env)
    config.DEEPSEEK_API_KEY = "sk-..."
          │
          ▼ (DeepSeekEngine.isAvailable())
    config.DEEPSEEK_API_KEY.trim().length > 0 → true → engine registered
```

User tidak perlu sentuh `.env`. Tidak perlu restart manual. Cukup isi `edith.json`.

---

## Provider Matrix — Semua yang Bisa Ditambah

### Yang Sudah Ada (6 providers)

| Engine | Provider | Default Model | Vision | Key di edith.json |
|--------|----------|---------------|--------|-------------------|
| `groq` | Groq | llama-3.3-70b-versatile | ❌ | `GROQ_API_KEY` |
| `openai` | OpenAI | gpt-4o | ✅ | `OPENAI_API_KEY` |
| `anthropic` | Anthropic | claude-sonnet-4-20250514 | ✅ | `ANTHROPIC_API_KEY` |
| `gemini` | Google | gemini-2.0-flash | ✅ | `GEMINI_API_KEY` |
| `openrouter` | OpenRouter | anthropic/claude-sonnet-4 | ✅* | `OPENROUTER_API_KEY` |
| `ollama` | Ollama (local) | auto-detect | ✅* | Tidak perlu key |

---

### Yang Perlu Ditambah (9 providers baru)

---

#### 1. DeepSeek
**Kenapa penting:** DeepSeek's 90% cheaper pricing puts real pressure on proprietary providers. DeepSeek R1 offers reasoning di $0.55/1M tokens — paling murah untuk reasoning tasks. Model `deepseek-chat` (V3) dan `deepseek-reasoner` (R1) tersedia via API yang kompatibel OpenAI.

| Property | Value |
|----------|-------|
| Base URL | `https://api.deepseek.com/v1` |
| API Format | OpenAI-compatible |
| Default Model | `deepseek-chat` (V3) |
| Reasoning Model | `deepseek-reasoner` (R1) |
| Vision | ❌ (V3), ✅ (VL model) |
| Harga Input | $0.27/1M tokens |
| Context | 64K tokens |
| Key | `DEEPSEEK_API_KEY` |
| Implementasi | Extend `OpenAI` SDK, ganti `baseURL` |

```typescript
// engines/deepseek.ts — pattern sama dengan openrouter.ts
export class DeepSeekEngine implements Engine {
  readonly name = "deepseek"
  readonly provider = "deepseek"
  readonly defaultModel = "deepseek-chat"

  isAvailable(): boolean {
    return config.DEEPSEEK_API_KEY.trim().length > 0
  }

  async generate(options: GenerateOptions): Promise<string> {
    const client = new OpenAI({
      apiKey: config.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/v1",
    })
    // ... same as openrouter pattern
  }
}
```

---

#### 2. Mistral AI
**Kenapa penting:** Open-weight models, bisa self-host. Mistral Medium 3 at $0.40/1M input with a free self-hosting option via Apache 2.0 license. Mistral juga punya Codestral — model khusus coding yang lebih murah dari GPT-4o.

| Property | Value |
|----------|-------|
| Base URL | `https://api.mistral.ai/v1` |
| API Format | OpenAI-compatible |
| Default Model | `mistral-small-latest` |
| Best Model | `mistral-large-latest` |
| Coding Model | `codestral-latest` |
| Vision | ✅ (pixtral models) |
| Harga Input | $0.40/1M (Medium), gratis (self-host) |
| Context | 128K tokens |
| Key | `MISTRAL_API_KEY` |
| Implementasi | OpenAI SDK + Mistral SDK |

---

#### 3. xAI (Grok)
**Kenapa penting:** xAI's Grok 4.1 Fast gives a 2 million token context window at $0.20 per million input tokens. Context window terbesar di market untuk harga yang sangat murah — cocok untuk tasks yang butuh sangat banyak context.

| Property | Value |
|----------|-------|
| Base URL | `https://api.x.ai/v1` |
| API Format | OpenAI-compatible |
| Default Model | `grok-3-mini` |
| Best Model | `grok-3` |
| Vision | ✅ (grok-2-vision) |
| Harga Input | $0.20/1M (Grok 4.1 Fast) |
| Context | 2M tokens (Grok 4.1) |
| Key | `XAI_API_KEY` |
| Implementasi | OpenAI SDK, ganti baseURL |

---

#### 4. Together AI
**Kenapa penting:** Together AI provides serverless execution for 200+ open-source and partner LLMs through a unified API. Satu key untuk akses Llama, Mixtral, Qwen, DeepSeek, dan banyak lagi. Harga sangat kompetitif.

| Property | Value |
|----------|-------|
| Base URL | `https://api.together.xyz/v1` |
| API Format | OpenAI-compatible |
| Default Model | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Notable Models | Llama 4 Maverick, DeepSeek-R1, Qwen2.5-7B |
| Vision | ✅ (via Llama Vision) |
| Harga Input | $0.18/1M (Llama 4 Scout) |
| Context | 1M tokens (Llama 4 Maverick) |
| Key | `TOGETHER_API_KEY` |
| Implementasi | OpenAI SDK, ganti baseURL |

---

#### 5. Fireworks AI
**Kenapa penting:** FireAttention delivers up to 12x faster long-context inference and 4x improvements over vLLM using FP16/FP8 optimization on H100 hardware. Paling cepat untuk inference, cocok untuk `fast` task type.

| Property | Value |
|----------|-------|
| Base URL | `https://api.fireworks.ai/inference/v1` |
| API Format | OpenAI-compatible |
| Default Model | `accounts/fireworks/models/llama-v3p3-70b-instruct` |
| Vision | ✅ (Llama Vision) |
| Key | `FIREWORKS_API_KEY` |
| Implementasi | OpenAI SDK, ganti baseURL |

---

#### 6. Cohere
**Kenapa penting:** Cohere spesialis RAG — Command R+ didesain untuk retrieval-augmented generation, sangat relevan untuk EDITH memory system.

| Property | Value |
|----------|-------|
| SDK | `cohere-ai` (npm) — bukan OpenAI compatible |
| Default Model | `command-r-plus` |
| RAG Model | `command-r` |
| Vision | ❌ |
| Harga Input | $2.50/1M (Command R+), gratis prototyping |
| Context | 256K tokens |
| Key | `COHERE_API_KEY` |
| Implementasi | Cohere SDK (perlu install `cohere-ai`) |

---

#### 7. Perplexity
**Kenapa penting:** Model Perplexity punya **real-time web search built-in** — setiap response bisa include informasi terkini dari internet tanpa skill/tool tambahan. Cocok untuk `fast` tasks yang butuh current info.

| Property | Value |
|----------|-------|
| Base URL | `https://api.perplexity.ai` |
| API Format | OpenAI-compatible |
| Default Model | `sonar` |
| Search Model | `sonar-pro` (dengan citation) |
| Vision | ❌ |
| Harga | $5/request untuk online models |
| Key | `PERPLEXITY_API_KEY` |
| Implementasi | OpenAI SDK, ganti baseURL |

---

#### 8. Hugging Face Inference API
**Kenapa penting:** Hugging Face provides access to 60,000+ models for self-hosted deployment. User yang punya PC spek dewa bisa run model apapun dari HuggingFace — dari Llama 3.3 sampai model Indonesia seperti IndoGPT.

| Property | Value |
|----------|-------|
| Base URL | `https://api-inference.huggingface.co/models/` |
| API Format | Custom (per model endpoint) |
| Default Model | User-specified |
| Notable | 60,000+ models, termasuk model Bahasa Indonesia |
| Vision | ✅ (model-dependent) |
| Harga | Gratis untuk banyak model, pay untuk serverless |
| Key | `HUGGINGFACE_API_KEY` |
| Implementasi | Custom fetch (format berbeda per model) |

---

#### 9. LM Studio (Local)
**Kenapa penting:** LM Studio adalah alternatif Ollama yang lebih user-friendly — GUI-based, bisa download model dari HuggingFace langsung. API-nya OpenAI-compatible. User PC dewa bisa run model 70B+ lokal.

| Property | Value |
|----------|-------|
| Base URL | `http://localhost:1234/v1` (default) |
| API Format | OpenAI-compatible |
| Default Model | User-specified (dari GUI) |
| Vision | ✅ (model-dependent) |
| Harga | Gratis (local compute) |
| Key | Tidak perlu |
| Implementasi | Extend OllamaEngine pattern, pakai OpenAI SDK |

---

## Arsitektur Perubahan yang Diperlukan

### 1. `config.ts` — Tambah env vars baru

```typescript
// Tambahkan ke ConfigSchema:
DEEPSEEK_API_KEY: z.string().default(""),
MISTRAL_API_KEY: z.string().default(""),
XAI_API_KEY: z.string().default(""),
TOGETHER_API_KEY: z.string().default(""),
FIREWORKS_API_KEY: z.string().default(""),
COHERE_API_KEY: z.string().default(""),
PERPLEXITY_API_KEY: z.string().default(""),
HUGGINGFACE_API_KEY: z.string().default(""),
LM_STUDIO_BASE_URL: z.string().default("http://localhost:1234"),
```

### 2. `edith-config.ts` — Tambah LLM providers section

```typescript
// Tambah ke EdithConfigSchema:
llm: z.object({
  providers: z.object({
    deepseek:    z.object({ apiKey: z.string().optional() }).default({}),
    mistral:     z.object({ apiKey: z.string().optional() }).default({}),
    xai:         z.object({ apiKey: z.string().optional() }).default({}),
    together:    z.object({ apiKey: z.string().optional() }).default({}),
    fireworks:   z.object({ apiKey: z.string().optional() }).default({}),
    cohere:      z.object({ apiKey: z.string().optional() }).default({}),
    perplexity:  z.object({ apiKey: z.string().optional() }).default({}),
    huggingface: z.object({ apiKey: z.string().optional() }).default({}),
    lmstudio:    z.object({ baseUrl: z.string().default("http://localhost:1234") }).default({}),
  }).default({})
}).default({ providers: {} })
```

### 3. `injectEdithJsonEnv()` — Map provider keys ke env vars

```typescript
// Tambah ke channelEnvMap pattern yang sudah ada:
const llmEnvMap: Record<string, string> = {
  "llm.providers.deepseek.apiKey":    "DEEPSEEK_API_KEY",
  "llm.providers.mistral.apiKey":     "MISTRAL_API_KEY",
  "llm.providers.xai.apiKey":         "XAI_API_KEY",
  "llm.providers.together.apiKey":    "TOGETHER_API_KEY",
  "llm.providers.fireworks.apiKey":   "FIREWORKS_API_KEY",
  "llm.providers.cohere.apiKey":      "COHERE_API_KEY",
  "llm.providers.perplexity.apiKey":  "PERPLEXITY_API_KEY",
  "llm.providers.huggingface.apiKey": "HUGGINGFACE_API_KEY",
  "llm.providers.lmstudio.baseUrl":   "LM_STUDIO_BASE_URL",
}
```

### 4. `orchestrator.ts` — Register engine baru + update PRIORITY_MAP

```typescript
import { deepSeekEngine } from "./deepseek.js"
import { mistralEngine } from "./mistral.js"
import { xaiEngine } from "./xai.js"
import { togetherEngine } from "./together.js"
import { fireworksEngine } from "./fireworks.js"
import { cohereEngine } from "./cohere.js"
import { perplexityEngine } from "./perplexity.js"
import { huggingFaceEngine } from "./huggingface.js"
import { lmStudioEngine } from "./lmstudio.js"

const DEFAULT_ENGINE_CANDIDATES = [
  anthropicEngine,
  openAIEngine,
  geminiEngine,
  groqEngine,
  openRouterEngine,
  ollamaEngine,
  // NEW:
  deepSeekEngine,
  mistralEngine,
  xaiEngine,
  togetherEngine,
  fireworksEngine,
  cohereEngine,
  perplexityEngine,
  huggingFaceEngine,
  lmStudioEngine,
]

const PRIORITY_MAP: Record<TaskType, readonly string[]> = {
  reasoning: ["gemini", "groq", "anthropic", "openai", "deepseek", "xai", "openrouter", "ollama", "lmstudio"],
  code:       ["groq", "deepseek", "mistral", "gemini", "anthropic", "openai", "together", "openrouter", "ollama"],
  fast:       ["groq", "fireworks", "gemini", "perplexity", "together", "openrouter", "ollama", "lmstudio"],
  multimodal: ["gemini", "openai", "anthropic", "xai", "mistral", "openrouter"],
  local:      ["ollama", "lmstudio"],
  // NEW task types:
  search:     ["perplexity", "groq", "gemini"],   // for web-aware queries
  budget:     ["deepseek", "mistral", "together", "fireworks", "groq", "ollama"],
}

// Update cost estimates:
const ENGINE_COST_ESTIMATE_PER_1K: Record<string, number> = {
  groq:       0.10,
  ollama:     0.02,
  lmstudio:   0.02,
  deepseek:   0.03,
  together:   0.05,
  fireworks:  0.06,
  mistral:    0.08,
  gemini:     0.18,
  xai:        0.20,
  openrouter: 0.25,
  perplexity: 0.30,
  openai:     0.40,
  cohere:     0.45,
  anthropic:  0.55,
  huggingface: 0.10,
}
```

---

## edith.json — Contoh Konfigurasi User

### User Biasa (1GB RAM, pakai API):
```json
{
  "env": {
    "GROQ_API_KEY": "gsk_xxx",
    "DEEPSEEK_API_KEY": "sk-xxx"
  }
}
```
→ EDITH otomatis pakai Groq untuk speed, DeepSeek untuk reasoning.

### User Mid-Range (PC decent, punya beberapa key):
```json
{
  "env": {
    "GROQ_API_KEY": "gsk_xxx",
    "GEMINI_API_KEY": "AIza_xxx",
    "DEEPSEEK_API_KEY": "sk-xxx",
    "MISTRAL_API_KEY": "xxx",
    "OLLAMA_BASE_URL": "http://localhost:11434"
  }
}
```
→ Orchestrator pilih engine terbaik per task type.

### User PC Dewa (32GB RAM, GPU bagus):
```json
{
  "env": {
    "GROQ_API_KEY": "gsk_xxx",
    "GEMINI_API_KEY": "AIza_xxx",
    "OPENAI_API_KEY": "sk-xxx",
    "ANTHROPIC_API_KEY": "sk-ant-xxx",
    "DEEPSEEK_API_KEY": "sk-xxx",
    "XAI_API_KEY": "xai-xxx",
    "TOGETHER_API_KEY": "xxx",
    "FIREWORKS_API_KEY": "fw-xxx",
    "MISTRAL_API_KEY": "xxx",
    "PERPLEXITY_API_KEY": "pplx-xxx",
    "HUGGINGFACE_API_KEY": "hf_xxx",
    "OLLAMA_BASE_URL": "http://localhost:11434",
    "LM_STUDIO_BASE_URL": "http://localhost:1234"
  }
}
```
→ EDITH punya 13+ engine. Orchestrator pilih optimal per task, dengan cost routing.

---

## Implementation Order

Semua engine baru kecuali Cohere dan HuggingFace adalah **OpenAI-compatible** — tinggal copy pattern dari `openrouter.ts`, ganti `baseURL` dan `apiKey`. Estimasi per engine: **~30-40 baris**.

```
Priority 1 (OpenAI-compatible, 30 menit/engine):
  ✅ deepseek.ts    — paling populer, paling murah reasoning
  ✅ mistral.ts     — open-weight, coding model Codestral
  ✅ xai.ts         — context window 2M token
  ✅ together.ts    — 200+ models, 1 key
  ✅ fireworks.ts   — paling cepat inference
  ✅ lmstudio.ts    — local alternative to Ollama

Priority 2 (perlu custom SDK atau format):
  ⚠️ cohere.ts      — butuh `cohere-ai` SDK, format berbeda
  ⚠️ perplexity.ts  — OpenAI-compatible tapi ada quirks (search fee)
  ⚠️ huggingface.ts — format per-model, butuh wrapper generik

Total estimasi: ~6-8 jam implementasi + tests
New files: 9 engine files + update config.ts + edith-config.ts + orchestrator.ts
```

---

## File Changes Summary

| File | Action | Est. Lines |
|------|--------|-----------|
| `src/engines/deepseek.ts` | NEW | ~40 |
| `src/engines/mistral.ts` | NEW | ~50 |
| `src/engines/xai.ts` | NEW | ~40 |
| `src/engines/together.ts` | NEW | ~40 |
| `src/engines/fireworks.ts` | NEW | ~40 |
| `src/engines/lmstudio.ts` | NEW | ~50 |
| `src/engines/cohere.ts` | NEW | ~70 |
| `src/engines/perplexity.ts` | NEW | ~45 |
| `src/engines/huggingface.ts` | NEW | ~80 |
| `src/engines/orchestrator.ts` | Update: register new engines, PRIORITY_MAP, cost map | ~60 |
| `src/config.ts` | Add 9 new env vars | ~15 |
| `src/config/edith-config.ts` | Add `llm.providers` schema + inject mapping | ~50 |
| `src/engines/__tests__/providers.test.ts` | NEW: availability tests per engine | ~80 |
| **Total** | | **~660 lines** |

---

## Notes untuk Implementasi

1. **Semua engine ikuti pattern yang sama**: `isAvailable()` check key → `generate()` via SDK → throw on error
2. **Cohere** adalah satu-satunya yang butuh npm package baru: `pnpm add cohere-ai`
3. **HuggingFace** perlu fallback yang robust karena format response beda per model
4. **LM Studio** essentially adalah Ollama pattern tapi pakai OpenAI SDK (kompatibel)
5. **Task type baru**: `search` (perplexity-first) dan `budget` (cheapest-first) ditambah ke `TaskType`
6. **Cost routing** sudah ada di orchestrator — tinggal tambah entries ke `ENGINE_COST_ESTIMATE_PER_1K`
