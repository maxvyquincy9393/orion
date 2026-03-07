# Phase 6 — Advanced JARVIS Features (Proactive + Automation + Security)

**Durasi Estimasi:** 3–4 minggu  
**Prioritas:** 🟢 ENHANCEMENT — Fitur yang membuat Nova benar-benar seperti JARVIS  
**Status Saat Ini:** Daemon ✅ | Triggers YAML ✅ | File Watcher ❌ | Notifications ❌ | Macros ❌ | CaMeL ❌  

---

## 1. Tujuan

Setelah Phase 1-5 selesai (voice, tests, vision, IoT, bugfix), Phase 6 menambahkan kemampuan **proaktif dan otomasi** yang membedakan JARVIS dari chatbot biasa:

1. **Proactive Assistance** → Nova memberitahu user tanpa diminta (battery low, meeting reminder, unusual activity)
2. **File Watcher** → Deteksi perubahan file penting, auto-backup, notify
3. **System Notifications** → Push notifications ke desktop + mobile
4. **Macros & Workflows** → User buat custom automation (voice trigger → multi-step action)
5. **CaMeL Security** → Control-flow integrity untuk tool execution (prevent prompt injection on tools)

---

## 2. Arsitektur Sistem

### 2.1 Proactive Intelligence Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Proactive Intelligence Layer                       │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Event Sources                               │  │
│  │                                                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │ System   │ │ Calendar │ │ File     │ │ IoT State    │   │  │
│  │  │ Monitor  │ │ (ICS/    │ │ Watcher  │ │ Changes      │   │  │
│  │  │ (CPU,RAM │ │  Google  │ │ (chokidar│ │ (HA/MQTT     │   │  │
│  │  │  battery)│ │  Cal API)│ │  /fs.watch│ │  events)     │   │  │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘   │  │
│  │       │             │            │               │            │  │
│  │       └─────────────┴────────────┴───────────────┘            │  │
│  │                             │                                  │  │
│  │                             ▼                                  │  │
│  │  ┌──────────────────────────────────────────────────┐         │  │
│  │  │              Trigger Evaluator (Daemon)           │         │  │
│  │  │                                                   │         │  │
│  │  │  triggers.yaml:                                   │         │  │
│  │  │  ┌────────────────────────────────────────────┐  │         │  │
│  │  │  │ - name: battery_low                        │  │         │  │
│  │  │  │   condition: system.battery < 20           │  │         │  │
│  │  │  │   action: notify "Battery rendah"          │  │         │  │
│  │  │  │   cooldown: 30m                            │  │         │  │
│  │  │  │                                            │  │         │  │
│  │  │  │ - name: meeting_reminder                   │  │         │  │
│  │  │  │   condition: calendar.next_event < 15min   │  │         │  │
│  │  │  │   action: speak + notify "Meeting in..."   │  │         │  │
│  │  │  │   cooldown: 60m                            │  │         │  │
│  │  │  │                                            │  │         │  │
│  │  │  │ - name: unusual_network                    │  │         │  │
│  │  │  │   condition: network.new_device_detected   │  │         │  │
│  │  │  │   action: notify "New device on network"   │  │         │  │
│  │  │  └────────────────────────────────────────────┘  │         │  │
│  │  │                                                   │         │  │
│  │  │  Evaluation:                                      │         │  │
│  │  │  1. Check conditions against current state       │         │  │
│  │  │  2. VoI (Value of Information) gating            │         │  │
│  │  │  3. Cooldown check                               │         │  │
│  │  │  4. Quiet hours check                            │         │  │
│  │  └──────────────────────────┬────────────────────────┘         │  │
│  │                             │                                  │  │
│  │                             ▼                                  │  │
│  │  ┌──────────────────────────────────────────────────┐         │  │
│  │  │            Notification Dispatcher                │         │  │
│  │  │                                                   │         │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │         │  │
│  │  │  │ Desktop  │  │ Mobile   │  │ Voice (TTS)  │  │         │  │
│  │  │  │ Toast    │  │ Push     │  │ Speak aloud  │  │         │  │
│  │  │  │ (Win/Mac)│  │ (Expo)   │  │ (Edge TTS)   │  │         │  │
│  │  │  └──────────┘  └──────────┘  └──────────────┘  │         │  │
│  │  └──────────────────────────────────────────────────┘         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 File Watcher Architecture

```
┌───────────────────────────────────────────────┐
│             File Watcher System                │
│                                                │
│  Config (SystemConfig.watchPaths):             │
│  ├── ~/Documents/**                            │
│  ├── ~/Desktop/**                              │
│  ├── ~/Projects/**/package.json                │
│  └── Custom paths dari user                    │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │        chokidar Watcher                   │ │
│  │                                           │ │
│  │  Events:                                  │ │
│  │  ├── add    → "New file: report.pdf"      │ │
│  │  ├── change → "Modified: budget.xlsx"     │ │
│  │  ├── unlink → "Deleted: old-draft.docx"   │ │
│  │  └── error  → log + retry                 │ │
│  └────────────────────┬─────────────────────┘ │
│                       │                        │
│                       ▼                        │
│  ┌──────────────────────────────────────────┐ │
│  │      Event Processor                      │ │
│  │                                           │ │
│  │  1. Debounce (500ms, group rapid edits)   │ │
│  │  2. Filter (ignore .git, node_modules)    │ │
│  │  3. Classify importance:                  │ │
│  │     - HIGH: .env, config, credentials     │ │
│  │     - MEDIUM: documents, code files       │ │
│  │     - LOW: logs, temp files, caches       │ │
│  │  4. Action based on classification:       │ │
│  │     - HIGH → immediate notification       │ │
│  │     - MEDIUM → batch summary (5min)       │ │
│  │     - LOW → silently log                  │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  Optional: Auto-backup important file changes  │
│  → Copy to .nova-backup/ with timestamp        │
└───────────────────────────────────────────────┘
```

### 2.3 Macro & Workflow System

```
┌───────────────────────────────────────────────────────────┐
│                  Macro / Workflow Engine                    │
│                                                            │
│  User defines macros via:                                  │
│  1. Chat: "Nova, buat macro 'deploy': git push,           │
│           run tests, notify me when done"                  │
│  2. Config file: macros.yaml                               │
│  3. Voice: "Hey Nova, save this as a macro called deploy"  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Macro Definition (macros.yaml)                       │ │
│  │                                                       │ │
│  │  macros:                                              │ │
│  │    - name: deploy                                     │ │
│  │      trigger: "deploy" | "deploy project"             │ │
│  │      steps:                                           │ │
│  │        - action: run_command                          │ │
│  │          command: "git push origin main"              │ │
│  │          timeout: 30s                                 │ │
│  │        - action: run_command                          │ │
│  │          command: "pnpm test"                         │ │
│  │          timeout: 120s                                │ │
│  │        - action: notify                               │ │
│  │          message: "Deploy complete!"                  │ │
│  │          channels: [desktop, mobile, voice]           │ │
│  │        - action: conditional                          │ │
│  │          if: "step[1].exitCode !== 0"                 │ │
│  │          then:                                        │ │
│  │            - action: speak                            │ │
│  │              text: "Tests failed on deploy"           │ │
│  │                                                       │ │
│  │    - name: morning_routine                            │ │
│  │      trigger: "good morning" | "mulai hari"           │ │
│  │      schedule: "0 7 * * 1-5"  (cron: weekdays 7am)   │ │
│  │      steps:                                           │ │
│  │        - action: iot_scene                            │ │
│  │          scene: morning                               │ │
│  │        - action: speak                                │ │
│  │          text: "Good morning! Here's your briefing:"  │ │
│  │        - action: generate                             │ │
│  │          prompt: "Summarize my calendar, weather,     │ │
│  │                   and pending tasks for today"         │ │
│  │        - action: speak                                │ │
│  │          text: "{{step[2].result}}"                   │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Macro Execution Engine                               │ │
│  │                                                       │ │
│  │  1. Parse trigger keyword from user input             │ │
│  │  2. Load macro definition                             │ │
│  │  3. Execute steps sequentially:                       │ │
│  │     - run_command → execa with timeout                │ │
│  │     - notify → NotificationDispatcher                 │ │
│  │     - speak → VoiceIO.speak()                         │ │
│  │     - iot_scene → SceneManager.execute()              │ │
│  │     - generate → orchestrator.generate()              │ │
│  │     - conditional → evaluate expression               │ │
│  │  4. Template substitution: {{step[N].result}}         │ │
│  │  5. Error handling: continue | abort | retry          │ │
│  │  6. Result aggregation → summary to user              │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

### 2.4 CaMeL Security Architecture

```
┌───────────────────────────────────────────────────────────────┐
│              CaMeL Security Layer                               │
│              (Capabilities for Machine Learning)                │
│                                                                 │
│  Based on: CaMeL paper — defense against indirect prompt        │
│  injection by separating control flow from data flow.           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    Existing Security                       │ │
│  │                                                            │ │
│  │  prompt-filter.ts → Detect injection patterns ✅          │ │
│  │  affordance-checker.ts → Risk scoring ✅                  │ │
│  │  output-scanner.ts → Redact secrets ✅                    │ │
│  │  tool-guard.ts → Block dangerous commands ✅              │ │
│  │  dual-agent-reviewer.ts → Two-agent review ✅             │ │
│  │  memory-validator.ts → Memory injection defense ✅        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    CaMeL Addition                          │ │
│  │                                                            │ │
│  │  Problem: LLM reads untrusted data (emails, web pages,    │ │
│  │  memory contents) that may contain injected instructions.  │ │
│  │  Even with prompt filtering, clever injections can slip    │ │
│  │  through and cause tool misuse.                           │ │
│  │                                                            │ │
│  │  CaMeL Solution:                                          │ │
│  │  ┌────────────────────────────────────────────────────┐   │ │
│  │  │  1. Capability Tokens                               │   │ │
│  │  │     - Each tool call requires a capability token    │   │ │
│  │  │     - Tokens are granted only by the control LLM    │   │ │
│  │  │     - Data (memory, web content) cannot forge tokens│   │ │
│  │  │                                                     │   │ │
│  │  │  2. Taint Tracking                                  │   │ │
│  │  │     - Mark data from untrusted sources as "tainted" │   │ │
│  │  │     - Tainted data cannot be used as tool arguments │   │ │
│  │  │     - Only user-provided or verified data is "clean"│   │ │
│  │  │                                                     │   │ │
│  │  │  3. Control/Data Separation                         │   │ │
│  │  │                                                     │   │ │
│  │  │  ┌─────────────┐    ┌─────────────────┐           │   │ │
│  │  │  │ Control LLM │    │ Data LLM        │           │   │ │
│  │  │  │ (planning,  │    │ (reading emails, │           │   │ │
│  │  │  │  deciding   │    │  summarizing,    │           │   │ │
│  │  │  │  tool calls)│    │  extracting info)│           │   │ │
│  │  │  └──────┬──────┘    └────────┬────────┘           │   │ │
│  │  │         │                     │                    │   │ │
│  │  │         │ (grants capability) │ (returns data)     │   │ │
│  │  │         ▼                     ▼                    │   │ │
│  │  │  ┌──────────────────────────────────┐             │   │ │
│  │  │  │ Tool Executor (with CaMeL gate) │             │   │ │
│  │  │  │                                  │             │   │ │
│  │  │  │ Checks:                          │             │   │ │
│  │  │  │ 1. Valid capability token?       │             │   │ │
│  │  │  │ 2. Arguments not tainted?        │             │   │ │
│  │  │  │ 3. Permission scope matches?     │             │   │ │
│  │  │  │ 4. Human approval if HIGH risk?  │             │   │ │
│  │  │  └──────────────────────────────────┘             │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### 2.5 Mobile Notification + Macro UI

```
┌────────────────────────────────────────────────┐
│         MOBILE (React Native Expo)              │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │         Notification Center               │  │
│  │                                           │  │
│  │  🔋 Battery rendah (15%)       2m ago    │  │
│  │  📅 Meeting dengan Tim         in 10min  │  │
│  │  📁 budget.xlsx dimodifikasi   5m ago    │  │
│  │  🔓 Front door unlocked        10m ago   │  │
│  │  ✅ Deploy berhasil!           15m ago   │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │         Quick Macros                      │  │
│  │                                           │  │
│  │  [🚀 Deploy] [🌅 Morning] [📊 Report]    │  │
│  │  [🔒 Lock Up] [Custom +]                 │  │
│  │                                           │  │
│  │  Long-press to edit macro                 │  │
│  │  Tap to execute                           │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │         Macro Builder (new screen)        │  │
│  │                                           │  │
│  │  Name: [___________]                      │  │
│  │  Trigger: [voice/text/schedule]           │  │
│  │                                           │  │
│  │  Steps:                                   │  │
│  │  1. [Run Command ▼] [git push]           │  │
│  │  2. [Notify ▼] [Deploy done!]            │  │
│  │  [+ Add Step]                             │  │
│  │                                           │  │
│  │  [Save Macro]                             │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

---

## 3. Komponen yang Harus Dibangun

### 3.1 Desktop Notification System

**File:** NEW `orion-ts/src/os-agent/notification.ts`

```typescript
export class NotificationDispatcher {
  /**
   * Send notification to all configured channels.
   */
  async send(notification: {
    title: string
    body: string
    priority: "low" | "medium" | "high"
    channels?: ("desktop" | "mobile" | "voice")[]
    icon?: string
  }): Promise<void> {
    const targets = notification.channels ?? ["desktop", "mobile"]
    
    await Promise.allSettled(
      targets.map(channel => {
        switch (channel) {
          case "desktop": return this.sendDesktop(notification)
          case "mobile":  return this.sendMobile(notification)
          case "voice":   return this.sendVoice(notification)
        }
      })
    )
  }
  
  private async sendDesktop(n: Notification): Promise<void> {
    if (process.platform === "win32") {
      // Windows Toast Notification via PowerShell
      const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName("text")
$texts[0].AppendChild($xml.CreateTextNode("${escapePS(n.title)}")) | Out-Null
$texts[1].AppendChild($xml.CreateTextNode("${escapePS(n.body)}")) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Nova").Show($toast)
`
      await execa("powershell", ["-command", ps])
    } else if (process.platform === "darwin") {
      await execa("osascript", ["-e", 
        `display notification "${n.body}" with title "${n.title}"`
      ])
    } else {
      await execa("notify-send", [n.title, n.body])
    }
  }
  
  private async sendMobile(n: Notification): Promise<void> {
    // Send via WebSocket to connected mobile clients
    gateway.broadcastToChannel("mobile", {
      type: "notification",
      title: n.title,
      body: n.body,
      priority: n.priority,
    })
  }
  
  private async sendVoice(n: Notification): Promise<void> {
    // Speak notification via TTS
    await voiceIO.speak(`${n.title}. ${n.body}`)
  }
}
```

### 3.2 File Watcher

**File:** NEW `orion-ts/src/os-agent/file-watcher.ts`

**Dependency:** `chokidar` (file system watcher)

```typescript
import { watch } from "chokidar"

export class FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null
  private eventBuffer: FileEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  
  async start(paths: string[]): Promise<void> {
    this.watcher = watch(paths, {
      ignored: /(^|[\/\\])\.|node_modules|\.git|__pycache__/,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    })
    
    this.watcher
      .on("add", path => this.handleEvent("add", path))
      .on("change", path => this.handleEvent("change", path))
      .on("unlink", path => this.handleEvent("unlink", path))
  }
  
  private handleEvent(type: string, filePath: string): void {
    const importance = this.classifyImportance(filePath)
    
    if (importance === "high") {
      // Immediate notification
      notificationDispatcher.send({
        title: `⚠️ Important file ${type}`,
        body: filePath,
        priority: "high",
        channels: ["desktop", "mobile"],
      })
    } else {
      // Buffer for batch summary
      this.eventBuffer.push({ type, path: filePath, time: Date.now() })
      this.scheduleFlush()
    }
  }
  
  private classifyImportance(filePath: string): "high" | "medium" | "low" {
    const base = path.basename(filePath).toLowerCase()
    if (/\.env|\.ssh|credentials|secrets|\.key|\.pem/.test(base)) return "high"
    if (/\.ts|\.js|\.py|\.md|\.docx|\.xlsx|\.pdf/.test(base)) return "medium"
    return "low"
  }
}
```

### 3.3 Macro Engine

**File:** NEW `orion-ts/src/os-agent/macro-engine.ts`

**Capabilities:**
- Load macros from YAML config + runtime chat definitions
- Execute steps sequentially with error handling
- Template substitution (`{{step[N].result}}`)
- Conditional steps
- Schedule via cron (day/time triggers)
- Voice trigger matching

### 3.4 CaMeL Security Module

**File:** NEW `orion-ts/src/security/camel-guard.ts`

**Implementation phases:**
1. **Taint tracking** — tag all data from untrusted sources (memory, web, email)
2. **Capability tokens** — tool calls require valid token from control flow
3. **Control/Data separation** — separate LLM calls for planning vs data processing

### 3.5 Mobile Notification Screen

**File:** NEW `apps/mobile/screens/Notifications.tsx`

- Real-time notification list via WebSocket
- Priority-based sorting (high → low)
- Swipe to dismiss
- Tap to take action (e.g., "Lock the door" → trigger IoT action)

### 3.6 Mobile Macro UI

**File:** NEW `apps/mobile/screens/MacroBuilder.tsx`

- Visual macro builder (drag & drop steps)
- Quick-launch grid for saved macros
- Haptic confirmation on macro execution

---

## 4. Dependency Tree

```
Production Dependencies:
├── chokidar             # File watcher — NEW
├── node-cron            # Scheduled macro triggers — NEW
└── (no other new deps)

Mobile Dependencies:
├── expo-notifications   # ✅ Already installed (~0.27.0)
├── expo-haptics         # ✅ If installed in Phase 4
└── @react-native-async-storage/async-storage  # ✅ Already available via Expo
```

---

## 5. Implementation Roadmap

### Week 1: Notifications + File Watcher

| Task | File | Detail |
|------|------|--------|
| NotificationDispatcher class | notification.ts | Desktop toast (Win/Mac/Linux) + mobile push |
| Install chokidar | package.json | `pnpm add chokidar` |
| FileWatcher class | file-watcher.ts | Watch paths, classify, buffer, notify |
| Wire into SystemMonitor | system-monitor.ts | Start file watcher on init |
| Daemon trigger → notification | daemon.ts | Wire trigger evaluation to dispatcher |
| Mobile: notification display | App.tsx | Handle "notification" WS message |
| Mobile: Notifications screen | Notifications.tsx | History list with actions |
| Tests: notification dispatch | __tests__/ | Mock execa, verify PS/osascript calls |
| Tests: file watcher events | __tests__/ | Mock chokidar, verify classification |

### Week 2: Macro Engine

| Task | File | Detail |
|------|------|--------|
| Macro definition types | types.ts | MacroDef, MacroStep, MacroTrigger |
| Macro YAML loader | macro-engine.ts | Load from macros.yaml |
| Step executor | macro-engine.ts | run_command, notify, speak, iot, generate |
| Template substitution | macro-engine.ts | `{{step[N].result}}` expansion |
| Conditional steps | macro-engine.ts | if/then/else evaluation |
| Cron scheduler | macro-engine.ts | node-cron for time-based triggers |
| Voice trigger matching | macro-engine.ts | Match user speech to macro name/alias |
| Chat-based macro creation | macro-engine.ts | "Nova, create a macro..." → parse + save |
| Mobile: MacroBuilder screen | MacroBuilder.tsx | Visual step builder |
| Mobile: Quick-launch grid | App.tsx | Macro buttons in chat screen |
| Tests: macro execution | __tests__/ | Full macro flow with mocked steps |

### Week 3: CaMeL Security

| Task | File | Detail |
|------|------|--------|
| Taint tracking system | camel-guard.ts | Tag untrusted data sources |
| Capability token generator | camel-guard.ts | Crypto tokens for tool permissions |
| Tool executor CaMeL gate | tool-guard.ts | Verify capability + taint before execution |
| Control/Data LLM separation | camel-guard.ts | Separate prompt paths |
| Integration with pipeline | incoming-message.ts | Wire CaMeL into message flow |
| Tests: taint propagation | __tests__/ | Verify tainted data can't trigger tools |
| Tests: capability tokens | __tests__/ | Valid/invalid/expired tokens |
| Security audit | manual | Attempt injection through memory + web data |

### Week 4: Polish + Integration

| Task | File | Detail |
|------|------|--------|
| End-to-end testing | __tests__/ | Full flow: event → trigger → notify |
| Performance optimization | all | Minimize daemon CPU footprint |
| Documentation | docs/ | Setup guide for macros, file watcher, CaMeL |
| Mobile polish | apps/mobile/ | Animations, error states, offline mode |
| Load testing | manual | 100+ file changes, 50+ device states |

---

## 6. Android-Specific Considerations

### Push Notifications (expo-notifications)
```typescript
// Already installed — configure for background delivery
import * as Notifications from "expo-notifications"

// Request permission (Android 13+ requires runtime permission)
const { status } = await Notifications.requestPermissionsAsync()

// Configure channels (Android-specific)
await Notifications.setNotificationChannelAsync("nova-alerts", {
  name: "Nova Alerts",
  importance: Notifications.AndroidImportance.HIGH,
  vibrationPattern: [0, 250, 250, 250],
  lightColor: "#2196F3",
  sound: "notification.wav",
})

await Notifications.setNotificationChannelAsync("nova-info", {
  name: "Nova Info", 
  importance: Notifications.AndroidImportance.DEFAULT,
})
```

### Background Processing
- Android doze mode: notifications may be delayed → use high-priority channel
- WebSocket keep-alive: send ping every 30s to prevent Android killing connection
- WorkManager integration (future): schedule macro execution even when app is backgrounded

### Macro Quick-Launch Widget
```
Android Widget (future, requires native module):
┌──────────────────────────┐
│  Nova Macros             │
│  [🌅] [🚀] [🔒] [+]    │
│   AM  Deploy Lock  More  │
└──────────────────────────┘
```

### Offline Macro Execution
- Cache macro definitions in AsyncStorage
- Queue macro trigger → execute when online
- Local-only macros (notification, speak) work offline

---

## 7. Proactive Trigger Examples

| Trigger | Condition | Action | Cooldown |
|---------|-----------|--------|----------|
| Battery Low | `battery < 20%` | Desktop toast + mobile push + voice | 30min |
| Meeting Reminder | `calendar.next < 15min` | Voice announce + mobile push | Per event |
| High CPU | `cpu > 90% for 5min` | Desktop toast: "CPU tinggi — cek proses" | 15min |
| Disk Almost Full | `disk > 90%` | Desktop + mobile: "Disk hampir penuh" | 2hr |
| Door Unlocked Late | `lock.state == "unlocked" && time > 22:00` | Voice + mobile: "Pintu belum dikunci" | 30min |
| New Device on Network | `network.device_count increased` | Mobile push: security alert | Per event |
| File Modified (.env) | `file.change on *.env` | Immediate all channels | Per event |
| Long Idle (coding) | `idle > 90min && activity == "coding"` | Voice: "Istirahat sebentar?" | 2hr |
| Weather Alert | `weather.alert == true` | Mobile push + voice | Per alert |
| Download Complete | `file.add in ~/Downloads` | Desktop toast: "Download selesai" | None |

---

## 8. Testing Strategy

```
Unit Tests (15 tests):
├── NotificationDispatcher: desktop toast (Win/Mac/Linux)
├── NotificationDispatcher: mobile push via WS
├── NotificationDispatcher: voice TTS
├── FileWatcher: high importance file triggers immediate notify
├── FileWatcher: medium importance file buffered
├── FileWatcher: ignored patterns (.git, node_modules)
├── MacroEngine: load from YAML
├── MacroEngine: execute sequential steps
├── MacroEngine: template substitution
├── MacroEngine: conditional step evaluation
├── MacroEngine: error on step → abort/continue
├── MacroEngine: voice trigger matching
├── CaMeL: tainted data blocked from tool args
├── CaMeL: valid capability token allows execution
└── CaMeL: expired/forged token rejected

Integration Tests (5 tests):
├── Daemon trigger → NotificationDispatcher → desktop + mobile
├── File change → FileWatcher → NotificationDispatcher
├── Voice trigger → MacroEngine → multi-step execution
├── Schedule trigger → MacroEngine → IoT scene + notify
└── CaMeL: injected memory content cannot trigger tool execution
```

---

## 9. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `src/os-agent/notification.ts` | NEW: Multi-channel notification dispatcher | +200 |
| `src/os-agent/file-watcher.ts` | NEW: File system watcher with classification | +180 |
| `src/os-agent/macro-engine.ts` | NEW: Macro definition, loader, executor | +350 |
| `src/os-agent/types.ts` | Add MacroDef, NotificationPayload types | +40 |
| `src/security/camel-guard.ts` | NEW: CaMeL taint tracking + capability tokens | +300 |
| `src/security/tool-guard.ts` | Wire CaMeL gate into tool execution | +30 |
| `src/background/daemon.ts` | Wire triggers to NotificationDispatcher | +20 |
| `src/os-agent/system-monitor.ts` | Wire FileWatcher start | +15 |
| `src/gateway/server.ts` | Notification + macro WS handlers | +40 |
| `apps/mobile/screens/Notifications.tsx` | NEW: Notification history screen | +200 |
| `apps/mobile/screens/MacroBuilder.tsx` | NEW: Visual macro builder | +250 |
| `apps/mobile/App.tsx` | Navigation + notification handler | +30 |
| `macros.yaml` | NEW: Default macro definitions | +50 |
| `src/os-agent/__tests__/notification.test.ts` | NEW | +80 |
| `src/os-agent/__tests__/file-watcher.test.ts` | NEW | +80 |
| `src/os-agent/__tests__/macro-engine.test.ts` | NEW | +120 |
| `src/security/__tests__/camel-guard.test.ts` | NEW | +100 |
| `orion-ts/package.json` | Add chokidar, node-cron | +2 |
| **Total** | | **~2087 lines** |

---

## 10. Total Project Summary (All 6 Phases)

| Phase | Focus | Est. Lines | Duration |
|-------|-------|-----------|----------|
| Phase 1 | Voice Input Pipeline | ~1015 | 2-3 weeks |
| Phase 2 | OS-Agent Test Suite | ~1620 | 1-2 weeks |
| Phase 3 | Vision Intelligence | ~690 | 2 weeks |
| Phase 4 | IoT & Smart Home | ~1151 | 1-2 weeks |
| Phase 5 | Critical Bug Fixes | ~181 | 3-5 days |
| Phase 6 | Advanced JARVIS Features | ~2087 | 3-4 weeks |
| **Total** | | **~6744 lines** | **~12-15 weeks** |

**Recommended Execution Order:**
1. **Phase 5** (Bug Fixes) — paling cepat, paling critical
2. **Phase 2** (Tests) — foundation untuk development selanjutnya
3. **Phase 1** (Voice) — core JARVIS feature
4. **Phase 3** (Vision) — enables smart GUI automation
5. **Phase 4** (IoT) — smart home completion
6. **Phase 6** (Advanced) — polish dan pro features
