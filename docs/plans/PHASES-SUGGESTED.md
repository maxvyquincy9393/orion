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
