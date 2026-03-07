# EDITH — Getting Started Plan

Setup EDITH dilakukan dari **luar repo** — lewat Desktop App, Mobile App, atau Global CLI.  
Repo `EDITH-ts` adalah **engine** aja, bukan tempat setup.

---

## Arsitektur Setup (EDITH Pattern)

```
┌──────────────────┐     ┌───────────────┐     ┌──────────────┐
│  Desktop App     │     │  Mobile App   │     │  Global CLI  │
│  (Electron)      │     │  (React Native)│    │  (bin/edith)  │
│  IPC → edith.json │     │  REST → /api/ │     │  fs → edith.json│
└───────┬──────────┘     └───────┬───────┘     └──────┬───────┘
        │                        │                     │
        ▼                        ▼                     ▼
   ┌─────────────────────────────────────────────────────┐
   │              edith.json (single source of truth)     │
   │  env: { GROQ_API_KEY: "gsk_..." }                  │
   │  identity: { name: "EDITH" }                         │
   │  agents: { defaults: { model: { primary: "..." } }} │
   │  channels: { telegram: { botToken: "..." } }       │
   └──────────────────────┬──────────────────────────────┘
                          │
                          ▼
                ┌───────────────────┐
                │   EDITH Engine     │
                │   (EDITH-ts/)     │
                │   Gateway :18789  │
                └───────────────────┘
```

---

## Setup via Desktop App (Electron)

1. **Install & launch** desktop app (`apps/desktop/`)
2. Pertama kali launch → otomatis masuk **Onboarding Wizard**
3. Wizard 4 step:
   - Welcome → Choose Provider → Enter API Key → Done!
4. Klik **Test Connection** → validasi key via IPC ke Electron main process
5. Klik **Start Chatting** → wizard nulis `edith.json` → gateway auto-start → chat UI muncul

```bash
# Untuk development:
cd apps/desktop
pnpm install
pnpm dev
```

### Yang Terjadi di Balik Layar

- `preload.js` expose: `edith.saveConfig()`, `edith.loadConfig()`, `edith.testProvider()`
- `main.js` IPC handlers: `config:save`, `config:load`, `config:test-provider`
- Config ditulis ke `EDITH-ts/edith.json` — engine langsung baca dari situ
- Kalau `edith.json` sudah ada → skip wizard, langsung ke chat

---

## Setup via Mobile App (React Native / Expo)

1. Pastikan gateway sudah jalan (dari desktop app atau manual `pnpm dev -- --mode gateway`)
2. Buka mobile app → masuk **Setup** screen
3. Setup flow sama: Provider → API Key → Test → Save
4. Mobile kirim config via **REST API** ke gateway:
   - `POST /api/config/test-provider` — test API key
   - `PUT /api/config` — write full edith.json
   - `PATCH /api/config` — partial merge
   - `GET /api/config` — read config (API keys redacted)

```bash
# Untuk development:
cd apps/mobile
pnpm install
pnpm start
```

---

## Setup via Global CLI

```bash
# From anywhere on the system:
edith setup         # Interactive wizard
edith config set env.GROQ_API_KEY gsk_xxx
edith config show
edith start         # Start gateway
```

---

## Status Saat Ini

| Item | Status |
|------|--------|
| Rename EDITH → EDITH | ✅ Selesai (engine + apps) |
| TypeScript compile | ✅ 0 error |
| Test suite | ✅ 61 files, 453 tests passed |
| Desktop onboarding wizard | ✅ Full IPC — saves `edith.json` |
| Desktop provider test | ✅ Real API validation (Groq/Anthropic/OpenAI/Ollama) |
| Mobile setup screen | ✅ REST-based config via gateway |
| Gateway config REST API | ✅ GET/PUT/PATCH `/api/config` + test-provider |
| Database | ❌ Auto-create on first run (`prisma migrate dev`) |
| API Key LLM | ❌ User enters via app wizard |
| Channel config | ❌ Fase berikutnya |

---

## Yang Dibutuhkan (Minimum)

### 1. API Key LLM (Pilih Minimal 1)

| Provider | Gratis? | Cara Dapat | Env Var |
|----------|---------|-----------|---------|
| **Groq** | ✅ Free | https://console.groq.com → API Keys | `GROQ_API_KEY` |
| **Ollama** | ✅ Free (lokal) | https://ollama.ai → Install & run | Tidak perlu key |
| **OpenAI** | 💳 Paid | https://platform.openai.com/api-keys | `OPENAI_API_KEY` |
| **Anthropic** | 💳 Paid | https://console.anthropic.com | `ANTHROPIC_API_KEY` |

> **Rekomendasi:** Mulai dengan **Groq** (gratis, cepat, Llama 3.3 70B).

### 2. Channel (Opsional)

Setup channel belum di wizard — fase berikutnya.  
Untuk sekarang bisa manual tambah di `edith.json → channels`.

---

## Struktur Config: `edith.json`

Setelah wizard selesai, file `edith.json` berisi:

```json
{
  "env": {
    "GROQ_API_KEY": "gsk_xxxxxxxxxxxx"
  },
  "identity": {
    "name": "EDITH",
    "emoji": "✦",
    "theme": "dark minimal"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "groq/llama-3.3-70b-versatile",
        "fallbacks": []
      },
      "workspace": "./workspace"
    }
  }
}
```

> Semua secret ada di `edith.json` (EDITH-style single source of truth).  
> File `.env` hanya fallback untuk `DATABASE_URL`.

---

## Gateway REST Config API

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| `GET` | `/api/config` | Baca config (keys di-redact) |
| `PUT` | `/api/config` | Full replace edith.json |
| `PATCH` | `/api/config` | Partial merge ke edith.json |
| `POST` | `/api/config/test-provider` | Test provider API key |

### Test Provider Example:

```bash
curl -X POST http://localhost:18789/api/config/test-provider \
  -H "Content-Type: application/json" \
  -d '{"provider":"groq","credentials":{"GROQ_API_KEY":"gsk_xxx"}}'
```

### Save Config Example:

```bash
curl -X PUT http://localhost:18789/api/config \
  -H "Content-Type: application/json" \
  -d '{"env":{"GROQ_API_KEY":"gsk_xxx"},"agents":{"defaults":{"model":{"primary":"groq/llama-3.3-70b-versatile"}}}}'
```

---

## Checklist Sebelum Run

- [ ] Launch desktop app ATAU jalankan engine manual (`pnpm dev -- --mode gateway`)
- [ ] Complete onboarding wizard (provider + API key)
- [ ] Database auto-create on first run
- [ ] Chat!
