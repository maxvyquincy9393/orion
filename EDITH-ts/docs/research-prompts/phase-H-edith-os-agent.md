# Phase H: EDITH OS-Agent — System-Level Integration

> **Goal:** Transform EDITH from a chat-based AI assistant into a true EDITH-like
> system that interfaces directly with the operating system, hardware, smart home,
> and all digital services — bypassing traditional "app" boundaries.
>
> **Status:** Planning & Research
> **Last Updated:** March 2026

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [Research Paper Foundation](#2-research-paper-foundation)
3. [Architecture: OS-Agent Layer](#3-architecture-os-agent-layer)
4. [Sub-Phase H.1: Computer Use & GUI Agent](#h1-computer-use--gui-agent)
5. [Sub-Phase H.2: Voice Pipeline (Full Duplex)](#h2-voice-pipeline-full-duplex)
6. [Sub-Phase H.3: Vision & Screen Understanding](#h3-vision--screen-understanding)
7. [Sub-Phase H.4: Smart Home & IoT](#h4-smart-home--iot)
8. [Sub-Phase H.5: System Daemon & Always-On](#h5-system-daemon--always-on)
9. [Sub-Phase H.6: Proactive Autonomy](#h6-proactive-autonomy)
10. [Implementation Sequence](#implementation-sequence)
11. [Key Open Source Projects to Study](#key-open-source-projects)

---

## 1. Vision & Philosophy

### What EDITH Really Is

EDITH dari Iron Man bukan sekadar chatbot — dia adalah **Operating System Agent** yang:

1. **Selalu aktif** — berjalan sebagai system service, bukan app yang harus dibuka
2. **Mendengar terus** — wake word detection + continuous STT
3. **Melihat layar** — bisa baca, navigate, dan kontrol GUI
4. **Mengontrol komputer** — buka app, jalankan script, manage files
5. **Terhubung ke hardware** — smart home, IoT sensors, cameras
6. **Proaktif** — tidak menunggu perintah, menginisiasi berdasarkan context
7. **Multimodal** — voice in → voice out (real-time, interruptible)

### Paradigm Shift: App → OS Layer

```
SEKARANG (App-based):                    TARGET (OS-Agent):
┌─────────────┐                         ┌──────────────────────────┐
│ User membuka │                         │ EDITH IS the OS layer     │
│ terminal/web │──→ ketik pesan          │                          │
│ untuk chat   │                         │ ┌────────────────────┐   │
└─────────────┘                         │ │ Always-On Daemon    │   │
                                        │ │ (systemd/Windows    │   │
                                        │ │  Service)           │   │
                                        │ └────────┬───────────┘   │
                                        │          │               │
                                        │ ┌────────▼───────────┐   │
                                        │ │ Sensory Input Layer │   │
                                        │ │ • Microphone (STT)  │   │
                                        │ │ • Screen (Vision)   │   │
                                        │ │ • Clipboard Watch   │   │
                                        │ │ • File System Watch │   │
                                        │ │ • Network Monitor   │   │
                                        │ └────────┬───────────┘   │
                                        │          │               │
                                        │ ┌────────▼───────────┐   │
                                        │ │ Action Layer        │   │
                                        │ │ • GUI Automation    │   │
                                        │ │ • Shell Execution   │   │
                                        │ │ • App Control       │   │
                                        │ │ • IoT Commands      │   │
                                        │ │ • Voice Output      │   │
                                        │ └────────────────────┘   │
                                        └──────────────────────────┘
```

---

## 2. Research Paper Foundation

### Core Papers — OS-Agent & Computer Use

| # | Paper | arXiv ID | Year | Relevansi |
|---|---|---|---|---|
| H-01 | **OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments** | 2404.07972 | 2024 | Benchmark definitif untuk OS-level agent. Ubuntu/Windows/macOS support. 369 real tasks. |
| H-02 | **The Dawn of GUI Agent: Claude 3.5 Computer Use** | 2411.10323 | 2024 | First frontier model with computer use. Framework for deploying GUI automation. |
| H-03 | **CodeAct: Executable Code Actions Elicit Better LLM Agents** | 2402.01030 | 2024 (ICML) | Unify agent actions as executable Python code. 20% higher success rate vs JSON actions. |
| H-04 | **MemGPT: Towards LLMs as Operating Systems** | 2310.08560 | 2023 | LLM sebagai OS — virtual context management, memory paging, interrupt handling. |
| H-05 | **CaMeL: Defeating Prompt Injections by Design** | 2503.18813 | 2025 | Security kritis untuk OS-agent — control/data flow separation, capability-based security. |

### Voice & Multimodal Papers

| # | Paper | arXiv ID | Relevansi |
|---|---|---|---|
| H-06 | **Low-Latency Voice Agents** | 2508.04721 | Real-time voice pipeline architecture |
| H-07 | **Generative Agents: Interactive Simulacra of Human Behavior** | 2304.03442 | Observation → Planning → Reflection architecture |
| H-08 | **Llama 3: The Herd of Models** | 2407.21783 | Compositional multimodal (image + video + speech) integration |
| H-09 | **AgentBoard: Analytical Evaluation of Multi-turn LLM Agents** | 2401.13178 | NeurIPS 2024 Oral. Evaluation framework for multi-step agents |
| H-10 | **Experiential Co-Learning of Software-Developing Agents** | 2312.17025 | ACL 2024. Learning from historical trajectories & co-learning |

### Smart Home & IoT Papers

| # | Paper | Relevansi |
|---|---|---|
| H-11 | **Home Assistant + LLM Integration** (community research) | Leading open-source home automation with LLM voice control |
| H-12 | **Matter Protocol Specification** | Unified smart home standard (Apple/Google/Amazon) |
| H-13 | **MQTT + Node-RED for IoT Orchestration** | Event-driven IoT messaging |

### Computer Use & GUI Automation

| # | Project | URL | Relevansi |
|---|---|---|---|
| H-14 | **Open Interpreter** | github.com/OpenInterpreter/open-interpreter | LLM yang bisa run code langsung di komputer |
| H-15 | **Computer Use OOTB** | github.com/showlab/computer_use_ootb | Claude Computer Use framework |
| H-16 | **SWE-agent** | github.com/princeton-nlp/SWE-agent | Autonomous software engineering agent |
| H-17 | **UFO (Windows Agent)** | github.com/microsoft/UFO | Microsoft's UI-Focused Agent for Windows |
| H-18 | **OS-Copilot (FRIDAY)** | github.com/OS-Copilot/OS-Copilot | General computer agent, self-improving |

---

## 3. Architecture: OS-Agent Layer

### Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    NOVA EDITH — OS Agent Layer                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Sensory Cortex                            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │  │
│  │  │ Audio    │ │ Vision   │ │ System   │ │ Network  │       │  │
│  │  │ Cortex   │ │ Cortex   │ │ Monitor  │ │ Monitor  │       │  │
│  │  │ STT+VAD  │ │ Screen   │ │ Process  │ │ HTTP     │       │  │
│  │  │ Wake-word│ │ OCR      │ │ Files    │ │ DNS      │       │  │
│  │  │ Speaker  │ │ Element  │ │ Clipboard│ │ Traffic  │       │  │
│  │  │ Diarize  │ │ Detect   │ │ Registry │ │ Latency  │       │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │  │
│  └─────────────────────────┬───────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────▼───────────────────────────────────┐  │
│  │                  Perception Fusion                           │  │
│  │  Merges all sensory inputs into unified context snapshot     │  │
│  │  Updates at ~1Hz for passive monitoring, ~10Hz during task   │  │
│  └─────────────────────────┬───────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────▼───────────────────────────────────┐  │
│  │              Existing EDITH Core Pipeline                     │  │
│  │  Security → Memory → Persona → LLM → Critic → Output       │  │
│  └─────────────────────────┬───────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────▼───────────────────────────────────┐  │
│  │                    Action Cortex                             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │  │
│  │  │ GUI      │ │ Shell    │ │ Voice    │ │ IoT      │       │  │
│  │  │ Agent    │ │ Runner   │ │ Output   │ │ Bridge   │       │  │
│  │  │ Click    │ │ Bash/PS  │ │ TTS+DSP  │ │ MQTT     │       │  │
│  │  │ Type     │ │ Scripts  │ │ Stream   │ │ HomeAsst │       │  │
│  │  │ Navigate │ │ Package  │ │ Interrupt│ │ Matter   │       │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   System Service Layer                       │  │
│  │  • Windows Service / systemd daemon / launchd               │  │
│  │  • Auto-start on boot                                       │  │
│  │  • Health monitoring & self-restart                          │  │
│  │  • Resource management (CPU/RAM caps)                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## H.1: Computer Use & GUI Agent

### Goal
EDITH bisa melihat layar, mengklik, mengetik, dan menavigasi aplikasi apapun — seperti EDITH mengontrol holographic interface.

### Key Capabilities
- Screenshot capture + element detection
- Mouse click/drag/scroll at coordinates
- Keyboard input (type, hotkeys)
- Application window management (open, close, resize, focus)
- File manager navigation
- Web browser control

### Implementation Plan

```typescript
// src/os-agent/gui-agent.ts
interface GUIAction {
  type: "click" | "type" | "hotkey" | "scroll" | "screenshot" | "wait"
  coordinates?: { x: number; y: number }
  text?: string
  keys?: string[]
  direction?: "up" | "down"
  amount?: number
}

interface ScreenState {
  screenshot: Buffer          // PNG screenshot
  elements: UIElement[]       // Detected UI elements
  activeWindow: WindowInfo    // Current active window
  cursor: { x: number; y: number }
}

interface UIElement {
  type: "button" | "input" | "link" | "text" | "image" | "menu"
  text: string
  bounds: { x: number; y: number; width: number; height: number }
  interactable: boolean
}
```

### Platform-Specific Tools
| Platform | Screenshot | GUI Automation | Window Mgmt |
|----------|-----------|----------------|-------------|
| Windows | `nircmd` / PowerShell | `robotjs` / `nutjs` | `powershell` |
| macOS | `screencapture` | `cliclick` / Accessibility API | `osascript` |
| Linux | `scrot` / `gnome-screenshot` | `xdotool` / `ydotool` | `wmctrl` |

### Research References
- **OSWorld** (arXiv:2404.07972) — benchmark: best model only 12.24% success rate vs human 72.36%
- **Claude Computer Use** (arXiv:2411.10323) — first production GUI agent
- **UFO** (Microsoft) — Windows UI-Focused Agent, UIA-based element detection

---

## H.2: Voice Pipeline (Full Duplex)

### Goal
Percakapan suara real-time yang bisa diinterupsi, dengan wake word detection — "Hey EDITH".

### Current State
- TTS: ✅ Complete (Edge TTS + DSP)
- STT: ❌ Missing
- Wake Word: ❌ Missing
- Full Duplex: ❌ Missing

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Microphone  │────→│ VAD         │────→│ Wake Word   │
│  (always on) │     │ (Silero)    │     │ (Porcupine/ │
└─────────────┘     └─────────────┘     │  OpenWakeWord│
                                         └──────┬──────┘
                                                │ triggered
                                         ┌──────▼──────┐
                                         │ STT Engine  │
                                         │ (Whisper/   │
                                         │  Deepgram/  │
                                         │  faster-    │
                                         │  whisper)   │
                                         └──────┬──────┘
                                                │ text
                                         ┌──────▼──────┐
                                         │ EDITH Core   │
                                         │ Pipeline    │
                                         └──────┬──────┘
                                                │ response
                                         ┌──────▼──────┐
                                         │ TTS Output  │
                                         │ (Edge TTS   │
                                         │  + DSP)     │
                                         └──────┬──────┘
                                                │ audio
                                         ┌──────▼──────┐
                                         │ Speaker     │
                                         │ (playback)  │
                                         └─────────────┘
```

### Key Components to Build
1. **VAD (Voice Activity Detection)** — Silero VAD via ONNX Runtime
2. **Wake Word** — Picovoice Porcupine (free tier) or OpenWakeWord
3. **STT** — faster-whisper (local) or Deepgram (cloud, low-latency)
4. **Interruption Handling** — cancel TTS playback when user speaks
5. **Speaker Diarization** — identify who is speaking (multi-user)

### Paper Reference
- **Low-Latency Voice Agents** (arXiv:2508.04721)

---

## H.3: Vision & Screen Understanding

### Goal
EDITH bisa "melihat" — memahami screenshot, webcam feed, dokumen, dan screen content.

### Capabilities
- Screenshot analysis (text extraction, element detection)
- Webcam/camera feed understanding
- Document/image analysis
- Real-time screen monitoring for triggers

### Implementation
```typescript
// src/os-agent/vision-cortex.ts
interface VisionCapability {
  // Screenshot → structured understanding
  analyzeScreen(screenshot: Buffer): Promise<ScreenUnderstanding>
  
  // OCR for text extraction
  extractText(image: Buffer): Promise<string>
  
  // Element detection for GUI agent
  detectElements(screenshot: Buffer): Promise<UIElement[]>
  
  // General image understanding via multimodal LLM
  describeImage(image: Buffer, question?: string): Promise<string>
  
  // Monitor screen for trigger conditions
  watchScreen(condition: string, callback: () => void): void
}
```

### Models
| Task | Model | Cost |
|------|-------|------|
| OCR | Tesseract.js (local) | Free |
| Element Detection | YOLO / OmniParser | Free |
| Image Understanding | Gemini Vision / GPT-4o | API cost |
| Screen Monitoring | Local diff + OCR | Free |

---

## H.4: Smart Home & IoT

### Goal
Kontrol smart home devices — lampu, AC, kamera, pintu, etc.

### Integration Targets
1. **Home Assistant** — REST API + WebSocket
2. **MQTT** — Direct IoT device messaging
3. **Matter/Thread** — Modern unified smart home protocol
4. **Tuya/SmartLife** — Popular Asian smart home ecosystem
5. **Custom ESP32** — Direct hardware control

### Architecture
```typescript
// src/os-agent/iot-bridge.ts
interface IoTBridge {
  // Home Assistant integration
  homeAssistant: {
    getStates(): Promise<EntityState[]>
    callService(domain: string, service: string, data: any): Promise<void>
    subscribe(eventType: string, callback: (event: any) => void): void
  }
  
  // MQTT direct
  mqtt: {
    publish(topic: string, payload: string): Promise<void>
    subscribe(topic: string, callback: (msg: string) => void): void
  }
  
  // High-level commands
  execute(command: NaturalLanguageCommand): Promise<IoTResult>
}

// Example: "EDITH, matikan lampu kamar dan set AC ke 22 derajat"
// → parse → [
//     { domain: "light", service: "turn_off", target: "light.bedroom" },
//     { domain: "climate", service: "set_temperature", target: "climate.bedroom", data: { temperature: 22 } }
//   ]
```

---

## H.5: System Daemon & Always-On

### Goal
EDITH berjalan sebagai system service yang starts on boot, always listening, minimal resource usage saat idle.

### Windows Service
```typescript
// src/os-agent/service/windows-service.ts
// Uses node-windows to register as Windows Service
// - Auto-start on boot
// - Runs in background (no console window)
// - Restart on crash
// - Low memory mode when idle
```

### Linux systemd
```ini
# /etc/systemd/system/edith.service
[Unit]
Description=EDITH AI Companion
After=network.target sound.target

[Service]
Type=simple
User=edith
ExecStart=/usr/bin/node /opt/edith/dist/main.js --mode daemon
Restart=always
RestartSec=5
MemoryMax=512M
CPUQuota=30%

[Install]
WantedBy=multi-user.target
```

### Resource Management
- Idle mode: ~50MB RAM, <1% CPU (only wake word detection active)
- Active mode: ~300-500MB RAM, 5-15% CPU
- Task mode: Up to 1GB RAM during complex operations
- Graceful degradation when resources are constrained

---

## H.6: Proactive Autonomy

### Goal
EDITH tidak hanya merespons — dia proaktif menginisiasi berdasarkan context.

### Trigger Categories
| Category | Example | Implementation |
|----------|---------|----------------|
| **Time-based** | "Selamat pagi, hari ini ada meeting jam 10" | Cron + Calendar API |
| **Context-based** | "Kamu sudah coding 3 jam, istirahat dulu?" | Activity monitor |
| **Event-based** | "Email penting dari boss masuk" | Email watch + importance scoring |
| **System-based** | "Disk hampir penuh, mau cleanup?" | System resource monitoring |
| **Location-based** | "Kamu sampai di kantor, mau buka project?" | WiFi/GPS detection |
| **Habit-based** | "Biasanya jam segini kamu buka Spotify" | Behavior pattern learning |

### Implementation via Existing Daemon
EDITH sudah punya `src/background/daemon.ts` dengan trigger system. Extend dengan:
1. **SystemWatcher** — monitor CPU, RAM, disk, battery
2. **ActivityWatcher** — track active window, idle time
3. **CalendarWatcher** — poll Google Calendar / Outlook
4. **EmailWatcher** — IMAP IDLE / Gmail push notifications
5. **NetworkWatcher** — WiFi changes, connectivity status

---

## Implementation Sequence

```
Phase H.1 — Computer Use & GUI Agent     [Weeks 1-3]
  ├── Screenshot capture cross-platform
  ├── UI element detection (accessibility API)
  ├── Mouse/keyboard automation
  ├── Window management
  └── Integration with agent runner

Phase H.2 — Full Voice Pipeline           [Weeks 2-4]
  ├── VAD integration (Silero)
  ├── Wake word detection
  ├── STT integration (Whisper/Deepgram)
  ├── Full duplex audio handling
  └── Interruption support

Phase H.3 — Vision & Screen Understanding [Weeks 3-5]
  ├── Screenshot → OCR pipeline
  ├── Element detection model
  ├── Multimodal LLM integration
  └── Screen monitoring triggers

Phase H.4 — Smart Home & IoT              [Weeks 4-6]
  ├── Home Assistant REST client
  ├── MQTT bridge
  ├── Device discovery & mapping
  └── Natural language → IoT command parser

Phase H.5 — System Daemon & Always-On     [Weeks 5-7]
  ├── Windows Service registration
  ├── systemd unit file
  ├── Resource management
  ├── Auto-start & self-heal
  └── Tray icon / minimal UI

Phase H.6 — Proactive Autonomy            [Weeks 6-8]
  ├── Enhanced system/activity watchers
  ├── Calendar/email integration
  ├── Behavior pattern learning
  └── Autonomous task initiation
```

---

## Key Open Source Projects to Study

| Project | Description | URL |
|---------|-------------|-----|
| **Open Interpreter** | LLM computer control via code execution | github.com/OpenInterpreter/open-interpreter |
| **UFO** | Microsoft's Windows UI agent | github.com/microsoft/UFO |
| **OS-Copilot (FRIDAY)** | Self-improving OS agent | github.com/OS-Copilot/OS-Copilot |
| **Computer Use OOTB** | Claude Computer Use framework | github.com/showlab/computer_use_ootb |
| **Home Assistant** | Open-source home automation | github.com/home-assistant/core |
| **Piper** | Fast local TTS | github.com/rhasspy/piper |
| **faster-whisper** | Optimized Whisper STT | github.com/SYSTRAN/faster-whisper |
| **OpenWakeWord** | Open-source wake word detection | github.com/dscripka/openWakeWord |
| **Silero VAD** | Voice Activity Detection | github.com/snakers4/silero-vad |
| **node-windows** | Windows Service from Node.js | github.com/nicedoc/node-windows |
| **nut.js** | Cross-platform desktop automation | github.com/nut-tree/nut.js |
| **RobotJS** | Desktop automation for Node.js | github.com/octalmage/robotjs |
