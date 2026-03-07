# EDITH — Suggested Additional Phases

> *"EDITH, what are we missing?"*
> *"Cross-referencing current phase coverage against a full JARVIS feature matrix, sir.
>    I've identified 8 capability gaps worth building."*

**Context:** Setelah Phase 1–12 selesai, EDITH bisa voice, vision, IoT, computer use, multi-agent,
dan offline. Tapi ada beberapa capability yang belum punya rumah di phase manapun.

---

## Gap Analysis — Yang Belum Ada

```
Current Coverage:
  ✅ Voice I/O              ✅ IoT / Smart Home
  ✅ Vision / Screen        ✅ Multi-channel (WA, TG, Discord)
  ✅ Computer Use           ✅ Multi-agent
  ✅ Memory (MemRL)         ✅ Offline / Local LLM
  ✅ Personalization        ✅ Distribution

Missing:
  ❌ Personal Knowledge Base (dokumen, notes, PDF user)
  ❌ Calendar & Scheduling intelligence
  ❌ Browser automation (bukan sekedar screenshot)
  ❌ Mobile deep integration (push notif, widget, shortcut)
  ❌ Dev / Code assistant mode (IDE integration)
  ❌ Social memory (track orang-orang yang user kenal)
  ❌ Privacy vault (enkripsi secrets, audit log)
  ❌ Financial awareness (spending, budget alerts)
```

---

## Phase 13 — Personal Knowledge Base (Second Brain)

**Prioritas:** 🔴 HIGH — Killer feature. Bikin EDITH tahu semua yang kamu tulis.
**Tagline:** *"EDITH, cari notes gue soal arsitektur microservice bulan lalu."*

### Apa Ini
User bisa upload / sync dokumen pribadi — PDF, Notion export, Obsidian vault,
Word docs, meeting notes, screenshot teks — ke EDITH. EDITH membaca, index,
dan bisa jawab pertanyaan berdasarkan konten dokumen tersebut.

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **RAG Survey** (arXiv:2312.10997) | Retrieval pipeline untuk personal docs |
| **LongRAG** (arXiv:2406.15319) | Handle dokumen panjang (buku, laporan 100+ hal) |
| **HippoRAG** (arXiv:2405.14831) | Graph-based knowledge — hubungan antar konsep |
| **ColPali** (arXiv:2407.01449) | PDF visual understanding — tabel, diagram, chart |

### Sub-phases
```
13A  Document Ingestion Pipeline
     - PDF, DOCX, MD, TXT, image-of-text (OCR)
     - Auto-chunk + embed → LanceDB (existing memory store)
     - Watch folder: ~/Documents, Obsidian vault, Downloads

13B  Smart Retrieval
     - HippoRAG graph: link dokumen yang related otomatis
     - Query: "cari semua yang gue tulis soal X" → multi-hop retrieval
     - ColPali: query terhadap diagram / tabel dalam PDF

13C  Source Sync Connectors
     - Notion API connector
     - Obsidian vault watcher (local folder)
     - Google Drive sync (via OAuth)
     - Browser bookmarks + reading list

13D  Knowledge Q&A Interface
     - "Dari semua meeting notes gue, siapa yang paling sering sebut deadline?"
     - Citation: jawaban dengan sumber + halaman
     - "Buat ringkasan dari 10 artikel yang gue simpan soal AI ini"
```

### edith.json Config
```json
"knowledgeBase": {
  "enabled": true,
  "watchPaths": ["~/Documents/notes", "~/Obsidian"],
  "connectors": {
    "notion": { "apiKey": "secret_..." },
    "googleDrive": { "enabled": false }
  },
  "chunkSize": 512,
  "autoIndex": true
}
```

> 📄 **Detailed plan:** [PHASE-13-KNOWLEDGE-BASE.md](./PHASE-13-KNOWLEDGE-BASE.md) (~2750 lines, 6 sub-phases)

---

## Phase 14 — Calendar & Schedule Intelligence

**Prioritas:** 🔴 HIGH — EDITH tanpa kalender itu kayak JARVIS yang ga tau jadwal Tony.
**Tagline:** *"EDITH, blokir 2 jam fokus coding besok dan pastiin ga ada meeting yang overlap."*

### Apa Ini
EDITH terhubung ke Google Calendar / Outlook, memahami pola jadwal user,
dan bisa **proaktif** mengingatkan, menjadwalkan, dan melindungi waktu fokus.

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **TimeAgent** (arXiv:2504.01234) | Calendar reasoning: slot finding + conflict detection |
| **ProAgent** (arXiv:2308.11339) | Proactive scheduling: anticipate user needs from context |
| **NaturalBench Calendar** (ACL 2024) | NL → calendar intent parsing (bilingual) |

### Sub-phases
```
14A  Calendar Connector
     - Google Calendar OAuth (read + write)
     - Microsoft Outlook / Exchange (read + write)
     - iCal feed (read-only)
     - Local: timezone-aware, recurring event support

14B  Schedule Intelligence
     - Free slot finder: "kapan gue free besok 1 jam?"
     - Conflict detection sebelum buat event
     - Travel time buffer (integrate dengan maps)
     - Energy-aware scheduling: meeting pagi, coding siang, review sore

14C  Proactive Time Protection
     - Auto-detect "deep work" patterns dari history → blokir slot
     - "Lu punya 3 meeting back-to-back Rabu, mau gue reschedule salah satunya?"
     - Deadline proximity: "Sprint review 2 hari lagi, lu belum estimate story points"

14D  Natural Language Scheduling
     - "Schedule lunch sama Andi minggu depan hari apa lu berdua free"
     - Draft invite + kirim via email (Phase 8 integration)
     - Bilingual: "besok jam 3 sore" → datetime parse Indonesia
```

### edith.json Config
```json
"calendar": {
  "enabled": true,
  "providers": {
    "google": { "clientId": "...", "clientSecret": "..." },
    "outlook": { "tenantId": "...", "clientId": "..." }
  },
  "focusBlockDurationMinutes": 120,
  "travelBufferMinutes": 30,
  "timezone": "Asia/Jakarta"
}
```

> 📄 **Detailed plan:** [PHASE-14-CALENDAR.md](./PHASE-14-CALENDAR.md) (~2650 lines, 6 sub-phases)

---

## Phase 15 — Browser Agent (Deep Web Automation)

**Prioritas:** 🟡 MEDIUM-HIGH — Beda dari Phase 7 (Computer Use).
**Tagline:** *"EDITH, booked-in deh tiket kereta Bandung Sabtu pagi, budget di bawah 200k."*

### Bedanya dengan Phase 7 (Computer Use)
Phase 7 = screenshot → klik pixel. Ini = **purpose-built browser automation** dengan
DOM awareness, form filling cerdas, session management, dan web scraping terstruktur.

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **WebAgent** (arXiv:2307.12856) | LLM-driven browser: HTML understanding → action |
| **Mind2Web** (arXiv:2306.06070) | Cross-website generalization untuk web tasks |
| **WebArena** (arXiv:2307.13854) | Benchmark: realistic web tasks evaluation |
| **Browser Use** (2024, open-source) | Playwright + LLM integration pattern |

### Sub-phases
```
15A  Browser Core
     - Playwright headless + headful mode
     - DOM → simplified tree (filter noise, keep interactable)
     - Session / cookie persistence (login sekali, ingat terus)
     - Screenshot fallback ke Phase 7 vision kalau DOM parse gagal

15B  Smart Form Filling
     - LLM maps user intent → form fields (bukan hardcode)
     - Multi-step forms dengan state tracking
     - CAPTCHA detection → fallback ke user (dengan screenshot)
     - Credential vault integration (Phase 17)

15C  Web Research Agent
     - Multi-tab parallel research (5 sumber sekaligus)
     - Extract structured data: harga, jadwal, availability
     - Compare + synthesize: "cari 3 hotel di Bali bintang 4 bawah 800k, compare fasilitas"
     - Citation-aware output

15D  Automation Recipes
     - Pre-built: tiket.com, traveloka, tokopedia, shopee, linkedin
     - User-definable: record-and-replay via NL description
     - Error recovery: kalau gagal → retry dengan different approach
```

> 📄 **Detailed plan:** [PHASE-15-BROWSER-AGENT.md](./PHASE-15-BROWSER-AGENT.md) (~1840 lines, 6 sub-phases)

---

## Phase 16 — Mobile Deep Integration

**Prioritas:** 🟡 MEDIUM-HIGH — Mobile app udah ada (React Native Expo) tapi masih basic.
**Tagline:** Notifikasi proaktif, widget di homescreen, shortcut Siri/Google Assistant.

### Apa Ini
React Native app yang sekarang cuma bisa chat. Ekspansi ke:
push notifications, background sync, widget, share extension, dan integrasi
dengan asisten bawaan HP (Siri Shortcuts, Android App Intents).

### Sub-phases
```
16A  Push Notifications
     - FCM (Android) + APNs (iOS) integration
     - EDITH proactive triggers → push ke HP
     - Notification categories: info, urgent, action-required
     - Silent background sync (refresh context saat HP idle)

16B  Home Screen Widget
     - iOS Widget (WidgetKit via Expo plugin)
     - Android Widget (Glance)
     - Content: upcoming events, EDITH last message, quick actions
     - Tap → deep link ke chat context

16C  Share Extension
     - Share URL/image/teks dari app manapun → EDITH
     - "Simpan ke knowledge base", "Buat summary", "Tanyakan ke EDITH"
     - iOS Share Sheet + Android Intent

16D  Voice Assistant Bridge
     - Siri Shortcut: "Hey Siri, tanya EDITH..."
     - Android App Intents / Google Assistant actions
     - Wear OS basic support (cek notif, reply singkat)
```

> 📄 **Detailed plan:** [PHASE-16-MOBILE-DEEP.md](./PHASE-16-MOBILE-DEEP.md) (~1590 lines, 6 sub-phases)

---

## Phase 17 — Privacy Vault & Security Layer

**Prioritas:** 🟡 MEDIUM — Makin penting kalau EDITH nyimpan data sensitif.
**Tagline:** *"EDITH, semua secret-mu terenkripsi. Audit log semua aksi tersedia."*

### Apa Ini
Saat ini API keys disimpan plaintext di `edith.json`. Phase ini:
- Enkripsi secrets dengan kunci yang diderive dari password user
- Audit log semua aksi EDITH (tool calls, file access, API calls)
- Export semua data (GDPR-style) dan delete dengan sekali perintah
- Per-tool permission granular

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **CaMeL** (arXiv:2503.18813) | Taint tracking — sudah di Phase 6, diperluas di sini |
| **OWASP ASVS** | Secrets management best practices |
| **Secretless Broker** (CA Technologies) | Runtime secrets injection, no plaintext at rest |

### Sub-phases
```
17A  Encrypted Secrets Store
     - edith-vault.json: AES-256-GCM, key dari user passphrase (PBKDF2/Argon2)
     - edith.json env section: nilai bisa reference vault ("$vault:GROQ_API_KEY")
     - Auto-lock setelah idle timeout
     - Desktop keychain integration (Windows Credential Manager, macOS Keychain)

17B  Action Audit Log
     - Setiap tool call EDITH: log to edith-audit.jsonl (append-only)
     - Fields: timestamp, tool, args_hash (no plaintext sensitive), user, result
     - "EDITH, tunjukkan semua yang lu lakukan hari ini"
     - Tamper-evident: HMAC chain

17C  Permission Manager
     - Per-tool: allow/deny/ask-each-time
     - Per-domain (browser agent): whitelist situs yang boleh
     - Time-scoped: "izinkan browser agent 1 jam, setelah itu minta konfirmasi lagi"
     - UI di desktop app: Settings → Permissions

17D  Data Export & Delete
     - Export: semua memory, logs, config → ZIP terenkripsi
     - Delete: GDPR-compliant wipe (secure delete + overwrite)
     - Backup to encrypted cloud (optional, user-controlled)
```

> 📄 **Detailed plan:** [PHASE-17-PRIVACY-VAULT.md](./PHASE-17-PRIVACY-VAULT.md) (~1640 lines, 5 sub-phases)

---

## Phase 18 — Social & Relationship Memory

**Prioritas:** 🟡 MEDIUM — Bikin EDITH kayak JARVIS yang beneran kenal orang di sekitar Tony.
**Tagline:** *"EDITH, draft email ke Reza — dia orangnya formal, suka data konkret."*

### Apa Ini
EDITH builds dan maintains **people graph** — siapa-siapa yang user interact, apa yang
diketahui tentang mereka, history interaksi, dan context penting.

### Sub-phases
```
18A  People Graph
     - Entity extraction dari conversations: nama, role, relasi
     - Auto-create person profile dari mention pertama
     - Link ke kalender events, emails, messages

18B  Interaction History
     - "Kapan terakhir gue ngobrol sama Sarah?"
     - "Apa yang gue janjiin ke Budi bulan lalu?"
     - Context inject saat nulis pesan ke seseorang

18C  Communication Style Learning
     - Per-person: formal/casual, panjang/singkat, emoji/no emoji
     - "Tulis reply ke email ini dengan gaya yang cocok untuk orangnya"

18D  Relationship Reminders
     - Birthday / anniversary dari kalender atau mention
     - "Lu belum kabar ke mentor lu 3 bulan" (kalau user setting ini)
     - Follow-up tracker: "Masih nunggu reply dari vendor X sejak 2 minggu lalu"
```

> 📄 **Detailed plan:** [PHASE-18-SOCIAL-MEMORY.md](./PHASE-18-SOCIAL-MEMORY.md) (~1610 lines, 6 sub-phases)

---

## Phase 19 — Dev & Code Assistant Mode

**Prioritas:** 🟡 MEDIUM — Untuk user yang developer (kemungkinan besar mayoritas user EDITH).
**Tagline:** *"EDITH, review PR ini dan kasih tau ada bug logic ga di function payment."*

### Apa Ini
VS Code extension + deep git/project awareness. Beda dari computer use —
ini **semantic code understanding**, bukan sekedar klik-klik di editor.

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **SWE-agent** (arXiv:2405.15793) | Autonomous software engineering agent |
| **Agentless** (arXiv:2407.01489) | Localize + fix bugs tanpa full repo context |
| **RepoAgent** (arXiv:2402.16667) | Repo-level code understanding + documentation |
| **CodeR** (arXiv:2406.01304) | Multi-agent: planner + executor + verifier untuk code |

### Sub-phases
```
19A  VS Code Extension
     - Sidebar chat dengan full project context
     - @file, @function, @git-diff mentions
     - Inline code completion (berbeda dari Copilot: pakai engine EDITH sendiri)

19B  Git Awareness
     - "Jelaskan semua yang berubah di PR ini"
     - "Siapa yang nulis fungsi ini dan kenapa?"
     - Commit message generator dengan conventional commits

19C  Bug Finding & Fix
     - EDITH bisa baca error log + stack trace → locate + suggest fix
     - "Run tests, kalau ada yang fail, coba fix sendiri" (SWE-agent pattern)
     - Security scan: detect hardcoded secrets, SQL injection, etc.

19D  Documentation Generator
     - Auto-generate JSDoc/TSDoc dari kode
     - "Buat README untuk repo ini"
     - Diagram: generate Mermaid dari arsitektur kode (RepoAgent)
```

> 📄 **Detailed plan:** [PHASE-19-DEV-ASSISTANT.md](./PHASE-19-DEV-ASSISTANT.md) (~2110 lines, 6 sub-phases)

---

## Prioritization Matrix

```
                    ┌─────────────┬─────────────┐
                    │  HIGH Value │  LOW Value  │
         ┌──────────┼─────────────┼─────────────┤
  LOW    │          │  Phase 13   │             │
 Effort  │          │  Knowledge  │             │
         │          │  Base       │             │
         ├──────────┼─────────────┼─────────────┤
  HIGH   │          │  Phase 14   │  Phase 18   │
 Effort  │          │  Calendar   │  Social Mem │
         │          │  Phase 19   │  Phase 17   │
         │          │  Dev Mode   │  Privacy    │
         │          │  Phase 15   │             │
         │          │  Browser    │             │
         │          │  Phase 16   │             │
         │          │  Mobile     │             │
         └──────────┴─────────────┴─────────────┘
```

## Recommended Build Order

```
After Phase 12 (stable, distributable):

  Phase 13 (Knowledge Base)  ← biggest daily value, uses existing LanceDB
       ↓
  Phase 14 (Calendar)        ← makes EDITH genuinely useful every morning
       ↓
  Phase 15 (Browser Agent)   ← "JARVIS, book that"
       ↓
  Phase 17 (Privacy Vault)   ← trust layer before wider distribution
       ↓
  Phase 16 (Mobile Deep)     ← always-with-you companion
       ↓
  Phase 19 (Dev Mode)        ← for the dev user base specifically
       ↓
  Phase 18 (Social Memory)   ← nice to have, builds on top of everything
```

---

## Phase 20 — HUD Overlay & Ambient Display

**Prioritas:** 🟡 MEDIUM-HIGH — Tony punya holographic display. EDITH butuh "wajah" yang always-visible.
**Tagline:** *"EDITH, show me the status."*

### Apa Ini
Desktop overlay transparan yang always-on-top — menampilkan info kontekstual tanpa harus
buka app. Kayak HUD di dalam helm Iron Man: minimal, informatif, selalu terlihat kalau
dibutuhkan, hilang kalau tidak.

### Kenapa Ini Beda dari Desktop App
Desktop app (Electron) sekarang = full window chat. HUD = overlay transparan yang:
- Floating di corner layar, selalu di atas
- Menampilkan contextual cards (cuaca, next meeting, task, notif)
- Bisa dismiss dengan gesture atau voice
- Expand jadi full mode kalau ditap

### Core Tech
| Teknologi | Fungsi |
|-----------|--------|
| **Electron BrowserWindow** `transparent: true, alwaysOnTop: true` | Overlay window |
| **Framer Motion / CSS animations** | Smooth reveal/hide |
| **Web Audio API** | Visual audio feedback saat voice active |
| **Canvas / WebGL** | Arc reactor-style animated indicators |

### Sub-phases
```
20A  Transparent Overlay Engine
     - Electron window: transparent, click-through, non-focusable
     - Position: corner selection (top-right, bottom-right, etc.)
     - Show/hide: keyboard shortcut (Ctrl+Shift+E), voice ("EDITH, show HUD")
     - Click-through mode: mouse passes through ke app di bawahnya

20B  Contextual Cards
     - Next event card (dari Phase 14 Calendar)
     - Weather + commute card
     - Active task / timer card
     - Unread message count (dari Phase 8 Channels)
     - Quick reply: ketik langsung di overlay

20C  Status Indicators
     - Arc reactor-style animated circle: listening, thinking, idle
     - Color coding: green (ready), blue (processing), amber (warning)
     - Typing indicator saat EDITH generating response
     - Health bar: CPU/RAM usage saat EDITH heavy processing

20D  Ambient Notification Mode
     - Notification muncul di overlay, bukan system tray
     - Priority-based: urgent = center screen, info = corner fade
     - Stack management: max 3 visible, queue sisanya
     - "Film mode": suppress semua visual saat fullscreen app
```

### edith.json Config
```json
"hud": {
  "enabled": true,
  "position": "top-right",
  "opacity": 0.85,
  "cards": ["calendar", "weather", "tasks", "messages"],
  "hotkey": "Ctrl+Shift+E",
  "filmModeAutoDetect": true,
  "theme": "arc-reactor"
}
```

---

## Phase 21 — Emotional Intelligence & Adaptive Tone

**Prioritas:** 🟡 MEDIUM — JARVIS tahu kapan Tony serius dan kapan bercanda. EDITH juga harus.
**Tagline:** *"Lu kedengeran capek, bos. Mau gue reschedule meeting sore lu?"*

### Apa Ini
EDITH mendeteksi emosi/mood user dari teks, suara, atau pola interaksi — lalu
menyesuaikan cara bicara, prioritas saran, dan intensitas proaktif. Bukan sekedar
sentiment analysis — ini **behavioral adaptation**.

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **EmoBench** (arXiv:2402.12071) | Benchmark: LLM emotional understanding |
| **SER-Whisper** (arXiv:2309.07937) | Speech Emotion Recognition dari audio features |
| **PICA** (arXiv:2407.00154) | Proactive conversational agents — emosi-aware timing |
| **AffectGPT** (arXiv:2403.02378) | Multimodal affect: teks + suara + ekspresi |

### Sub-phases
```
21A  Text Sentiment Engine
     - Detect dari chat: frustasi, senang, buru-buru, bosan, stres
     - Context window: bukan per-message, tapi sliding window 10 pesan
     - "Lu udah 3x bilang 'ugh' dalam 5 menit" → detected frustration
     - Update session mood: mempengaruhi response style

21B  Voice Emotion Detection
     - Dari Phase 1 audio stream: pitch, tempo, energy, pause pattern
     - Whisper + paralinguistic features → mood classifier
     - Real-time: update mood saat user sedang bicara
     - Privacy-first: processed locally, no raw audio stored

21C  Adaptive Response Style
     - Mood → response adjustment matrix:
       stressed  → shorter, more actionable, less small talk
       happy     → warmer, can include humor/banter
       focused   → minimal interruption, only critical proactive
       tired     → suggest breaks, simplify options, defer non-urgent
     - Override: user bisa bilang "EDITH, formal mode" kapan saja

21D  Burnout & Wellness Patterns
     - Track working hours dari keyboard/mouse activity (opt-in)
     - "Lu udah coding 6 jam non-stop. Istirahat 15 menit?"
     - Weekly mood summary: "Minggu ini lu dominan fokus. Kecuali Rabu sore."
     - TIDAK menyimpan data mood tanpa consent — toggle per-fitur
```

### edith.json Config
```json
"emotionalIntelligence": {
  "enabled": true,
  "textSentiment": true,
  "voiceEmotion": true,
  "adaptiveResponse": true,
  "wellnessTracking": false,
  "privacyMode": "local-only",
  "moodHistoryRetentionDays": 30
}
```

---

## Phase 22 — Autonomous Mission Mode

**Prioritas:** 🟡 MEDIUM — "EDITH, handle it" dan pergi tidur.
**Tagline:** *"EDITH, gue tidur. Besok pagi gue mau laporan lengkap apa yang lu kerjain."*

### Apa Ini
User bisa assign EDITH sebuah **mission** — goal besar multi-step yang EDITH kerjakan
secara autonomous selama berjam-jam tanpa intervensi. Hasilnya dikirim sebagai laporan.
Ini Mark 42-level automation: "autopilot, JARVIS."

### Bedanya dengan Phase 11 (Multi-Agent)
Phase 11 = orchestrasi sub-agents untuk task panjang yang user monitor.
Phase 22 = **fully autonomous operation** di mana user pergi dan EDITH jalan sendiri
dengan checkpoint, decision logging, dan self-recovery.

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **AutoGen** (Microsoft, 2023) | Multi-agent autonomous conversation loops |
| **ADAS** (arXiv:2408.13231) | Automated Design of Agentic Systems — self-improving |
| **Voyager** (arXiv:2305.16291) | Lifelong learning agent — explore, learn, skill library |
| **SWE-agent** (arXiv:2405.15793) | Autonomous software engineering without human |

### Sub-phases
```
22A  Mission Planner
     - User defines goal in natural language:
       "Research 10 kompetitor EDITH, buat comparison table, simpan di Notion"
     - EDITH decomposes → DAG of sub-tasks
     - Estimated duration + resource requirements
     - User approves plan → mission starts

22B  Autonomous Execution Engine
     - Runs tasks sequentially/parallel sesuai DAG
     - Checkpoint per sub-task: progress saved ke file
     - Self-correction: kalau task gagal → retry with different approach
     - Decision logging: setiap keputusan yang EDITH ambil → logged with reasoning

22C  Guardrails & Safety Boundaries
     - Budget limits: max API calls, max tokens, max waktu
     - Scope lock: EDITH ga boleh expand scope tanpa izin
     - Sensitive action gate: anything destructive → queue for user approval
     - "Abort mission" command: immediate stop + progress report
     - Dead man's switch: auto-stop kalau no progress 30 menit

22D  Mission Report
     - Selesai → detailed report:
       - Apa yang diminta
       - Apa yang dikerjakan (step-by-step with timestamps)
       - Keputusan yang diambil dan alasannya
       - Hasil akhir (files, data, summaries)
       - Failures dan bagaimana recovery-nya
     - Dikirim via channel preference (email, telegram, push notif)
```

### edith.json Config
```json
"mission": {
  "enabled": true,
  "maxDurationHours": 8,
  "maxApiCalls": 500,
  "autoStopAfterNoProgressMinutes": 30,
  "requireApprovalForDestructiveActions": true,
  "reportChannel": "telegram",
  "checkpointIntervalMinutes": 15
}
```

---

## Phase 23 — Hardware & Physical World Bridge

**Prioritas:** 🟢 MEDIUM — Tony's suit is physical. EDITH butuh jembatan ke dunia fisik.
**Tagline:** *"EDITH, nyalain lampu meja, set monitor kedua ke mode presentasi, charge laptop."*

### Apa Ini
Ekspansi Phase 4 (IoT) ke hardware enthusiast territory: Arduino, Raspberry Pi,
ESP32, USB relay, LED strip, servo motor. Plus: smart desk setup — monitor control
(DDC/CI), USB device management, printer, scanner.

### Bedanya dengan Phase 4 (IoT)
Phase 4 = smart home (Philips Hue, Tuya, etc.) via API.
Phase 23 = **direct hardware communication** + desk peripheral control + maker projects.

### Sub-phases
```
23A  Serial & GPIO Communication
     - Arduino/ESP32 via serial (node-serialport)
     - Raspberry Pi GPIO via pigpio
     - Protocol handlers: MQTT, serial, I2C, BLE
     - Device discovery: scan USB devices, auto-detect Arduino

23B  Desk Environment Control
     - Monitor brightness/input source via DDC/CI (WinAPI / ddcutil)
     - USB hub power control: turn devices on/off
     - Webcam/mic hardware mute (beyond OS mute)
     - Desk LED strip: color = EDITH status (arc reactor vibes)

23C  Maker Project Integration
     - "EDITH, putar servo ke 90 derajat"
     - Sensor dashboard: read temperature, humidity, motion dari connected sensors
     - Automation: "kalau suhu kamar > 30°C, nyalain kipas via relay"
     - Code generator: EDITH bikin Arduino sketch dari deskripsi NL

23D  3D Print & Fabrication Queue
     - Monitor OctoPrint / Bambu Lab status
     - "EDITH, print ini pakai PLA hitam, infill 20%"
     - Queue management: multiple prints, estimated time
     - Alert: "Print selesai" atau "Print gagal di layer 47"
```

### edith.json Config
```json
"hardware": {
  "enabled": false,
  "serial": {
    "autoDetect": true,
    "allowedPorts": ["COM3", "/dev/ttyUSB0"]
  },
  "desk": {
    "ddcciMonitorControl": true,
    "ledStrip": { "type": "ws2812b", "pin": 18 }
  },
  "octoprint": {
    "url": "http://192.168.1.50",
    "apiKey": "$vault:OCTOPRINT_KEY"
  }
}
```

---

## Phase 24 — Self-Improvement & Meta-Learning

**Prioritas:** 🟢 MEDIUM — Mark I sampai Mark L: setiap iterasi lebih baik. EDITH harus sama.
**Tagline:** *"EDITH belajar dari setiap interaksi dan jadi lebih baik tanpa lu sadari."*

### Apa Ini
EDITH secara otomatis improve performanya sendiri: prompt optimization dari feedback,
skill creation dari pola berulang, dan knowledge gap detection. Ini bukan fine-tuning
model — ini **system-level self-improvement**.

### Core Papers
| Paper | Kontribusi |
|-------|-----------|
| **ADAS** (arXiv:2408.13231) | Automated Design of Agentic Systems |
| **Voyager** (arXiv:2305.16291) | Lifelong learning: discover skills, build library |
| **DSPy** (arXiv:2310.03714) | Programmatic prompt optimization without manual tuning |
| **Self-Refine** (arXiv:2303.17651) | Iterative self-refinement tanpa external feedback |

### Sub-phases
```
24A  Response Quality Tracking
     - Track implicit feedback: user rephrase = bad response
     - Track explicit feedback: thumbs up/down, "that's wrong"
     - Per-skill success rate: mana yang sering gagal?
     - Weekly report: "Top 5 pertanyaan yang gue ga bisa jawab bagus"

24B  Prompt Auto-Optimization (DSPy-style)
     - System prompt segments yang underperform → auto-revise
     - A/B testing: 2 prompt variants, track mana yang user lebih suka
     - Guardrail: identity/safety sections NEVER auto-modified
     - Version control: semua prompt changes logged + rollback-able

24C  Skill Auto-Creation
     - Detect pola: user minta hal yang sama > 3x
     - "Kayaknya lu sering minta format commit message. Mau gue bikin skill?"
     - Auto-draft SKILL.md → user review → approved → active
     - Skill sunset: kalau skill ga dipake 60 hari → suggest archive

24D  Knowledge Gap Detection
     - Track "I don't know" responses → topics EDITH struggles with
     - Suggest knowledge base additions (Phase 13): "Lu banyak tanya soal K8s,
       mau gue index dokumentasi Kubernetes ke knowledge base lu?"
     - Cross-reference with user's bookmarks/notes (if Phase 13 active)
     - Weekly learning report: "3 hal baru yang gue pelajari minggu ini"
```

### edith.json Config
```json
"selfImprovement": {
  "enabled": true,
  "feedbackTracking": true,
  "promptOptimization": false,
  "autoSkillCreation": true,
  "knowledgeGapDetection": true,
  "promptAutoModifyExclusions": ["identity", "safety", "permissions"],
  "reportFrequency": "weekly"
}
```

---

## Phase 25 — Digital Twin & Simulation Mode

**Prioritas:** 🟢 LOW-MEDIUM — Tony simulasi suit di hologram sebelum build. EDITH simulasi aksi sebelum execute.
**Tagline:** *"EDITH, simulasi dulu — kalau hasilnya bagus baru jalanin beneran."*

### Apa Ini
Sebelum menjalankan aksi yang berisiko (deploy code, kirim email massal, edit file penting),
EDITH bisa **simulate** hasilnya di sandbox mode. User lihat preview → approve → execute.

### Sub-phases
```
25A  Action Preview Engine
     - Setiap tool call punya "preview mode": generate output tanpa execute
     - File edit: show diff sebelum write
     - Email/message: show draft sebelum send
     - Code: run tests di sandbox sebelum commit ke repo asli

25B  Sandbox Execution
     - Docker container untuk code execution: isolated, disposable
     - Virtual filesystem: simulate file changes tanpa write ke disk
     - Mock API mode: simulate external API calls dengan cached/fake responses
     - Time limit + resource limit per sandbox session

25C  "What If" Analysis
     - "EDITH, kalau gue merge PR ini, ada breaking changes ga?"
     - "Kalau gue reschedule meeting ini, siapa yang kena dampak?"
     - "Simulasi kalau gue pake provider Groq instead of OpenAI — berapa cost difference?"
     - Decision tree visualization

25D  Rollback & Undo Engine
     - Setiap aksi EDITH → create restore point
     - "EDITH, undo yang barusan" → rollback ke state sebelum aksi
     - File versioning: shadow copies sebelum setiap edit
     - Cascading undo: kalau aksi punya child actions, undo semuanya
```

### edith.json Config
```json
"simulation": {
  "enabled": true,
  "previewBeforeExecute": ["file-write", "email-send", "git-push"],
  "sandboxDocker": true,
  "sandboxTimeoutSeconds": 120,
  "maxRollbackHistory": 50,
  "whatIfEnabled": true
}
```

---

## Phase 26 — Collaborative EDITH (Iron Legion)

**Prioritas:** 🟢 LOW — Tony punya Iron Legion. Bagaimana kalau beberapa EDITH kolaborasi?
**Tagline:** *"EDITH-Alpha, handle research. EDITH-Beta, handle coding. Report ke gue dua-duanya."*

### Apa Ini
Multiple EDITH instances bisa berkolaborasi — setiap instance punya specialization
(research, coding, communication), dan user jadi "Tony" yang orchestrate semuanya.
Juga: shared EDITH instances untuk team (family, small team).

### Bedanya dengan Phase 11 (Multi-Agent)
Phase 11 = **internal** sub-agents di dalam satu EDITH instance.
Phase 26 = **external** multiple EDITH instances yang masing-masing berjalan terpisah,
berkomunikasi via API, dan bisa di-manage dari satu dashboard.

### Sub-phases
```
26A  Instance Communication Protocol
     - EDITH-to-EDITH API: authenticated, encrypted
     - Shared context: instance bisa share memory segment (with permission)
     - Task delegation: satu EDITH bisa assign task ke EDITH lain
     - Status sync: semua instance report status ke primary

26B  Specialized Instances
     - EDITH-Research: optimized untuk web search, knowledge base, summarization
     - EDITH-Code: optimized untuk coding, debugging, git operations
     - EDITH-Comm: optimized untuk email, calendar, social communication
     - User bisa spin up/down instances sesuai kebutuhan

26C  Team / Family Shared EDITH
     - Multi-user support (existing Phase 10 multi-user model)
     - Shared knowledge base: team wiki yang semua EDITH bisa akses
     - Per-user privacy: personal memory tetap private
     - "EDITH, share info meeting kemarin ke Sarah"

26D  Central Dashboard
     - Web UI: lihat semua EDITH instances, status, active tasks
     - Resource allocation: GPU/memory per instance
     - Cost tracking: token usage per instance per hari
     - Kill switch: matikan instance yang misbehave
```

### edith.json Config
```json
"legion": {
  "enabled": false,
  "role": "primary",
  "instances": [
    { "name": "EDITH-Research", "url": "http://localhost:8081", "role": "research" },
    { "name": "EDITH-Code", "url": "http://localhost:8082", "role": "coding" }
  ],
  "sharedMemoryEnabled": true,
  "teamMode": false,
  "dashboardPort": 9090
}
```

---

## Updated Gap Analysis — Full Iron Man Feature Matrix

```
Current + Suggested Coverage:
  ✅ Voice I/O (1)                 ✅ Vision / Screen (3)
  ✅ IoT / Smart Home (4)          ✅ Computer Use (7)
  ✅ Multi-channel (8)             ✅ Offline Mode (9)
  ✅ Personalization (10)          ✅ Multi-agent (11)
  ✅ Distribution (12)             ✅ Knowledge Base (13)
  ✅ Calendar Intelligence (14)    ✅ Browser Agent (15)
  ✅ Mobile Deep (16)              ✅ Privacy Vault (17)
  ✅ Social Memory (18)            ✅ Dev Mode (19)

NEW — Phase 20-27:
  ✅ HUD Overlay (20)              ✅ Emotional Intelligence (21)
  ✅ Autonomous Mission (22)       ✅ Hardware Bridge (23)
  ✅ Self-Improvement (24)         ✅ Digital Twin / Simulation (25)
  ✅ Collaborative EDITH (26)      ✅ Cross-Device Mesh (27)

Iron Man Feature Mapping:
  JARVIS Voice           → Phase 1 + 21 (emotion-aware)
  Holographic HUD        → Phase 20
  Suit Diagnostics       → Phase 23 (hardware) + 20 (HUD status)
  Iron Legion            → Phase 26
  Autonomous Flight      → Phase 22 (autonomous mission)
  Self-Repairing Suit    → Phase 24 (self-improvement)
  Simulation Chamber     → Phase 25
  Friday / Karen         → Phase 26 (specialized instances)
  Arc Reactor Monitor    → Phase 20C (status indicators)
  Multi-Device Suit      → Phase 27 (cross-device mesh)
  Threat Detection       → Phase 17 (security) + 21 (context awareness)
```

---

## Updated Prioritization Matrix

```
                    ┌─────────────┬─────────────┐
                    │  HIGH Value │  LOW Value   │
         ┌──────────┼─────────────┼──────────────┤
  LOW    │          │  Phase 13   │  Phase 24    │
 Effort  │          │  Knowledge  │  Self-Improve│
         │          │  Base       │              │
         ├──────────┼─────────────┼──────────────┤
 MEDIUM  │          │  Phase 14   │  Phase 18    │
 Effort  │          │  Calendar   │  Social Mem  │
         │          │  Phase 20   │  Phase 21    │
         │          │  HUD        │  Emotional   │
         │          │  Phase 22   │  Phase 25    │
         │          │  Mission    │  Simulation  │
         ├──────────┼─────────────┼──────────────┤
  HIGH   │          │  Phase 15   │  Phase 26    │
 Effort  │          │  Browser    │  Legion      │
         │          │  Phase 16   │  Phase 23    │
         │          │  Mobile     │  Hardware    │
         │          │  Phase 19   │              │
         │          │  Dev Mode   │              │
         │          │  Phase 17   │              │
         │          │  Privacy    │              │
         └──────────┴─────────────┴──────────────┘
```

## Updated Recommended Build Order

```
After Phase 12 (stable, distributable):

  Phase 13 (Knowledge Base)  ← biggest daily value, uses existing LanceDB
       ↓
  Phase 14 (Calendar)        ← makes EDITH genuinely useful every morning
       ↓
  Phase 20 (HUD Overlay)     ← EDITH gets a face — always-visible companion
       ↓
  Phase 15 (Browser Agent)   ← "JARVIS, book that"
       ↓
  Phase 17 (Privacy Vault)   ← trust layer before wider distribution
       ↓
  Phase 22 (Autonomous Mode) ← "handle it while I sleep" — major wow factor
       ↓
  Phase 21 (Emotional Intel) ← EDITH adapts to you, not just responds
       ↓
  Phase 16 (Mobile Deep)     ← always-with-you companion
       ↓
  Phase 19 (Dev Mode)        ← for the dev user base specifically
       ↓
  Phase 24 (Self-Improvement)← EDITH gets smarter on its own
       ↓
  Phase 25 (Simulation)      ← preview before execute — safety net
       ↓
  Phase 18 (Social Memory)   ← relationship awareness
       ↓
  Phase 23 (Hardware Bridge) ← maker community + desk setup
       ↓
  Phase 23 (Hardware Bridge) ← maker community + desk setup
       ↓
  Phase 27 (Cross-Device)    ← THE glue: HP + laptop, beda gateway, satu EDITH
       ↓
  Phase 26 (Iron Legion)     ← endgame: multiple EDITH collab
```

## Total Gap Summary

| Phase | Name | Effort | Value | Dependency |
|-------|------|--------|-------|------------|
| **13** | Knowledge Base | Medium | ⭐⭐⭐⭐⭐ | Phase 9 (LanceDB) |
| **14** | Calendar Intelligence | Medium | ⭐⭐⭐⭐⭐ | Phase 6 (proactive) |
| **15** | Browser Agent | High | ⭐⭐⭐⭐ | Phase 7 (computer use) |
| **16** | Mobile Deep Integration | High | ⭐⭐⭐⭐ | Phase 8 (channels) |
| **17** | Privacy Vault | Medium | ⭐⭐⭐ | Phase 6 (CaMeL) |
| **18** | Social Memory | Medium | ⭐⭐⭐ | Phase 10 (personalization) |
| **19** | Dev Assistant Mode | High | ⭐⭐⭐⭐ | Phase 11 (multi-agent) |
| **20** | HUD Overlay | Medium | ⭐⭐⭐⭐ | Phase 12 (desktop app) |
| **21** | Emotional Intelligence | Medium | ⭐⭐⭐ | Phase 1 (voice) + Phase 10 |
| **22** | Autonomous Mission | Medium | ⭐⭐⭐⭐⭐ | Phase 11 (multi-agent) |
| **23** | Hardware Bridge | High | ⭐⭐⭐ | Phase 4 (IoT) |
| **24** | Self-Improvement | Low | ⭐⭐⭐⭐ | Phase 10 + Phase 13 |
| **25** | Digital Twin / Simulation | Medium | ⭐⭐⭐ | Phase 7 + Phase 17 |
| **26** | Collaborative EDITH | High | ⭐⭐⭐ | Phase 11 + Phase 17 |
| **27** | Cross-Device Mesh | High | ⭐⭐⭐⭐⭐ | Phase 8 + Phase 12 |

---

## Phase 27 — Cross-Device Mesh & Unified Gateway

**Prioritas:** 🔴 HIGH — Ini lem yang menyatukan HP dan laptop. Different gateway, same EDITH.
**Tagline:** *"Mulai ngobrol di laptop, lanjut di HP sambil jalan — EDITH selalu connected."*

### Apa Ini
EDITH harus jalan **seamless** di HP dan laptop — bahkan ketika keduanya di **network berbeda
dan gateway berbeda**. User mulai ngobrol di laptop, lanjut di HP — tanpa kehilangan konteks.

### Kenapa Ini Beda dari Phase 8 (Channels) dan Phase 16 (Mobile Deep)
Phase 8 = multi-channel delivery (WhatsApp, Telegram, Discord).
Phase 16 = mobile app features (push, widget, share sheet).
Phase 27 = **multi-gateway state synchronization** — satu user, banyak device, beda gateway,
            satu experience EDITH yang konsisten.

### Core Papers/Tech
| Paper / Tech | Kontribusi |
|-------------|-----------|
| **CRDTs** (arXiv:1805.06358) | Eventually consistent sync tanpa central authority |
| **Yjs** (github.com/yjs/yjs) | Production CRDT for real-time shared state |
| **Matrix Protocol** (spec.matrix.org) | Decentralized message sync across servers |
| **WebRTC** (webrtc.org) | P2P direct connection on same network |
| **Apple Continuity / Handoff** | UX pattern: start here, continue there |
| **WireGuard** (wireguard.com) | Lightweight VPN tunnel — cross-network gateway sync |
| **MQTT QoS** (mqtt.org) | Reliable IoT messaging with delivery guarantees |
| **Raft Consensus** (raft.github.io) | Leader election for multi-gateway coordination |

### Sub-phases
```
27A  Device Pairing & Identity
     - QR code pairing: scan from phone to connect to EDITH
     - One user_id, many device_ids — each with own auth token
     - Device registry: name, OS, capabilities, gateway association

27B  Conversation Sync (CRDT-based)
     - Yjs-backed shared conversation state
     - Append-only message log with vector clocks
     - Type on laptop → phone shows message within 2 seconds
     - Automatic conflict resolution (no merge conflicts)

27C  Memory Sync (Tiered)
     - Hot (24h, active session) → real-time via WebSocket
     - Warm (30 days) → periodic batch sync every 5 minutes
     - Cold (older) → on-demand pull
     - Vectors NOT synced — only metadata + text (re-embed locally)

27D  Presence & Active Device Detection
     - Heartbeat every 10s: which device is active?
     - States: active, idle, background, offline, dnd
     - Notifications route to active device only
     - All offline → push to all devices

27E  Gateway-to-Gateway Sync Protocol
     - Two gateways hold full state — either works offline
     - CRDT deltas over WebSocket (persistent connection)
     - HTTP batch fallback if WebSocket breaks
     - Reconnect → bidirectional sync of missed deltas

27F  Session Handoff
     - Lock laptop → phone gets session_handoff event
     - Conversation continues at same scroll position
     - Voice handoff: "EDITH, switch to laptop" → voice moves
     - Context (last 10 messages + mood) transferred instantly

27G  Network Discovery (P2P + Cloud Fallback)
     - mDNS/Bonjour: discover gateways on same network → direct P2P
     - Different network → cloud relay (Cloudflare Tunnel or VPS)
     - WireGuard VPN option for advanced users
     - Hybrid auto-detect: P2P when possible, cloud fallback otherwise

27H  Mobile Companion Deep Integration
     - Full chat (synced), voice, camera, notifications
     - Share sheet: share anything → EDITH processes it
     - Clipboard sync: copy on phone → paste on laptop
     - Location context: proactive suggestions based on where you are
     - Offline mode: cached responses when disconnected
```

### edith.json Config
```json
"crossDevice": {
  "enabled": true,
  "mode": "hybrid",
  "gateways": [
    {
      "id": "local",
      "url": "ws://localhost:3000",
      "role": "primary",
      "network": "home"
    },
    {
      "id": "cloud",
      "url": "wss://edith.myserver.com",
      "role": "replica",
      "network": "public"
    }
  ],
  "syncIntervalMs": 5000,
  "encryption": "aes-256-gcm",
  "discovery": "mdns+cloud",
  "clipboard": true,
  "locationContext": false
}
```

> 📄 **Detailed plan:** [PHASE-27-CROSS-DEVICE.md](./PHASE-27-CROSS-DEVICE.md) (~2430 lines, 8 sub-phases)

---

## Detailed Phase Plans (Full Engineering Docs)

Each phase below has a standalone engineering document with:
- Research references (arXiv IDs, real papers)
- Architecture diagrams (Mermaid)
- TypeScript code examples
- JSON config examples
- Acceptance gates
- Cross-phase connection tables
- File change summaries

| Phase | Detailed Doc |
|-------|-------------|
| 13 | [PHASE-13-KNOWLEDGE-BASE.md](./PHASE-13-KNOWLEDGE-BASE.md) |
| 14 | [PHASE-14-CALENDAR.md](./PHASE-14-CALENDAR.md) |
| 15 | [PHASE-15-BROWSER-AGENT.md](./PHASE-15-BROWSER-AGENT.md) |
| 16 | [PHASE-16-MOBILE-DEEP.md](./PHASE-16-MOBILE-DEEP.md) |
| 17 | [PHASE-17-PRIVACY-VAULT.md](./PHASE-17-PRIVACY-VAULT.md) |
| 18 | [PHASE-18-SOCIAL-MEMORY.md](./PHASE-18-SOCIAL-MEMORY.md) |
| 19 | [PHASE-19-DEV-ASSISTANT.md](./PHASE-19-DEV-ASSISTANT.md) |
| 20 | [PHASE-20-HUD-OVERLAY.md](./PHASE-20-HUD-OVERLAY.md) |
| 21 | [PHASE-21-EMOTIONAL-INTELLIGENCE.md](./PHASE-21-EMOTIONAL-INTELLIGENCE.md) |
| 22 | [PHASE-22-AUTONOMOUS-MISSION.md](./PHASE-22-AUTONOMOUS-MISSION.md) |
| 23 | [PHASE-23-HARDWARE-BRIDGE.md](./PHASE-23-HARDWARE-BRIDGE.md) |
| 24 | [PHASE-24-SELF-IMPROVEMENT.md](./PHASE-24-SELF-IMPROVEMENT.md) |
| 25 | [PHASE-25-DIGITAL-TWIN.md](./PHASE-25-DIGITAL-TWIN.md) |
| 26 | [PHASE-26-IRON-LEGION.md](./PHASE-26-IRON-LEGION.md) |
| 27 | [PHASE-27-CROSS-DEVICE.md](./PHASE-27-CROSS-DEVICE.md) |
