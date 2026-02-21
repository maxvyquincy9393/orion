# SKILL.md — Orion Project Context

> This file is the single source of truth for all AI coding assistants working on Orion.
> Read this before generating any code, suggesting any architecture, or making any decisions.
> GitHub Copilot, OpenCode, Gemini CLI, and Codex must all follow this context.
> **Say "Orion context loaded" before starting any task to confirm you have read this.**

---

## What is Orion?

Orion is a **Persistent AI Companion System with System Access** — not a chatbot, not a notification bot.
It is an AI that lives in the background, remembers everything, reaches out proactively, can see through
a live camera, executes complex multi-step tasks via agents, browses the web autonomously, and can
control the user's system — all within a fully configurable permission sandbox.

Core philosophy: **AI that comes to you, not one you go to. And when it acts, it acts within the rules you set.**

---

## The Problem Orion Solves

Every AI tool today is reactive, blind, and sandboxed by default with no way to customize access.
The user opens the app, types a message, gets a response. It cannot see, act, browse, or remember.

Orion is different:
- Runs as a background process, always aware
- Remembers all conversations permanently across sessions
- Initiates contact proactively — no prompt needed
- Maintains stateful conversation threads like a WhatsApp chat
- Sees the world via live camera or screen capture
- Browses the web autonomously — for free, no API cost
- Controls the user's system within a fully configurable sandbox
- Executes complex multi-step tasks via LangGraph agent system
- Every capability is toggleable — user decides what Orion can and cannot do

---

## AI Assistant Setup — How We Access Each Engine

### GitHub Copilot
- Accessed inside VSCode via extension
- Used for: inline suggestions, tab completion, quick fixes

### OpenAI (GPT-4o) — OAuth2
```
Auth URL: https://auth.openai.com/authorize
Token URL: https://auth.openai.com/token
Redirect URI: http://localhost:8080/callback/openai
Store in: .env → OPENAI_ACCESS_TOKEN, OPENAI_REFRESH_TOKEN
```
Setup file: `auth/openai_oauth.py`

### Google Gemini — OAuth2
```
Auth URL: https://accounts.google.com/o/oauth2/v2/auth
Token URL: https://oauth2.googleapis.com/token
Redirect URI: http://localhost:8080/callback/google
Store in: .env → GOOGLE_ACCESS_TOKEN, GOOGLE_REFRESH_TOKEN
```
Setup file: `auth/google_oauth.py`

### Anthropic Claude — API Key
```
Store in: .env → ANTHROPIC_API_KEY
```

### Ollama — Local, Free
```
Base URL: http://localhost:11434
Cost: zero
```

---

## MANDATORY RULES — Non-Negotiable

### Rule 1: Always Commit
**Every single change must be committed immediately.**

```bash
git add .
git commit -m "type(scope): description"
git push origin main
```

Commit message format:
```
feat(permissions): add sandbox config loader
feat(browser): add playwright browsing agent
fix(oauth): handle token expiry for Google
docs(system): update system control documentation
wip(vision): live stream frame sampling in progress
refactor(agent): simplify LangGraph node structure
chore(deps): add browser-use to requirements.txt
```

Auto-push always running via `scripts/autopush.py`. Start before coding:
```bash
python scripts/autopush.py
```

Never leave uncommitted changes. Even WIP — use `wip:` prefix.

---

### Rule 2: Always Create Documentation
**Every file, function, and decision must be documented.**

**New file — module docstring:**
```python
"""
module_name.py

What this module does and why it exists.
Part of Orion — Persistent AI Companion System.
"""
```

**New function:**
```python
def function_name(param: type) -> type:
    """
    What this function does in one sentence.

    Args:
        param: what this parameter is

    Returns:
        what is returned

    Example:
        result = function_name("input")
    """
```

**Non-trivial decision:**
```python
# DECISION: [what was decided]
# WHY: [reason]
# ALTERNATIVES CONSIDERED: [what was rejected and why]
# REVISIT: [condition that would trigger a change]
```

**End of every coding session:**
1. All new functions have docstrings
2. Update relevant doc in `docs/`
3. Update `phase-progress.md`
4. Final commit and push

---

## Tech Stack

| Layer | Technology | Cost |
|---|---|---|
| Language | Python 3.11+ | Free |
| LLM Engines | GPT-4o (OAuth2), Gemini (OAuth2), Claude (API Key), Ollama (local) | Free tier / local |
| Agent Framework | LangGraph + LangChain | Free |
| Autonomous Browsing | Playwright + browser-use | Free, open source |
| Search (no API cost) | SearXNG (self-hosted) + DuckDuckGo | Free |
| System Control | pyautogui + subprocess + os | Free |
| Permission System | Custom sandbox config | Built in-house |
| RAG | LangChain + embeddings | Free (local models) |
| Vector Database | Supabase pgvector (free tier) or Chroma (local) | Free |
| Relational Database | PostgreSQL via SQLAlchemy | Free |
| Background Process | Celery + Redis | Free |
| Vision | OpenCV + WebRTC + Gemini Vision / GPT-4V | Free tier |
| Voice STT | OpenAI Whisper (local) | Free |
| Voice TTS | ElevenLabs free tier or Coqui TTS (local) | Free |
| Delivery | Telegram Bot API | Free |
| Auth | OAuth2 custom flow | Free |
| Dev Tools | VSCode + Copilot + OpenCode + Gemini CLI + Codex | Free tiers |
| Version Control | Git + GitHub | Free |

**Design principle: maximize free tiers and open source. No mandatory paid services.**

---

## Project Structure

```
orion/
├── main.py                        # Entry point — starts all services
├── config.py                      # Loads all env vars and API keys
├── requirements.txt               # All Python dependencies
├── .env.example                   # Template — never commit .env
├── SKILL.md                       # This file — AI assistant context
├── README.md                      # Human-readable project overview
│
├── auth/
│   ├── openai_oauth.py            # OpenAI OAuth2 flow + token refresh
│   ├── google_oauth.py            # Google OAuth2 flow + token refresh
│   ├── token_manager.py           # Centralized token storage and auto-refresh
│   └── callback_server.py         # Local HTTP server for OAuth redirect
│
├── permissions/
│   ├── sandbox.py                 # Core permission engine — checks before every action
│   ├── config_loader.py           # Loads and validates permissions.yaml
│   ├── permission_types.py        # Enum of all possible permissions
│   └── permissions.yaml           # User-editable permission config file
│
├── core/
│   ├── orchestrator.py            # Routes tasks to correct engine or agent
│   ├── memory.py                  # Persistent memory: save, retrieve, compress
│   ├── rag.py                     # RAG pipeline: embed, store, query
│   └── context.py                 # Builds context window before each LLM call
│
├── engines/
│   ├── base.py                    # Abstract base — all engines implement this
│   ├── openai_engine.py           # GPT-4o via OAuth2
│   ├── claude_engine.py           # Anthropic Claude via API Key
│   ├── gemini_engine.py           # Google Gemini via OAuth2
│   └── local_engine.py            # Ollama local model
│
├── agents/
│   ├── graph.py                   # LangGraph state graph definition
│   ├── nodes.py                   # Individual agent task nodes
│   ├── state.py                   # Agent state schema (TypedDict)
│   ├── tools.py                   # Tools available to agents
│   └── supervisor.py              # Supervisor agent that delegates to sub-agents
│
├── browser/
│   ├── agent.py                   # Autonomous browsing agent (browser-use)
│   ├── playwright_client.py       # Playwright headless browser client
│   ├── search.py                  # Free search: SearXNG + DuckDuckGo fallback
│   └── scraper.py                 # Extract structured content from web pages
│
├── system/
│   ├── controller.py              # System action dispatcher — all actions go through here
│   ├── file_ops.py                # File read/write/delete operations
│   ├── app_control.py             # Open/close/interact with applications
│   ├── input_control.py           # Mouse and keyboard control via pyautogui
│   ├── terminal.py                # Run terminal commands via subprocess
│   └── calendar_ops.py            # Read/write calendar events
│
├── vision/
│   ├── stream.py                  # Live camera capture via OpenCV / WebRTC
│   ├── processor.py               # Frame sampling and motion detection
│   ├── vision_engine.py           # Sends frames to Gemini Vision or GPT-4V
│   └── screen_capture.py          # Screen capture mode
│
├── background/
│   ├── process.py                 # Daemon — runs continuously, never sleeps
│   ├── triggers.py                # Detects when AI should proactively reach out
│   └── thread_manager.py          # Tracks thread state: open / waiting / resolved
│
├── delivery/
│   ├── messenger.py               # Sends messages via Telegram
│   └── voice.py                   # Real-time voice pipeline (Whisper + TTS)
│
├── database/
│   ├── models.py                  # SQLAlchemy ORM models
│   ├── vector_store.py            # Vector DB client and operations
│   └── migrations/                # Alembic migration files
│
├── docs/
│   ├── architecture.md            # System architecture
│   ├── oauth-setup.md             # Auth setup guide
│   ├── permissions-guide.md       # How to configure the sandbox
│   ├── memory-schema.md           # DB and vector store schema
│   ├── agent-graph.md             # LangGraph node structure and flow
│   ├── browser-agent.md           # Autonomous browsing design
│   ├── system-control.md          # System access capabilities and limits
│   ├── vision-pipeline.md         # Live stream and vision processing
│   ├── api.md                     # Internal interfaces and contracts
│   ├── decisions.md               # Running decision log
│   └── phase-progress.md          # Build phase checklist
│
└── scripts/
    ├── autopush.py                # Auto git commit and push on file change
    └── autopush.sh                # Shell alternative
```

---

## Permission System — Core Design

Every action Orion takes must pass through the permission sandbox first. No exceptions.

### permissions.yaml (user editable)
```yaml
# Orion Permission Configuration
# Set to true to enable, false to disable
# require_confirm: Orion will ask before executing

permissions:

  browsing:
    enabled: true
    autonomous: true          # Can browse without asking each time
    require_confirm: false
    allowed_domains: []       # Empty = all domains allowed
    blocked_domains:
      - "banking.com"

  search:
    enabled: true
    engine: "duckduckgo"      # duckduckgo | searxng

  file_system:
    enabled: true
    read: true
    write: true
    delete: false             # Delete is disabled by default
    require_confirm: true     # Always ask before writing
    allowed_paths:
      - "~/Documents/orion"
      - "~/Desktop"
    blocked_paths:
      - "~/.ssh"
      - "~/.env"

  terminal:
    enabled: true
    require_confirm: true     # Always ask before running commands
    blocked_commands:
      - "rm -rf"
      - "sudo"
      - "format"

  app_control:
    enabled: true
    require_confirm: false
    allowed_apps:
      - "chrome"
      - "vscode"
      - "spotify"

  input_control:
    enabled: false            # Mouse/keyboard control off by default
    require_confirm: true

  calendar:
    enabled: true
    read: true
    write: true
    require_confirm: true

  system_info:
    enabled: true             # Read CPU, memory, battery etc.

  camera:
    enabled: true
    mode: "passive"           # passive | active | on-demand | screen

  voice:
    enabled: true
    tts_engine: "coqui"       # coqui (free local) | elevenlabs
    stt_engine: "whisper"     # always local, always free

  proactive:
    enabled: true
    max_messages_per_hour: 5
    quiet_hours:
      start: "22:00"
      end: "08:00"
```

### Sandbox Interface (permissions/sandbox.py)
```python
def check(action: str, details: dict) -> PermissionResult: ...
# Returns: allowed=True/False, requires_confirm=True/False, reason=str

def request_confirm(action: str, details: dict) -> bool: ...
# Sends confirmation request to user, waits for yes/no

def get_config() -> dict: ...
def reload_config() -> None: ...  # Hot reload without restart
```

### Permission Result
```python
class PermissionResult:
    allowed: bool
    requires_confirm: bool
    reason: str
    action: str
```

### Rule: Every system action follows this pattern
```python
result = sandbox.check("file.write", {"path": "/home/user/doc.txt"})
if not result.allowed:
    return f"Action blocked: {result.reason}"
if result.requires_confirm:
    confirmed = await sandbox.request_confirm("file.write", {"path": "/home/user/doc.txt"})
    if not confirmed:
        return "User declined."
# proceed with action
```

---

## Autonomous Browsing — Free Stack

No paid APIs. Everything runs free.

### Search (browser/search.py)
```python
def search(query: str, engine: str = "duckduckgo") -> list[dict]: ...
# engine options: "duckduckgo" | "searxng"
# DuckDuckGo: no API key needed, scrape results directly
# SearXNG: self-hosted, runs on localhost:8888
```

### Browser Agent (browser/agent.py)
```python
class BrowserAgent:
    """Uses browser-use + Playwright for autonomous web navigation."""

    def navigate(self, url: str) -> str: ...
    def search_and_browse(self, query: str) -> str: ...
    def extract_content(self, url: str) -> str: ...
    def fill_form(self, url: str, fields: dict) -> bool: ...
    def take_screenshot(self) -> bytes: ...
```

### Tools available to agents via browser
- Web search (free, no key)
- Navigate to any URL
- Extract text content from pages
- Screenshot any page
- Fill forms (with permission)
- Download files (with permission)

---

## System Control — Capability Map

All actions require permission check first. See Permission System above.

### What Orion Can Do (when enabled)

| Capability | Module | Default |
|---|---|---|
| Read files | system/file_ops.py | Enabled |
| Write files | system/file_ops.py | Confirm required |
| Delete files | system/file_ops.py | Disabled |
| Run terminal commands | system/terminal.py | Confirm required |
| Open applications | system/app_control.py | Enabled |
| Control mouse/keyboard | system/input_control.py | Disabled |
| Read calendar | system/calendar_ops.py | Enabled |
| Write calendar | system/calendar_ops.py | Confirm required |
| Read system info | system/controller.py | Enabled |
| Browse web | browser/agent.py | Enabled |
| Search web | browser/search.py | Enabled |

---

## Core Interfaces — Follow These Exactly

### All LLM Engines (engines/base.py)
```python
class BaseEngine:
    def generate(self, prompt: str, context: list[dict]) -> str: ...
    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]: ...
    def is_available(self) -> bool: ...
```

### Memory (core/memory.py)
```python
def save_message(user_id: str, role: str, content: str, metadata: dict) -> None: ...
def get_history(user_id: str, limit: int = 50) -> list[dict]: ...
def get_relevant_context(user_id: str, query: str, top_k: int = 5) -> list[dict]: ...
def compress_old_sessions(user_id: str, older_than_days: int = 30) -> None: ...
```

### Orchestrator (core/orchestrator.py)
```python
def route(task_type: str) -> BaseEngine: ...
def route_to_agent(task: str) -> AgentGraph: ...
# task_type: "reasoning" | "code" | "voice" | "multimodal" | "fast" | "agent" | "vision" | "browser" | "system"
```

### LangGraph Agent (agents/graph.py)
```python
class OrionAgentGraph:
    def build_graph(self) -> StateGraph: ...
    def run(self, task: str, context: dict) -> dict: ...
    def stream_run(self, task: str, context: dict) -> Iterator[dict]: ...
```

### Agent State (agents/state.py)
```python
class AgentState(TypedDict):
    task: str
    context: list[dict]
    memory: list[dict]
    current_step: str
    results: list[dict]
    permissions_checked: bool
    status: str                  # running | waiting_confirm | complete | error
    error: str | None
```

### Sandbox (permissions/sandbox.py)
```python
def check(action: str, details: dict) -> PermissionResult: ...
def request_confirm(action: str, details: dict) -> bool: ...
def get_config() -> dict: ...
def reload_config() -> None: ...
```

---

## System Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                          USER                                 │
│              voice + text + camera stream                    │
└─────────────────────┬────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│                   DELIVERY LAYER                              │
│              Telegram / Voice / In-app                       │
└─────────────────────┬────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR                                │
│     decides: LLM | agent | vision | browser | system        │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┘
       ↓          ↓          ↓          ↓          ↓
  LangGraph    Vision     Browser    System     Direct
   Agents     Pipeline     Agent    Control      LLM
       ↓          ↓          ↓          ↓
       └──────────┴──────────┴──────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│               PERMISSION SANDBOX                              │
│        Every action checked here before execution            │
└─────────────────────┬────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│               PERSISTENT MEMORY                               │
│          PostgreSQL + Vector DB (RAG)                        │
└─────────────────────┬────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│               BACKGROUND PROCESS                              │
│         always running — triggers proactive messages         │
└──────────────────────────────────────────────────────────────┘
```

---

## Environment Variables (.env.example)

```
# OpenAI — OAuth2
OPENAI_ACCESS_TOKEN=
OPENAI_REFRESH_TOKEN=
OPENAI_CLIENT_ID=
OPENAI_CLIENT_SECRET=

# Google Gemini — OAuth2
GOOGLE_ACCESS_TOKEN=
GOOGLE_REFRESH_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Anthropic — API Key
ANTHROPIC_API_KEY=

# Ollama — Local Free
OLLAMA_BASE_URL=http://localhost:11434

# Database — Free
DATABASE_URL=postgresql://user:password@localhost:5432/orion
SUPABASE_URL=
SUPABASE_KEY=

# Search — Free
SEARXNG_URL=http://localhost:8888    # self-hosted
DUCKDUCKGO_ENABLED=true

# Delivery — Free
TELEGRAM_BOT_TOKEN=

# Voice — Free local options
WHISPER_MODEL=base                  # runs locally, free
TTS_ENGINE=coqui                    # coqui = free local, elevenlabs = paid
ELEVENLABS_API_KEY=                 # optional, only if using ElevenLabs

# Vision
VISION_ENGINE=gemini                # gemini | openai
VISION_MODE=passive                 # passive | active | on-demand | screen
FRAME_SAMPLE_INTERVAL=2
MOTION_THRESHOLD=0.15

# Background
REDIS_URL=redis://localhost:6379

# Config
DEFAULT_ENGINE=claude               # claude | openai | gemini | local
DEFAULT_USER_ID=owner
PERMISSIONS_CONFIG=permissions/permissions.yaml
LOG_LEVEL=INFO
```

---

## What Makes Orion Different

| Feature | Normal AI / Clawdbot | Orion |
|---|---|---|
| Memory | Resets every session | Permanent, cross-session |
| Behavior | Waits to be asked | Proactively reaches out |
| Conversation | One message, done | Stateful thread, follows up |
| Engine | Single model | Multi-model, auto-routed |
| Agent Tasks | Single LLM call | LangGraph multi-step agent |
| Web Browsing | None or paid API | Autonomous, free (Playwright + DDG) |
| System Access | None | Files, terminal, apps, calendar |
| Permission Control | None | Fully configurable sandbox per action |
| Vision | None | Live cam + screen capture |
| Runtime | Only when open | Background daemon, always running |
| Cost | Varies | Free tier maximized throughout |

---

## Current Build Phase

**Phase 1 — Foundation (Active)**
- [ ] OAuth2 setup for OpenAI and Google
- [ ] Project scaffold and full directory structure
- [ ] permissions.yaml + sandbox.py — permission engine
- [ ] PostgreSQL schema and SQLAlchemy models
- [ ] Vector DB setup (Supabase free tier or local Chroma)
- [ ] RAG pipeline (embed, store, retrieve)
- [ ] Multi-engine LLM connections (GPT, Claude, Gemini, Ollama)
- [ ] Basic orchestrator routing
- [ ] LangGraph basic graph scaffold
- [ ] Persistent chat with cross-session memory
- [ ] Auto-push git script
- [ ] docs/ folder initialized

**Phase 2 — Proactive + Browser + System**
- [ ] Background daemon process
- [ ] Trigger detection system
- [ ] Thread state manager
- [ ] Telegram delivery
- [ ] Autonomous browser agent (Playwright + browser-use)
- [ ] Free search (DuckDuckGo + SearXNG)
- [ ] System control: file, terminal, calendar
- [ ] Permission confirmation flow (ask user before acting)
- [ ] LangGraph tools: search, browse, file, calendar

**Phase 3 — Vision + Intelligence**
- [ ] Live camera capture (OpenCV)
- [ ] Frame sampling and motion detection
- [ ] Vision engine integration
- [ ] Screen capture mode
- [ ] Voice pipeline (Whisper local + Coqui TTS free)
- [ ] Long-term memory compression
- [ ] Proactive trigger intelligence (research phase)

---

## Repository

- **Repo:** github.com/maxvyquincy9393/orion
- **Branch:** main
- **Auto-push:** always running via scripts/autopush.py

---

*Last updated: February 2026 — Update this file whenever architecture or direction changes.*