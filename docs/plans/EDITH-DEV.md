# EDITH-DEV — Development Roadmap & Competitive Analysis

> **Panduan ini adalah kompas eksekusi jangka panjang EDITH.**
> Baca `CLAUDE.md` untuk arsitektur saat ini. Dokumen ini adalah tentang ke mana kita pergi.

---

## Filosofi: Dari Reactive → Ambient Intelligence

```
CHATBOT (sekarang)              JARVIS (target)
────────────────────────────────────────────────
User asks → AI responds         AI monitors → proactively acts
Stateless per session           Persistent memory across lifetime
Text only                       Voice + Vision + Sensor + Biometric
Waits for commands              Anticipates needs
Manual setup                    Self-configuring
Single device                   Mesh across all devices
```

JARVIS bukan chatbot — dia adalah *ambient intelligence*. Selalu berjalan, selalu sadar konteks, bertindak tanpa diminta. Ini target sesungguhnya EDITH.

---

## Scorecard: EDITH vs OpenClaw (sekarang)

| Dimensi | OpenClaw | EDITH | Winner |
|---|---|---|---|
| Infrastruktur & DX | 8/10 | 4/10 | OpenClaw |
| Security Depth | 9/10 | 6/10 | OpenClaw |
| AI Intelligence | 4/10 | 9/10 | **EDITH** |
| Memory System | 2/10 | 10/10 | **EDITH** |
| Channels & Reach | 9/10 | 7/10 | OpenClaw |
| Agent Capabilities | 3/10 | 9/10 | **EDITH** |
| Self-Improvement | 0/10 | 9/10 | **EDITH** |
| JARVIS Features | 0/10 | 4/10 | **EDITH** |
| Deployment | 9/10 | 5/10 | OpenClaw |
| Documentation | 8/10 | 2/10 | OpenClaw |

**Target setelah roadmap ini selesai: semua kategori 9–10/10.**

---

## Perbandingan Modul File-per-File

### Security — Gap Paling Kritis

OpenClaw punya 25+ files (~350KB) security. EDITH punya 9 files (~80KB).

**OpenClaw punya (EDITH belum):**

| File | Ukuran | Fungsi |
|---|---|---|
| `audit.ts` | 46KB | Immutable audit trail engine |
| `audit-extra.sync.ts` | 48KB | Synchronous audit extras |
| `audit-extra.async.ts` | 47KB | Async audit pipeline |
| `audit-channel.ts` | 29KB | Per-channel audit records |
| `skill-scanner.ts` | 15KB | Scan skills untuk malicious code |
| `fix.ts` | 14KB | Auto-apply security fixes |
| `dm-policy-shared.ts` | 12KB | DM permission policies |
| `external-content.ts` | 11KB | External content risk analysis |
| `windows-acl.ts` | 11KB | Windows ACL permission system |
| `safe-regex.ts` | 9KB | ReDoS-safe regex execution |
| `dangerous-tools.ts` | 1.3KB | Dangerous tool blocklist |
| `secret-equal.ts` | 407B | Timing-safe secret comparison |

**EDITH punya yang OpenClaw tidak punya (pertahankan):**
- `camel-guard.ts` — CaMeL taint tracking ★
- `dual-agent-reviewer.ts` — Adversarial review ★
- `memory-validator.ts` — Memory validation ★
- `escalation-tracker.ts` — Incident tracking ★
- `affordance-checker.ts` — Capability permission ★

---

### Hooks System — OpenClaw Jauh Lebih Dalam

OpenClaw punya 30+ files — full lifecycle hook engine, bukan sekedar event bus.

Hook types OpenClaw: `before_message`, `after_message`, `before_tool_call`, `after_tool_call`, `on_error`, `on_recovery`, `on_install`, `on_uninstall`, `on_gmail_message`, `on_session_start`, `on_session_end`, custom hook via frontmatter.

EDITH saat ini: hanya `src/core/event-bus.ts` (pub/sub sederhana) + `src/background/triggers.ts`.

---

### Routing — OpenClaw Sangat Sophisticated

OpenClaw `resolve-route.ts` = 23KB. Menangani: multi-account routing, quota management, API key rotation otomatis saat quota habis, capability matching (channel butuh vision → route ke provider yang support vision).

EDITH `src/engines/orchestrator.ts` bagus untuk TaskType routing, tapi belum punya multi-account key rotation, per-channel capability matching, atau quota auto-rotation.

---

### Providers — OpenClaw Punya GitHub Copilot (GRATIS)

OpenClaw mendukung GitHub Copilot sebagai free LLM backend. EDITH tidak punya ini.

OpenClaw providers yang belum ada di EDITH: `github-copilot`, `qwen` (Alibaba), `kilocode`, `deepseek`, `mistral`, `together`, `fireworks`.

---

### Memory — EDITH Menang Telak

EDITH punya 18+ files dengan: LanceDB vector (768-dim), MemRL Q-learning, causal graph, episodic memory, temporal index, hybrid vector+FTS5 retrieval, preference sliders, cross-device sync, knowledge base.

OpenClaw: file-based session storage saja. Tidak ada vector DB, tidak ada MemRL, tidak ada causal graph.

**EDITH menang — tidak ada yang perlu ditambahkan dari OpenClaw di sini.**

---

### Agents — EDITH Menang Telak

EDITH punya LATS tree search, Legion multi-instance CRDT, specialized agents. OpenClaw punya basic agent runner saja.

**EDITH menang — tidak ada yang perlu ditambahkan dari OpenClaw di sini.**

---

## Roadmap Eksekusi

---

### TIER 1 — OpenClaw Parity 🔴

Ini yang harus selesai sebelum EDITH bisa disebut "production-ready".

#### T1.1 — Security Hardening

```
src/security/
  audit.ts              ← immutable audit trail (CRITICAL)
  audit-channel.ts      ← per-channel audit records
  skill-scanner.ts      ← scan skills/extensions untuk malicious code
  fix.ts                ← auto-apply security patches
  dm-policy.ts          ← DM permission policy (siapa bisa DM bot)
  external-content.ts   ← analyze external URLs/content sebelum fetch
  windows-acl.ts        ← Windows filesystem permission hardening
  safe-regex.ts         ← ReDoS protection
  secret-equal.ts       ← timing-safe comparisons
  dangerous-tools.ts    ← dangerous tool blocklist
```

#### T1.2 — Hook Lifecycle Engine

```
src/hooks/
  registry.ts           ← hook registration + discovery
  loader.ts             ← dynamic hook loading + hot reload
  lifecycle.ts          ← install/uninstall lifecycle
  runner.ts             ← hook execution engine
  frontmatter.ts        ← hook metadata (YAML frontmatter)
  types.ts              ← HookManifest, HookEvent, HookResult
  bundled/
    gmail.ts            ← Gmail message hook
    calendar.ts         ← Calendar event hook
    github.ts           ← GitHub webhook hook
    cron.ts             ← Scheduled hook
    health.ts           ← Health check hook
```

#### T1.3 — Routing Upgrade

```
src/routing/
  resolve-route.ts      ← capability-aware + quota-aware routing
  multi-account.ts      ← multiple API key rotation
  quota-tracker.ts      ← per-provider quota tracking
  bindings.ts           ← channel ↔ provider bindings
```

#### T1.4 — Provider Expansion

```
src/engines/
  github-copilot.ts     ← GitHub Copilot (FREE!) provider
  qwen.ts               ← Qwen/Alibaba Cloud
  deepseek.ts           ← DeepSeek
  mistral.ts            ← Mistral AI
  together.ts           ← Together AI
  fireworks.ts          ← Fireworks AI
```

#### T1.5 — Cross-Platform Daemon

```
src/daemon/
  launchd.ts            ← macOS: ~/Library/LaunchAgents/ai.edith.plist
  systemd.ts            ← Linux: ~/.config/systemd/user/edith.service
  schtasks.ts           ← Windows: Task Scheduler
  service.ts            ← unified: install/uninstall/status/restart/logs
  runtime-paths.ts      ← XDG / AppData / ~/Library

# CLI commands:
edith daemon install    ← auto-detect OS, install service
edith daemon uninstall
edith daemon status
edith daemon logs
edith daemon restart
```

#### T1.6 — Auto-Reply Pipeline (Refactor)

```
src/auto-reply/
  envelope.ts           ← unified message metadata
  inbound.ts            ← classifier + router
  outbound.ts           ← formatter + chunker (per-channel limits)
  command-router.ts     ← slash command dispatch
  command-auth.ts       ← permission per command
  commands-registry.ts  ← dynamic command registration
  heartbeat.ts          ← per-channel keepalive
  thinking.ts           ← streaming extended thinking state
  chunk.ts              ← Telegram 4096 / Discord 2000 char split
```

#### T1.7 — Context Window Engine

```
src/context-engine/
  registry.ts           ← per-user context registry
  window-manager.ts     ← token budget (model-aware)
  compressor.ts         ← summarize when context overflows
  priority-scorer.ts    ← rank which context to keep
```

#### T1.8 — Link Understanding

```
src/link-understanding/
  detect.ts             ← regex + heuristic URL extraction
  fetch.ts              ← safe fetch (timeout + size limit)
  format.ts             ← title + description + content untuk LLM
  runner.ts             ← orchestrator
```

#### T1.9 — Media Understanding (Expand dari vision/)

```
src/media-understanding/
  audio.ts              ← transcription + speaker diarization
  video.ts              ← frame extraction + scene analysis
  document.ts           ← PDF/DOCX/XLSX/CSV parsing
  image.ts              ← extend existing vision/
  attachments.ts        ← unified attachment handler
  providers/            ← anthropic / openai / gemini / ollama
```

#### T1.10 — Secrets Management

```
src/secrets/
  store.ts              ← AES-256-GCM encrypted secrets at rest
  keychain.ts           ← OS keychain (macOS Keychain / Windows Credential Manager)
  resolve.ts            ← ${SECRET:KEY} placeholder resolution
  audit.ts              ← access log (CaMeL integration)
  rotate.ts             ← key rotation dengan zero downtime
```

#### T1.11 — Dedicated TTS Module

```
src/tts/
  tts-core.ts           ← abstract TTS interface
  prepare-text.ts       ← SSML + text cleaning
  emotion-mapper.ts     ← map EDITH emotion → TTS tone
  providers/
    kokoro.ts           ← offline (extract dari voice/bridge.ts)
    elevenlabs.ts
    fish-audio.ts
    edge-tts.ts
```

#### T1.12 — Terminal UI System

```
src/tui/
  components/
    spinner.ts          ← animated (extend dari banner.ts)
    table.ts            ← ANSI-safe table
    progress.ts         ← progress bar
    box.ts              ← bordered box
    tree.ts             ← hierarchical display
  theme/
    palette.ts          ← extract warna dari banner.ts
    icons.ts            ← status icons
  stream-assembler.ts   ← streaming LLM → terminal
  formatters.ts         ← markdown → terminal rendering
  gateway-chat.ts       ← local TUI chat mode
```

#### T1.13 — i18n

```
src/i18n/
  locales/
    en.json
    id.json             ← Bahasa Indonesia (rumah EDITH!)
    zh-CN.json
    ja.json
```

#### T1.14 — Extension Package System

```
extensions/
  @edith/ext-zalo/
  @edith/ext-matrix/
  @edith/ext-notion/
  @edith/ext-obsidian/
  @edith/ext-github/
  @edith/ext-linear/
  @edith/ext-home-assistant/
  @edith/ext-openhue/
  @edith/ext-voice-call/
  @edith/ext-spotify/
  @edith/ext-otel/

# pnpm-workspace.yaml:
packages:
  - 'extensions/*'
  - 'packages/*'
```

#### T1.15 — Skills Expansion (10 → 55+)

```
workspace/skills/
  # Produktivitas
  apple-notes/     apple-reminders/    todoist/
  notion/          obsidian/           calendar-intel/

  # Development
  github/          jira/               linear/
  gitlab/          coding-agent/       terminal-bridge/

  # Entertainment
  spotify/         youtube/            weather/

  # EDITH Exclusive
  self-improve/    simulation/         legion-delegate/
  memory-audit/    hardware-control/   mission-control/
```

#### T1.16 — CLI Expansion

```bash
# Config
edith config get/set/list/reset

# Channels
edith channels list
edith channels status --probe
edith channels enable/disable <channel>

# Skills & Extensions
edith skills list/install/remove
edith extensions list/install/enable/disable

# Maintenance
edith --version          # "1.0.0 (abc1234)"
edith backup
edith restore <file>
edith upgrade
```

#### T1.17 — Session Improvements

```
src/sessions/
  model-overrides.ts    ← per-session model switching mid-conversation
  level-overrides.ts    ← per-session capability level toggling
  session-label.ts      ← human-readable session labels
```

#### T1.18 — Dev Tooling

```
.oxlintrc.json              ← Oxlint (faster than ESLint)
.oxfmtrc.jsonc              ← Oxfmt
.shellcheckrc               ← shell script linting
.markdownlint-cli2.jsonc    ← markdown linting
zizmor.yml                  ← GitHub Actions security audit
.pre-commit-config.yaml     ← hooks: oxlint + detect-secrets + shellcheck
.detect-secrets.cfg         ← secret pattern config
tsdown.config.ts            ← replace tsup (faster, better tree-shaking)
.vscode/launch.json         ← debug configurations
```

#### T1.19 — Testing Architecture Split

```
vitest.unit.config.ts           ← unit only (fast, no I/O)
vitest.channels.config.ts       ← channel integration tests
vitest.e2e.config.ts            ← E2E (Docker, real services)
vitest.live.config.ts           ← live API tests (LIVE=1 pnpm test:live)
vitest.gateway.config.ts        ← gateway-specific
vitest.extensions.config.ts     ← extension tests
```

#### T1.20 — Deploy Infrastructure

```
fly.toml                    ← Fly.io (public instance)
fly.private.toml            ← Fly.io (private/authenticated)
render.yaml                 ← Render.com
Dockerfile.sandbox          ← isolated code execution sandbox
docker-compose.dev.yml      ← development override
setup-podman.sh             ← Podman alternative
scripts/committer           ← scoped git staging
scripts/release-check.ts    ← pre-release validation
appcast.xml                 ← Sparkle auto-update (macOS)
```

#### T1.21 — Documentation Gap

```
CONTRIBUTING.md     SECURITY.md     VISION.md     CHANGELOG.md

docs/
  channels/             ← per-channel setup guide
  extensions/           ← how to build extensions
  skills/               ← how to build skills
  api/                  ← REST API reference
  testing.md            ← full testing guide
  platforms/
    linux.md   macos.md   windows.md   raspberry-pi.md
  reference/
    RELEASING.md        ← release process
    environment.md      ← all env vars reference

.github/
  ISSUE_TEMPLATE/bug_report.md
  ISSUE_TEMPLATE/feature_request.md
  pull_request_template.md
  labeler.yml
```

---

### TIER 2 — JARVIS Capabilities 🟡

Yang belum ada di OpenClaw maupun EDITH saat ini. Pure JARVIS territory.

#### Phase 28 — Morning Protocol & Situational Awareness

```
src/protocols/
  morning-briefing.ts   ← "Good morning. 3 meetings, 2 priority emails,
                           BTC +3%, rain at 14:00, sleep score: 72%"
  situation-report.ts   ← on-demand situational summary
  ambient-monitor.ts    ← background polling (weather/news/calendar/health)
  briefing-scheduler.ts ← configure when briefings fire
  evening-summary.ts    ← daily recap + tomorrow prep
```

#### Phase 29 — Biometric & Health Integration

```
src/health/
  biometric-monitor.ts  ← Apple Health / Google Fit / Fitbit / Garmin
  wearable-bridge.ts    ← Apple Watch / Wear OS WebSocket bridge
  stress-detector.ts    ← HRV → stress level inference
  sleep-tracker.ts      ← sleep quality → energy level
  activity-tracker.ts   ← movement patterns
  health-alerts.ts      ← "You haven't moved in 2 hours"
  medication-reminder.ts
```

EDITH harus tahu kapan kamu lelah, stress, atau sakit — tanpa kamu bilang.

#### Phase 30 — Full Smart Home Intelligence

```
src/smart-home/
  hub.ts                ← unified hub (Home Assistant / HomeKit / Google Home)
  device-discovery.ts   ← auto-discover smart devices
  automations.ts        ← if-this-then-that rules engine
  scenes.ts             ← "Workshop Mode", "Sleep Mode", "Focus Mode"
  energy-monitor.ts     ← real-time energy usage
  security-cam.ts       ← camera feed analysis
  doorbell.ts           ← smart doorbell integration
  climate.ts            ← AC/heater intelligence
  presence-detector.ts  ← who is home detection
```

#### Phase 31 — Ambient Intelligence & Proactive Research

```
src/ambient/
  news-curator.ts       ← curated news based on interests + work context
  market-monitor.ts     ← stocks / crypto / forex alerts
  weather-monitor.ts    ← hyperlocal weather awareness
  calendar-watcher.ts   ← meeting prep 15min before
  flight-tracker.ts     ← track flights you care about
  package-tracker.ts    ← shipping tracking
  threat-scanner.ts     ← cybersecurity threat feeds
  research-queue.ts     ← background research on topics you mention
```

#### Phase 32 — Communication Intelligence

```
src/comm-intel/
  screener.ts           ← priority scoring for all incoming messages
  relationship-graph.ts ← who knows who, relationship strength
  contact-enricher.ts   ← enrich contacts with public info
  draft-assistant.ts    ← suggest reply drafts
  meeting-prep.ts       ← prep briefing before every meeting
  follow-up-tracker.ts  ← "You haven't replied to John in 3 days"
  sentiment-monitor.ts  ← track emotional tone of conversations
```

#### Phase 33 — Financial Intelligence

```
src/finance/
  expense-tracker.ts    ← parse receipts/invoices automatically
  budget-monitor.ts     ← spending alerts
  crypto-portfolio.ts   ← real-time portfolio tracking
  invoice-parser.ts     ← extract data from invoices (vision-powered)
  subscription-audit.ts ← find forgotten subscriptions
  net-worth-tracker.ts  ← aggregate across accounts
```

#### Phase 34 — Emergency & Safety Protocols

```
src/safety/
  emergency-protocols.ts  ← "If I don't check in by X, do Y"
  panic-mode.ts           ← emergency mode (notify contacts, lock systems)
  dead-mans-switch.ts     ← automated actions if user is unreachable
  anomaly-detector.ts     ← detect unusual patterns
  security-audit.ts       ← audit all connected systems
```

#### Phase 35 — JARVIS HUD

```
src/hud/
  desktop-widget.ts     ← always-on desktop widget (Tauri-based)
  ambient-display.ts    ← minimal ambient info (time/weather/status)
  status-bar.ts         ← menubar/taskbar integration
  notification-engine.ts ← smart notifications (not spam)
```

#### Phase 36 — Predictive Intelligence

```
src/predictive/
  intent-predictor.ts   ← predict next request from context
  pre-fetcher.ts        ← fetch data before user asks
  pattern-learner.ts    ← learn daily/weekly patterns
  suggestion-engine.ts  ← proactively suggest actions
  anticipation-queue.ts ← queue of anticipated needs
```

JARVIS selalu siap sebelum Tony bertanya. EDITH harus begitu juga.

#### Phase 37 — Workshop / Developer Mode

```
src/workshop/
  hands-free.ts         ← voice-first mode for coding
  screen-reader.ts      ← understand what's on screen (vision)
  code-monitor.ts       ← monitor build/test status background
  error-explainer.ts    ← auto-explain build errors
  diff-analyzer.ts      ← understand code changes
  debug-assistant.ts    ← help debug while you work
```

#### Phase 38 — Wake Word & Always-On Voice

```
src/voice/
  wake-word.ts          ← "Hey EDITH" local detection
  always-on.ts          ← continuous listening mode (opt-in)
  voice-activity.ts     ← VAD (Voice Activity Detection)
  noise-cancel.ts       ← background noise filtering
  multi-speaker.ts      ← extend speaker-id.ts (who is speaking?)
  voice-commands.ts     ← voice-only command set
```

#### Phase 39 — Relationship & Network Intelligence

```
src/intelligence/
  network-mapper.ts      ← map people/org relationship graph
  entity-tracker.ts      ← track entities over time (people, companies)
  sentiment-history.ts   ← emotional arc of relationships
  connection-suggester.ts ← "You should reconnect with X"
  topic-clusterer.ts     ← cluster conversations by topic
```

#### Phase 40 — Real-time Translation & Multilingual

```
src/translation/
  real-time.ts           ← live translation in conversation
  language-detector.ts   ← auto-detect language
  cultural-adapter.ts    ← cultural context adaptation
  terminology-glossary.ts ← personal/domain glossary
```

---

### TIER 3 — Beyond Both OpenClaw & JARVIS 🟢

Pioneer territory — ini yang belum pernah ada di sistem manapun.

#### API Layer Baru (EDITH sebagai AI server)

```
src/api/
  openai-compat/
    chat-completions.ts   ← POST /v1/chat/completions
    models.ts             ← GET /v1/models
    embeddings.ts         ← POST /v1/embeddings
  mcp-server/
    server.ts             ← EDITH sebagai MCP server
    tools.ts              ← expose tools ke MCP clients
    resources.ts          ← expose memory, files, knowledge
  webhooks/
    handler.ts            ← incoming webhooks
    dispatcher.ts         ← outgoing webhooks on events
    signature.ts          ← HMAC verification
  openapi/
    spec.ts               ← auto-generate OpenAPI 3.1
    swagger-ui.ts         ← serve /api/docs
  metrics/
    endpoint.ts           ← GET /metrics (Prometheus)
```

Any tool that talks to OpenAI can talk to EDITH instead.
Claude Code bisa pakai EDITH sebagai MCP server.

#### Memory Palace

```
src/memory/
  palace.ts             ← spatial/visual memory organization
  timeline.ts           ← chronological memory browsing
  graph-visualizer.ts   ← visualize causal graph
  memory-api.ts         ← REST API untuk browse/edit memories
```

#### Autonomous Task Queue

```
src/autonomy/
  task-queue.ts         ← background task queue
  goal-tracker.ts       ← track long-running goals
  milestone-detector.ts ← detect when goals are achieved
  initiative-engine.ts  ← decide when to act without being asked
  constraint-checker.ts ← verify action is within boundaries (CaMeL)
```

#### Tauri Desktop App (JARVIS HUD)

```
apps/desktop/
  src-tauri/
    main.rs             ← system tray + window management
    plugins/            ← OS integration
  src/
    components/
      HUD.tsx           ← ambient HUD overlay
      Chat.tsx          ← chat interface
      Dashboard.tsx     ← system status
      MemoryBrowser.tsx ← browse memories
```

#### Mobile Companion Apps

```
apps/ios/               ← Swift/SwiftUI
  VoiceInterface.swift  ← talk to EDITH hands-free
  HUD.swift             ← Apple Watch companion

apps/android/           ← Kotlin
  VoiceService.kt

apps/watch/             ← Apple Watch / Wear OS
  complication/         ← watch face complication
```

---

## Total Scope

| Tier | Area | Est. Files Baru | Priority |
|---|---|---|---|
| Tier 1 — OpenClaw Parity | 21 areas | ~200 files | 🔴 Segera |
| Tier 2 — JARVIS Capabilities | Phase 28–40 | ~180 files | 🟡 Sprint 3–6 |
| Tier 3 — Beyond Both | 5 areas | ~120 files | 🟢 Sprint 7+ |
| **Total** | **40 areas** | **~500 files** | |

Zero breaking changes. Semua Tier 1 bisa dikerjakan paralel per modul.

---

## Sprint Roadmap

```
Sprint 1 (Minggu 1–2)   → T1: Security + Hooks + Routing + Providers
Sprint 2 (Minggu 3–4)   → T1: Daemon + CLI + Auto-reply + Context engine
Sprint 3 (Minggu 5–6)   → T1: Media + Secrets + TTS + TUI + i18n
Sprint 4 (Minggu 7–8)   → T1: Extensions + Skills + Dev tooling + Testing
Sprint 5 (Minggu 9–10)  → T1: Deploy + Docs + Session improvements
Sprint 6 (Minggu 11–12) → T2: Morning protocol + Biometric + Smart home + Ambient
Sprint 7 (Minggu 13–14) → T2: Comm intel + Finance + Safety + HUD + Predictive
Sprint 8 (Minggu 15–16) → T2: Workshop + Wake word + Relationship + Translation
Sprint 9 (Minggu 17–18) → T3: OpenAI API + MCP server + Memory palace + Autonomy
Sprint 10+              → T3: Tauri desktop app + Mobile iOS/Android + Watch app
```

---

## Catatan Penting

**Apa yang harus JANGAN diubah:**

EDITH sudah lebih baik dari OpenClaw di memory, agents, dan AI intelligence. Jangan hapus atau simplify:
- `src/memory/memrl.ts` — MemRL Q-learning adalah keunggulan terbesar EDITH
- `src/memory/causal-graph.ts` — graph memory tidak ada di OpenClaw
- `src/agents/legion/` — multi-instance CRDT tidak ada di OpenClaw
- `src/security/camel-guard.ts` — taint tracking lebih canggih dari OpenClaw
- `src/self-improve/` — OpenClaw tidak punya self-improvement sama sekali
- `src/simulation/` — digital twin tidak ada di OpenClaw

**Konvensi kode yang harus diikuti:**
- Semua TS harus ada JSDoc + strict typing + `.js` imports
- Gunakan `createLogger("module.name")` dari `src/logger.ts`
- Tambah env vars baru di `src/config.ts` (Zod schema), bukan hardcode
- Test di `__tests__/` per modul, jalankan `pnpm typecheck` sebelum commit
