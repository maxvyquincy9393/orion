# Phase A — Free Stack Setup (Zero Cost)

## Tujuan
Ganti semua paid API ke free tier supaya development bisa jalan tanpa keluar biaya.
Target: semua fitur Orion berfungsi dengan $0/bulan.

## Problem Saat Ini
- `memory/store.ts` pakai `openAIEmbed()` → berbayar
- Orchestrator default ke OpenAI/Anthropic → berbayar
- Belum ada fallback ke local inference

## Stack Baru (Zero Cost)

| Role | Provider | Model | Limit |
|---|---|---|---|
| Reasoning | Google Gemini via AI Studio | gemini-2.5-flash | 500 req/day gratis |
| Fast Tasks | Groq | llama-3.3-70b-versatile | 14,400 req/day |
| Embeddings | Ollama lokal | nomic-embed-text | Unlimited |
| Local Fallback | Ollama lokal | qwen2.5:7b atau deepseek-r1:8b | Unlimited |
| Fallback API | OpenRouter | Llama/Mistral gratis | 50 req/day |

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS, AI companion system berbasis TypeScript/Node 22.
Repo: orion-ts/src/

### TASK: Phase A — Free Stack Migration

Tujuan: Ganti semua berbayar API ke gratis. Jangan ubah interface publik, hanya implementasi internal.

#### Step 1: Fix Embeddings di memory/store.ts
File target: `src/memory/store.ts`

Sekarang ada fungsi `openAIEmbed(text: string)` yang hit OpenAI API.
Ganti dengan fungsi baru `ollamaEmbed(text: string)` yang hit Ollama local:
- URL: `http://localhost:11434/api/embeddings`
- Model: `nomic-embed-text` (dimensi output: 768)
- PENTING: VECTOR_DIMENSION di file ini sekarang 1536, ubah ke 768
- Kalau Ollama tidak tersedia, fallback ke `hashToVector()` yang sudah ada
- Jangan hapus `openAIEmbed`, hanya jangan panggil dia. Biarkan sebagai dead code untuk referensi.

Contoh request ke Ollama:
```
POST http://localhost:11434/api/embeddings
{
  "model": "nomic-embed-text",
  "prompt": "text to embed"
}
Response: { "embedding": [0.1, 0.2, ...] }
```

CATATAN: LanceDB table sudah pakai dimensi 1536. Kalau dimensi berubah ke 768,
table lama akan error saat query. Tambahkan migrasi: kalau table ada dengan dimensi
lama (1536), hapus dan recreate. Deteksi dengan cek ukuran vector pada row pertama.

#### Step 2: Update PRIORITY_MAP di engines/orchestrator.ts
File target: `src/engines/orchestrator.ts`

Ubah PRIORITY_MAP:
```typescript
const PRIORITY_MAP: Record<TaskType, string[]> = {
  reasoning: ["gemini", "groq", "anthropic", "openai", "ollama"],
  code:      ["groq", "gemini", "anthropic", "openai", "ollama"],
  fast:      ["groq", "gemini", "ollama", "openai", "anthropic"],
  multimodal:["gemini", "openai", "anthropic"],
  local:     ["ollama"],
}
```
Prioritas: groq dulu untuk fast (tercepat, free), gemini untuk reasoning (context 1M gratis).

#### Step 3: Validasi .env.example
File target: `.env.example`

Tambahkan komentar per key untuk menjelaskan mana yang free dan mana yang paid:
- Tandai OPENAI_API_KEY dengan komentar `# optional, berbayar`
- Tandai ANTHROPIC_API_KEY dengan komentar `# optional, berbayar`
- Tandai GEMINI_API_KEY dengan komentar `# gratis via AI Studio: aistudio.google.com`
- Tandai GROQ_API_KEY dengan komentar `# gratis: console.groq.com`
- Tambahkan OLLAMA_BASE_URL=http://localhost:11434 dengan komentar `# gratis, local`

#### Step 4: Buat docs/free-stack-setup.md
Tulis guide singkat (maksimal 60 baris) tentang cara setup zero-cost:
1. Install Ollama: `curl -fsSL https://ollama.com/install.sh | sh`
2. Pull model: `ollama pull nomic-embed-text && ollama pull qwen2.5:7b`
3. Daftar Groq: console.groq.com → ambil API key gratis
4. Daftar Google AI Studio: aistudio.google.com → ambil API key gratis
5. Update .env: set GROQ_API_KEY dan GEMINI_API_KEY
6. Test: `pnpm dev --mode text`

### Constraints
- Jangan break TypeScript types yang sudah ada
- Jangan ubah public interface MemoryStore
- Run `tsc --noEmit` setelah selesai, harus zero errors
- Jangan tambah package baru ke package.json
```

## Cara Pakai Prompt Ini
1. Buka GitHub Copilot Chat atau OpenCode
2. Paste prompt di atas
3. Attach file: `src/memory/store.ts`, `src/engines/orchestrator.ts`, `.env.example`
4. Jalankan step by step

## Test Setelah Selesai
```bash
ollama pull nomic-embed-text
pnpm dev --mode text
# Ketik: "halo orion"
# Harusnya response tanpa error embedding
```
