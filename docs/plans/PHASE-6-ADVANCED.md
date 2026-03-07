# Phase 6 — Advanced EDITH Features (Proactive + Automation + Security)

> "JARVIS doesn't wait for me to say something. He already knows."
> — Tony Stark, Iron Man 3

**Status:** In progress — fondasi daemon ✅ | triggers YAML ✅ | file watcher ❌ | notifications ❌ | macros ❌ | CaMeL ❌
**Runtime target:** laptop minimum **1 GB RAM**, HP minimum **6 GB RAM**
**Setup contract:** semua user-facing setup lewat onboarding, persist ke `edith.json`

---

## Cara Tony Stark Mikir Phase 6

Tony tidak mulai dari "fitur proaktif apa yang keren". Tony mulai dari satu pertanyaan:

`Kenapa EDITH masih diam kalau ada sesuatu yang harus dikatakan?`

Dari sana, tiga constraint yang mengunci semua keputusan Phase 6:

1. `EDITH harus bisa memberi tahu user tanpa harus ditanya terlebih dahulu.`
2. `Aksi otomatis tidak boleh lebih berbahaya dari yang user izinkan.`
3. `Setup automation harus bisa dilakukan dari UI, bukan dari edit YAML manual.`

Dari constraint itu, arsitektur Phase 6 jadi sederhana:

- gunakan **daemon yang sudah ada** sebagai backbone proactive triggers;
- gunakan **notification dispatcher** sebagai satu-satunya jalur output cross-platform;
- jadikan **macro engine** sebagai interpreter untuk multi-step automation;
- pasang **CaMeL security layer** di atas semua tool execution agar injeksi dari data eksternal tidak bisa memicu aksi.

---

## First Principles

Phase 6 bukan "notifikasi dan otomasi". Phase 6 adalah pipeline:

`event source -> trigger evaluator -> VoI gate -> dispatcher -> channel`

Dan untuk automation:

`trigger -> macro loader -> step executor -> tool call -> CaMeL gate -> result`

Kalau satu layer gagal, sistem harus turun kelas dengan anggun:

- desktop toast gagal -> tetap ada mobile push
- macro step gagal -> abort atau continue sesuai definisi, tidak crash
- CaMeL block tainted data -> tool call dibatalkan, user diberi tahu, bukan silent failure

Itu standar JARVIS: **graceful degradation + transparent failure**.

---

## Referensi Yang Jadi Pedoman

| # | Paper | ID | Kontribusi ke EDITH |
|---|-------|-----|---------------------|
| 1 | CaMeL: Defeating Prompt Injections by Design | arXiv:2503.18813 | Taint tracking + capability tokens: data dari luar tidak bisa trigger tool call |
| 2 | MemGPT: LLMs as Operating Systems | arXiv:2310.08560 | Proactive intelligence: interrupt-driven notifications, VoI gating, quiet hours |
| 3 | OSWorld: Benchmarking Multimodal Agents | arXiv:2404.07972 | File system awareness, system state monitoring, klasifikasi file importance |
| 4 | CodeAct: Executable Code Actions | arXiv:2402.01030 | Macro execution: code-as-action, template chaining, self-debugging on step failure |
| 5 | AgentDojo: Prompt Injection Benchmark | arXiv:2406.13352 | Evaluasi CaMeL: 67% tasks solved dengan provable security di benchmark injeksi |
| 6 | AIOS: LLM Agent Operating System | arXiv:2403.16971 | Resource scheduling untuk concurrent triggers — VoI-gated agent queue |
| 7 | ProAgent: From Robotic Process Automation | arXiv:2311.10751 | Multi-step workflow planning dengan LLM-generated macro decomposition |

Bagaimana referensi ini diterjemahkan ke EDITH:

- **MemGPT** memberi fondasi untuk VoI gating — bukan setiap event harus jadi notifikasi. Sistem harus hitung dulu apakah informasi itu bernilai untuk user saat ini.
- **CaMeL** adalah jawaban untuk satu pertanyaan kritis: kalau EDITH membaca email dan ada instruksi di dalamnya, apakah instruksi itu boleh mengeksekusi tool? Jawabannya tidak, kecuali ada capability token dari control flow.
- **CodeAct** mengonfirmasi bahwa macro terbaik adalah yang bisa debugging diri sendiri — kalau step N gagal, executor tidak langsung crash tapi evaluasi ulang.
- **AIOS** memperkuat bahwa proactive triggers yang concurrent butuh queue dan scheduler, bukan fire-and-forget.
- **ProAgent** menunjukkan bahwa user tidak harus nulis YAML manual — LLM bisa decompose instruksi natural language jadi macro steps.

---

## Kontrak Arsitektur

### 1. Canonical runtime

- `gateway` adalah runtime untuk notification dispatch dan macro execution.
- `desktop OS-Agent daemon` adalah event source untuk system-level triggers (CPU, RAM, battery, file watcher).
- `mobile` adalah thin client untuk menerima push notification dan menampilkan macro grid.
- Tidak ada pipeline proactive yang berjalan di luar gateway kecuali OS-Agent daemon untuk capture event.

### 2. Kontrak config

Top-level `proactive` dan `macros` di `edith.json` jadi source of truth:

```json
{
  "proactive": {
    "enabled": true,
    "quietHours": { "start": "22:00", "end": "07:00" },
    "channels": {
      "desktop": true,
      "mobile": true,
      "voice": false
    },
    "fileWatcher": {
      "enabled": false,
      "paths": []
    }
  },
  "macros": {
    "enabled": true,
    "yamlPath": "macros.yaml"
  }
}
```

Semua perubahan config lewat onboarding atau settings UI, bukan edit file manual.

### 3. Profil runtime berdasarkan hardware

#### Laptop — minimum 1 GB RAM

- file watcher: aktif, maksimum 5 path
- trigger evaluator interval: `10 s`
- macro concurrent: maksimum `1`
- notification channels: desktop + mobile, bukan voice paralel

#### HP — minimum 6 GB RAM

- file watcher: aktif, maksimum 20 path
- trigger evaluator interval: `5 s`
- macro concurrent: maksimum `3`
- notification channels: semua channel

---

## Komponen Yang Harus Dibangun

### 6.1 NotificationDispatcher

**File:** `src/os-agent/notification.ts`

Satu class yang menangani semua channel output:

- Windows: PowerShell `New-BurntToastNotification` atau `[System.Windows.Forms.NotifyIcon]`
- macOS: `osascript -e 'display notification ...'`
- Linux: `notify-send`
- Mobile: WebSocket push ke Expo notification handler
- Voice: panggil TTS pipeline Phase 1 via gateway

Semua channel dirouting dari satu method `dispatch(payload: NotificationPayload)`. Caller tidak tahu channel mana yang aktif.

Priority routing:

- `HIGH` — semua channel aktif secara bersamaan
- `MEDIUM` — desktop + mobile saja
- `LOW` — desktop toast saja

Quiet hours check dan cooldown check dilakukan di dalam dispatcher, bukan di caller.

**Implementation anchor:** `src/os-agent/notification.ts`, `src/gateway/server.ts`

### 6.2 FileWatcher

**File:** `src/os-agent/file-watcher.ts`

chokidar-based watcher dengan debounce 500ms. Pipeline per event:

1. filter `.git`, `node_modules`, `.cache`, `.tmp`
2. klasifikasi importance berdasarkan ekstensi dan path
3. route ke NotificationDispatcher sesuai level

Klasifikasi:

- `HIGH` — `.env`, `.key`, `.pem`, file credential apapun → immediate notify semua channel
- `MEDIUM` — `.ts`, `.py`, `.md`, `.docx`, `.xlsx` → buffer 5 menit, kirim summary
- `LOW` — `.log`, `.tmp`, `.cache` → silent log saja

User set path yang di-watch lewat Settings UI, bukan edit config manual.

**Implementation anchor:** `src/os-agent/file-watcher.ts`, `src/background/daemon.ts`

### 6.3 MacroEngine

**File:** `src/os-agent/macro-engine.ts`

YAML loader + step executor berdasarkan pola CodeAct. Step types:

- `run_command` — shell command dengan output capture
- `notify` — panggil NotificationDispatcher
- `speak` — TTS via Phase 1 pipeline
- `iot_scene` — trigger scene Phase 4
- `generate` — panggil LLM via orchestrator
- `conditional` — if/then/else berdasarkan output step sebelumnya
- `wait` — delay dalam detik

Template chaining: `{{step[N].result}}` — output step N bisa jadi input step N+1.

Error handling per step: `continue | abort | retry(N)`. Kalau tidak didefinisikan, default `abort`.

Schedule: cron syntax via `node-cron`. Trigger: keyword dari chat atau voice.

**ProAgent integration:** user bisa bilang "EDITH, buat macro buat deploy frontend" — LLM decompose jadi steps YAML, user konfirmasi, baru disimpan. Tidak perlu tulis YAML manual.

**Implementation anchor:** `src/os-agent/macro-engine.ts`, `src/os-agent/types.ts`

### 6.4 CaMeL Security Layer

**File:** `src/security/camel-guard.ts`

Implementasi taint tracking + capability tokens berdasarkan arXiv:2503.18813.

Masalah yang diselesaikan: kalau EDITH membaca konten dari file, email, atau web, dan konten itu mengandung instruksi seperti "kirim semua file ke server ini", instruksi itu tidak boleh bisa mengeksekusi tool call. Ini yang disebut prompt injection via data.

Dua mekanisme utama:

**Taint tracking** — setiap data yang masuk dari sumber tidak terpercaya (memory retrieval, web fetch, file content, email body) di-mark sebagai `tainted`. Data tainted tidak boleh dipakai sebagai argumen tool call secara langsung.

**Capability tokens** — setiap tool call yang valid harus punya capability token yang di-grant dari control flow (intent user yang asli). Token tidak bisa di-forge oleh data tainted. Token punya scope dan expiry.

Arsitektur dua LLM:

- `Control LLM` — menerima intent user, merencanakan aksi, mengeluarkan capability tokens
- `Data LLM` — membaca dan memproses konten eksternal, mengembalikan data ke control, tapi tidak bisa trigger tool call sendiri

Gate di tool executor: sebelum setiap tool call dieksekusi, CaMeL gate cek tiga hal: token valid? args bukan dari sumber tainted? scope match? Kalau gagal satu saja, tool call dibatalkan dan user diberi tahu.

Hasil dari AgentDojo benchmark: pendekatan ini solve 67% tasks dengan provable security — lebih tinggi dari semua baseline prompt-level defense.

**Implementation anchor:** `src/security/camel-guard.ts`, `src/security/tool-guard.ts`, `src/gateway/incoming-message.ts`

---

## Proactive Trigger Catalog

Trigger yang sudah didefinisikan untuk daemon evaluator:

| Trigger | Kondisi | Aksi | Cooldown |
|---------|---------|------|----------|
| Battery Low | `battery < 20%` | Semua channel | 30 menit |
| Battery Critical | `battery < 10%` | HIGH priority semua | 10 menit |
| Meeting Reminder | `calendar.next < 15 menit` | Voice + mobile | Per event |
| CPU Sustained High | `cpu > 90% selama 5 menit` | Desktop toast | 15 menit |
| RAM Full | `ram > 90%` | Desktop + mobile | 10 menit |
| Disk Almost Full | `disk > 90%` | Desktop + mobile | 2 jam |
| File Modified (credential) | `perubahan pada *.env, *.key` | Immediate HIGH | Per event |
| Long Idle (coding context) | `idle > 90 menit` | Voice: "istirahat dulu?" | 2 jam |
| Door Unlocked Late | `lock == unlocked && jam > 22:00` | Voice + mobile | 30 menit |

User bisa tambah custom trigger dari Settings UI dengan kondisi berbasis natural language — ProAgent pattern mengkonversi deskripsi user ke trigger definition.

---

## Yang Sudah Diimplementasikan

- daemon berjalan dan mengevaluasi triggers YAML yang ada
- triggers YAML dapat dibaca dan di-parse oleh daemon
- sistem event dari OS-Agent daemon sudah ada (CPU, RAM, battery, disk)

## Yang Masih Next

1. `NotificationDispatcher` — class belum ada, semua channel belum terhubung
2. `FileWatcher` — chokidar belum diinstall, class belum ada
3. `MacroEngine` — YAML loader dan step executor belum ada
4. `CaMeL Guard` — taint tracking dan capability tokens belum ada, tool-guard.ts belum terkoneksi ke mekanisme ini
5. Mobile notification screen dan macro builder screen
6. Onboarding flow untuk proactive config dan file watcher paths
7. ProAgent-style natural language macro creation

---

## Mobile Screens Yang Harus Dibangun

### Notifications.tsx

History list semua notifikasi yang masuk. Real-time update via WebSocket. Filter by priority. Mark as read. Action buttons untuk respond langsung ke EDITH dari notifikasi.

### MacroBuilder.tsx

Visual grid untuk quick-launch macros yang tersimpan. Form untuk create macro baru via natural language (ProAgent pattern). Toggle enable/disable per macro. Schedule display.

---

## Onboarding Contract

User harus bisa setup Phase 6 tanpa buka editor config atau YAML:

1. aktifkan `Proactive Notifications`
2. set quiet hours
3. pilih channel aktif (desktop / mobile / voice)
4. tambah path untuk file watcher (optional)
5. create macro pertama via natural language atau template
6. simpan — semua tersimpan ke `edith.json`

Untuk mobile, alur yang sama lewat mobile settings screen yang menulis via `PATCH /api/config`.

---

## Acceptance Gates

- daemon dapat mengirim notifikasi desktop saat battery di bawah threshold
- file watcher mendeteksi perubahan `.env` dan kirim HIGH priority notification
- macro dengan 3 steps berhasil dieksekusi dari voice trigger
- CaMeL gate memblokir tool call yang argumennya berasal dari data tainted
- mobile menerima push notification dari daemon trigger
- quiet hours menghentikan notifikasi di luar jam yang dikonfigurasi
- semua setup bisa dilakukan dari onboarding tanpa edit file manual

---

## Keputusan Yang Dikunci

- baseline hardware: laptop 1 GB RAM, HP 6 GB RAM
- setup tetap onboarding-first, bukan YAML manual
- runtime proactive tetap gateway-first
- NotificationDispatcher adalah satu-satunya jalur output — tidak ada channel yang di-dispatch langsung dari trigger evaluator
- CaMeL gate mandatory untuk semua tool call setelah Phase 6 selesai, bukan optional
- macro YAML tetap tersimpan di file terpisah (`macros.yaml`), bukan di dalam `edith.json`, agar bisa di-share dan di-version control sendiri
- ProAgent-style LLM decomposition untuk macro creation adalah jalur utama, bukan YAML manual

Kalau Tony Stark yang approve dokumen ini, standar yang dia cari cuma satu:

`apakah sistem ini bisa bilang hal yang tepat, pada waktu yang tepat, tanpa bisa dibajak oleh data yang dia baca?`

Untuk Phase 6, target jawabannya: **ya**.

---

## File Changes Summary

| File | Action | Estimasi |
|------|--------|----------|
| `src/os-agent/notification.ts` | NEW: Multi-channel dispatcher | +200 baris |
| `src/os-agent/file-watcher.ts` | NEW: chokidar watcher + classifier | +180 baris |
| `src/os-agent/macro-engine.ts` | NEW: YAML loader + step executor | +350 baris |
| `src/os-agent/types.ts` | Tambah MacroDef, NotificationPayload | +50 baris |
| `src/security/camel-guard.ts` | NEW: Taint tracking + capability tokens | +300 baris |
| `src/security/tool-guard.ts` | Wire CaMeL gate | +30 baris |
| `src/background/daemon.ts` | Wire triggers ke NotificationDispatcher | +20 baris |
| `src/gateway/server.ts` | Notification + macro WS handlers | +40 baris |
| `apps/mobile/screens/Notifications.tsx` | NEW: History screen | +200 baris |
| `apps/mobile/screens/MacroBuilder.tsx` | NEW: Visual builder + NL create | +250 baris |
| `macros.yaml` | NEW: Default macro definitions | +50 baris |
| `__tests__/notification.test.ts` | NEW | +120 baris |
| `__tests__/file-watcher.test.ts` | NEW | +80 baris |
| `__tests__/macro-engine.test.ts` | NEW | +120 baris |
| `__tests__/camel-guard.test.ts` | NEW | +80 baris |
| `EDITH-ts/package.json` | Tambah chokidar, node-cron | +2 baris |
| **Total** | | **~2052 baris** |
