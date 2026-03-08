# Changelog

All notable changes to EDITH are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [2.0.0] — 2026-03-09

### Added — Phases 28–45

- **Phase 28 — Multi-Agent Coordination:** Agent mesh, role assignment, shared task queue
- **Phase 29 — Knowledge Base:** Structured knowledge ingestion, semantic search over docs
- **Phase 30 — Browser Automation:** Playwright-backed web interaction from natural language
- **Phase 31 — Mobile Companion:** Push notifications, mobile-aware response formatting
- **Phase 32 — Emotion Engine:** Sentiment tracking, adaptive tone modulation per conversation
- **Phase 33 — Mission Planner:** Long-horizon goal decomposition, progress tracking
- **Phase 34 — Desktop Integration:** System tray, global hotkey, clipboard awareness
- **Phase 35 — Advanced Security:** Enhanced CaMeL guard, prompt injection hardening
- **Phase 36 — Plugin SDK:** `src/plugin-sdk/` — BaseChannelExtension, BaseToolExtension interfaces
- **Phase 37 — MCP Server:** Model Context Protocol server (`edith mcp serve`) with `ask_edith` + `search_memory` tools
- **Phase 38 — Link Understanding:** URL extraction, summary, metadata enrichment
- **Phase 39 — Media Understanding:** Audio/video/image transcription and captioning pipeline
- **Phase 40 — Permissions System:** Fine-grained capability permissions per user/channel
- **Phase 41 — ACP (Agent Communication Protocol):** Structured inter-agent message format
- **Phase 42 — Auto-Reply Rules:** Configurable trigger/response rules for offline periods
- **Phase 43 — Production Hardening:** SQLite WAL mode, Prometheus metrics, transactional outbox, LRU session cap
- **Phase 44 — Daemon Manager:** Cross-platform service install (launchd/systemd/schtasks)
- **Phase 45 — Documentation Suite:** CONTRIBUTING, SECURITY, CHANGELOG, API docs, channel guides, testing guide

---

## [1.0.0] — 2025-09-01

### Added — Phases 23–27 (Hardware + Distribution)

- **Phase 23 — Hardware Bridge:** Serial, DDC, LED, relay, OctoPrint drivers; desk controller; sensor automation
- **Phase 24 — Self-Improvement:** Quality tracker, prompt versioning, pattern detector, skill creator, gap detector, weekly learning reports
- **Phase 25 — Digital Twin:** Action classifier, preview engine, virtual filesystem diff, sandbox engine, snapshot/rollback
- **Phase 26 — Iron Legion:** Multi-instance EDITH collaboration, CRDT shared knowledge, team mode, access control, legion dashboard
- **Phase 27 — Cross-Device Mesh:** Device pairing, QR generator, presence manager, conversation sync, session handoff, memory sync, P2P gateway

### Changed

- `prisma/schema.prisma` — added FeedbackRecord, PromptVersionRecord, ActionSnapshotRecord, LegionInstance, PairedDevice, GatewayPeer models
- `src/core/startup.ts` — wired hardware scan, peer discovery, cross-device mesh initialization

---

## [0.5.0] — 2025-03-01

### Added — Phases 11–22 (Advanced AI Features)

- **Phase 11 — Multi-Agent:** LLM-backed agent delegation, LATS planner refinements
- **Phase 12 — Knowledge Base v1:** Vector + FTS5 hybrid retrieval, document ingestion
- **Phase 13 — Browser Use:** Computer-use agent with Playwright integration
- **Phase 14 — Mobile:** Expo push notification support, mobile-optimized responses
- **Phase 15 — Emotion:** Per-user sentiment history, mood-aware tone selection
- **Phase 16 — Mission:** Goal graph, milestone tracking, daily agenda assembly
- **Phase 17 — Desktop:** System tray (systray), clipboard monitor, global hotkey (iohook)
- **Phase 18 — Security Hardening:** Output scanner, enhanced prompt filter, audit logging
- **Phase 19 — HUD Overlay:** Transparent on-screen status overlay
- **Phase 20 — Multi-user:** User switching, per-user memory and preferences
- **Phase 21 — Advanced Memory:** Causal graph, episodic memory, MemRL Q-learning
- **Phase 22 — Offline Mode:** OfflineCoordinator, LocalEmbedder, Kokoro TTS stub, WhisperCpp STT stub

### Changed

- Orchestrator expanded with 50+ model catalog and ModelInfo metadata
- CLI enhanced with rich ASCII banner and colored onboard/doctor commands

---

## [0.1.0] — 2024-09-01

### Added — Phases OC0–OC12 + Phases 1–10 (Foundation)

- **OpenClaw Foundation (OC0–OC12):** Bootstrap, skills loader, session store, gateway HTTP/WS server, Fastify setup
- **Phase 1 — Voice Pipeline:** VoiceBridge STT/TTS orchestration, Kokoro TTS Python sidecar, Whisper STT
- **Phase 2 — Tests:** Vitest configuration, initial test suite coverage
- **Phase 3 — Vision:** Vision pipeline, Gemini/OpenAI/Claude/Ollama vision providers, Python vision processor
- **Phase 4 — IoT:** System tool integration (`agents/tools/system.ts`), device control stubs
- **Phase 5 — Security:** Prompt filter, output scanner, initial CaMeL guard
- **Phase 6 — Advanced Features:** CaMeL taint tracking, MemRL Q-learning (IEU triplets, Bellman update), background daemon, proactive triggers
- **Phase 7 — Computer Use:** LATS planner (`src/agents/lats-planner.ts`), tool execution framework
- **Phase 8 — Channels:** Telegram, Discord, WhatsApp, webchat; email/calendar/SMS/phone stubs
- **Phase 9 — Offline Planning:** Architecture for offline/self-hosted operation
- **Phase 10 — Personalization:** UserPreferenceEngine, PersonalityEngine, FeedbackStore, HabitModel, AdaptiveQuietHours

### Infrastructure

- TypeScript ESM project with strict mode
- Prisma + SQLite for persistent storage
- LanceDB for vector memory
- Python sidecar communication via stdio
- `edith.json` runtime configuration
- `workspace/SOUL.md`, `AGENTS.md`, `USER.md`, `MEMORY.md` identity files

---

[Unreleased]: https://github.com/maxvyquincy9393/orion/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/maxvyquincy9393/orion/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/maxvyquincy9393/orion/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/maxvyquincy9393/orion/compare/v0.1.0...v0.5.0
[0.1.0]: https://github.com/maxvyquincy9393/orion/releases/tag/v0.1.0
