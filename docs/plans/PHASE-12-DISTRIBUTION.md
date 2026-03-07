# Phase 12 — Distribution, Packaging & Auto-Update

**Prioritas:** 🟢 MEDIUM (becomes HIGH when ready to share/use daily)
**Depends on:** Phase 5 (bug fixes), Phase 9 (offline mode) — should be stable before packaging
**Status Saat Ini:** Electron shell ✅ | electron-builder setup ✅ | Manual install ❌ | Auto-updater ❌ | Onboarding wizard (partial) ✅ | OOBE complete ❌

---

## 1. Tujuan

Jadikan EDITH dapat di-install dengan **satu klik** di Windows, macOS, dan Linux — dan bisa **auto-update** tanpa user harus manual download. Plus first-run experience (OOBE) yang smooth untuk setup awal.

```mermaid
flowchart TD
    subgraph Distribution["📦 Distribution Targets"]
        W["🪟 Windows\nNSIS installer (.exe)\nMSIX package (.msix)\nPortable (.zip)"]
        M["🍎 macOS\nDMG (.dmg)\nNotarized + Signed\nBrew Cask (future)"]
        L["🐧 Linux\nAppImage\ndeb / rpm\nSnap / Flatpak"]
    end

    subgraph AutoUpdate["🔄 Auto-Update Channel"]
        GH["GitHub Releases\n(primary update source)\nFree, reliable"]
        S3["S3 / R2 bucket\n(optional self-hosted\nupdate server)"]
    end

    Build["pnpm build\nelectron-builder"] --> Distribution
    Distribution --> AutoUpdate
```

---

## 2. Sub-Phase Breakdown

```mermaid
flowchart LR
    A["12A\nBuild Pipeline\n(CI/CD, cross-platform)"]
    B["12B\nOOBE\n(first-run wizard)"]
    C["12C\nAuto-updater\n(electron-updater)"]
    D["12D\nSystem Tray\n& Autostart"]
    E["12E\nCrash Reporting\n& Telemetry (opt-in)"]
    F["12F\nDocker Mode\n(headless server)"]

    A --> B --> C
    A --> D
    C --> E
    B --> F
```

---

### Phase 12A — Build Pipeline

**Goal:** One-command cross-platform build + GitHub Actions CI that auto-publishes on tag push.

```mermaid
gitGraph
    commit id: "feature work"
    commit id: "fix bug"
    branch release/v1.0.0
    commit id: "bump version"
    commit id: "tag v1.0.0"
    checkout main
    merge release/v1.0.0 id: "release"
```

**GitHub Actions workflow (`.github/workflows/release.yml`):**
```yaml
on:
  push:
    tags: ['v*']

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - pnpm install
      - pnpm run build:ts
      - electron-builder --win --publish always

  build-mac:
    runs-on: macos-latest
    steps:
      - pnpm install
      - pnpm run build:ts
      - electron-builder --mac --publish always
      # notarize via APPLE_ID + APPLE_TEAM_ID secrets

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - pnpm install
      - pnpm run build:ts
      - electron-builder --linux --publish always
```

**`electron-builder.json` config (in `apps/desktop/`):**
```json
{
  "appId": "ai.edith.desktop",
  "productName": "EDITH",
  "publish": {
    "provider": "github",
    "owner": "your-github-username",
    "repo": "EDITH"
  },
  "win": {
    "target": ["nsis", "portable"],
    "icon": "assets/icon.ico"
  },
  "mac": {
    "target": ["dmg"],
    "icon": "assets/icon.icns",
    "notarize": true
  },
  "linux": {
    "target": ["AppImage", "deb"],
    "icon": "assets/icon.png"
  },
  "extraResources": [
    { "from": "../../EDITH-ts/dist/", "to": "engine/" },
    { "from": "../../EDITH-ts/python/", "to": "python/" },
    { "from": "../../EDITH-ts/models/", "to": "models/" }
  ]
}
```

---

### Phase 12B — OOBE (Out-of-Box Experience)

**Goal:** First-run wizard yang membimbing user setup EDITH dari nol ke fully functional.

```mermaid
flowchart TD
    Start["🚀 First Launch\n(no edith.json)"]

    subgraph Wizard["📋 Setup Wizard (existing HTML wizard, extend it)"]
        W1["Step 1: Welcome\n'I am EDITH. Let me help you set up.'"]
        W2["Step 2: LLM Provider\nAuto-detect Ollama → test Groq → test OpenAI\n(with provider test buttons)"]
        W3["Step 3: Voice Setup\nTest microphone → say 'Hey EDITH'\ntest TTS output"]
        W4["Step 4: Channels\n(optional) connect Telegram / Discord / WhatsApp"]
        W5["Step 5: Personality\nChoose tone + name preference\n'What shall I call you?'"]
        W6["Step 6: Complete\n'All systems are operational, Sir.'"]
    end

    Start --> W1 --> W2 --> W3 --> W4 --> W5 --> W6

    W6 --> Save["Write edith.json\n(gitignored config)"]
    Save --> Launch["🟢 EDITH starts\nwith chosen config"]
```

**Voice-guided OOBE:**
- Every step narrated by EDITH via TTS (using Edge TTS as default before user TTS prefs are set)
- User can respond by voice OR mouse/keyboard
- Wizard detects if Ollama is running locally and auto-suggests it as primary LLM

**edith.json written by OOBE:**
```json
{
  "_setupComplete": true,
  "_setupVersion": "1.0.0",
  "personality": { "titleWord": "Sir" },
  "llm": { "provider": "groq", "model": "groq/llama-3.3-70b-versatile" },
  "voice": { "enabled": true, "tts": { "engine": "edge" } },
  "env": { "GROQ_API_KEY": "user entered key" }
}
```

---

### Phase 12C — Auto-Updater

**Goal:** EDITH checks for updates silently in background, notifies user, updates on next restart (or immediately if user agrees).

```mermaid
sequenceDiagram
    participant EDITH
    participant GH as GitHub Releases API
    participant User

    Note over EDITH: App starts
    EDITH->>GH: GET /releases/latest
    GH-->>EDITH: { tag: "v1.2.0", assets: [...] }

    alt newer version available
        EDITH->>User: "Sir, EDITH v1.2.0 is available.\n'3 improvements, 2 bug fixes.'\nUpdate now or later?"
        User->>EDITH: "Update later"
        Note over EDITH: Downloads in background
        EDITH->>User: "Update ready. Will apply on next restart."
    end
```

**Implementation:** `electron-updater` (already a dependency pattern in electron-builder ecosystem)

```typescript
// apps/desktop/main.js — add to existing
import { autoUpdater } from 'electron-updater'

autoUpdater.autoDownload = true
autoUpdater.checkForUpdatesAndNotify()

autoUpdater.on('update-available', (info) => {
  edithCore.speak(`EDITH version ${info.version} is available.`)
})
autoUpdater.on('update-downloaded', () => {
  edithCore.speak('Update ready. Restart to apply.')
})
```

**Self-hosted update server alternative:**
```json
{
  "publish": {
    "provider": "generic",
    "url": "http://your-nas-or-server/edith-updates/"
  }
}
```
User dapat host update server sendiri di NAS/VPS — fully self-hosted update pipeline.

---

### Phase 12D — System Tray & Autostart

**Goal:** EDITH jalan di background, icon di system tray, autostart saat login.

```mermaid
flowchart LR
    Tray["🔵 System Tray Icon"]

    Tray --> M1["Open EDITH window"]
    Tray --> M2["Voice: Mute/Unmute mic"]
    Tray --> M3["Status: 🟢 Online / 🟡 Degraded / 🔴 Offline"]
    Tray --> M4["Quick actions:\n• 'What's on my schedule?'\n• 'Run morning briefing'\n• 'Mute all notifications'"]
    Tray --> M5["Settings"]
    Tray --> M6["Check for updates"]
    Tray --> M7["Quit"]
```

**Autostart config in `edith.json`:**
```json
{
  "app": {
    "startMinimized": true,
    "autoLaunch": true,
    "minimizeToTray": true,
    "showTrayNotifications": true
  }
}
```

---

### Phase 12E — Crash Reporting & Telemetry (Opt-In Only)

**Always opt-in, never opt-out-required. No data sent by default.**

```mermaid
flowchart TD
    Crash["💥 Unhandled exception\nor crash"]

    subgraph Report["Crash Report (local first)"]
        L1["Write crash dump\nto ~/.edith/crashes/\n(always, no opt-in needed)"]
        L2["Include: stack trace,\nEDITH version, OS version\nNO personal data, NO conversation content"]
    end

    Crash --> L1

    L1 --> Check{"telemetry.enabled\nin edith.json?"}
    Check -->|"true (user explicitly enabled)"| Send["Send to Sentry / self-hosted Glitchtip\n(user-configurable endpoint)"]
    Check -->|"false (default)"| NoSend["Stay local only\nUser can view in Settings > Crash Logs"]
```

**Telemetry config (off by default):**
```json
{
  "telemetry": {
    "enabled": false,
    "crashReporting": false,
    "endpoint": ""
  }
}
```

---

### Phase 12F — Docker Mode (Headless Server)

**Goal:** EDITH bisa jalan sebagai headless server (tanpa Electron GUI) untuk deployment di VPS, home server, atau NAS.

```mermaid
flowchart TD
    subgraph Docker["🐳 Docker Container"]
        Engine["EDITH Core Engine\n(Node.js only, no Electron)"]
        Gateway["Fastify Gateway\nport 18789"]
        WebUI["WebChat UI\n(browser-based)"]
    end

    subgraph Access["Access Methods"]
        Browser["Browser → http://server:18789"]
        Telegram["Telegram Bot"]
        WS["WebSocket clients\n(mobile app)"]
        Voice["Voice (if mic attached\nvia USB audio)"]
    end

    Docker --> Access
```

**`Dockerfile`:**
```dockerfile
FROM node:22-alpine
WORKDIR /app

# Copy compiled engine
COPY EDITH-ts/dist/ ./dist/
COPY EDITH-ts/python/ ./python/
COPY EDITH-ts/models/ ./models/
COPY EDITH-ts/prisma/ ./prisma/

RUN npm install -g pnpm
RUN pnpm install --prod

# Python for voice sidecar
RUN apk add python3 py3-pip
RUN pip3 install faster-whisper kokoro soundfile

EXPOSE 18789
CMD ["node", "dist/core/startup.js"]
```

**`docker-compose.yml`:**
```yaml
version: '3.9'
services:
  edith:
    image: edith:latest
    ports:
      - "18789:18789"
    volumes:
      - ./edith.json:/app/edith.json:ro
      - edith-data:/app/data
    environment:
      - NODE_ENV=production
    restart: unless-stopped

  ollama:
    image: ollama/ollama
    volumes:
      - ollama-data:/root/.ollama
    ports:
      - "11434:11434"

volumes:
  edith-data:
  ollama-data:
```

---

## 3. Summary — Road to v1.0 Release

```mermaid
gantt
    title EDITH Release Roadmap
    dateFormat  YYYY-MM
    section Stability
        Phase 5 Bug Fixes        : 2025-03, 1w
        Phase 2 Test Suite       : 2025-03, 2w
    section Core Features
        Phase 1 Voice            : 2025-04, 3w
        Phase 3 Vision           : 2025-04, 2w
        Phase 4 IoT              : 2025-05, 2w
    section Advanced
        Phase 6 Macros+CaMeL     : 2025-05, 3w
        Phase 9 Offline Mode     : 2025-06, 2w
        Phase 10 Personalization : 2025-06, 3w
    section Distribution
        Phase 12 Packaging       : 2025-07, 2w
        v1.0 Release             : milestone, 2025-07, 0d
    section Future
        Phase 7 Computer Use     : 2025-08, 3w
        Phase 8 Channels         : 2025-08, 2w
        Phase 11 Multi-Agent     : 2025-09, 3w
```

---

## 4. File Changes Summary

| File | Action | Est. Lines |
|------|--------|-----------|
| `.github/workflows/release.yml` | NEW — CI/CD build pipeline | +80 |
| `apps/desktop/electron-builder.json` | Update + extraResources | +30 |
| `apps/desktop/main.js` | Add auto-updater, tray menu | +100 |
| `apps/desktop/renderer/wizard.html` | Extend OOBE steps (voice, personality) | +150 |
| `Dockerfile` | NEW | +40 |
| `docker-compose.yml` | NEW | +30 |
| `EDITH-ts/src/config/edith-config.ts` | Add app/telemetry schema | +30 |
| `EDITH-ts/src/core/startup.ts` | Headless mode support | +40 |
| **Total** | | **~500 lines** |

**New deps:**
```bash
# In apps/desktop:
pnpm add electron-updater

# CI only:
# macOS code signing via Apple Developer account
# Windows code signing via EV cert (optional)
```
