# Phase 4 — IoT & Smart Home Completion (MQTT + Extended NL + Scenes)

**Durasi Estimasi:** 1–2 minggu  
**Prioritas:** 🟡 MEDIUM — Fitur JARVIS smart home  
**Status Saat Ini:** HA REST API ✅ | HA Rate Limiting ✅ | NL Parser (basic) ✅ | MQTT ❌ | Scenes ❌ | Mobile Control ❌  

---

## 1. Tujuan

Upgrade IoTBridge dari "bisa nyalakan lampu via HA" menjadi full smart home control:
1. **MQTT Client** → Direct device control tanpa Home Assistant
2. **Extended NL Parser** → Lebih banyak perintah (scene, media, sensor reading, automation)
3. **Scene Management** → "Good night" → lampu off + kunci pintu + AC 25° + alarm on
4. **Room/Device Discovery** → Auto-detect devices, learn nama/lokasi
5. **Mobile IoT Dashboard** → Control smart home dari HP Android

---

## 2. Arsitektur Sistem

### 2.1 Full IoT Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       IoT Bridge (Orion)                         │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  Natural Language Parser                    │  │
│  │                                                             │  │
│  │  User: "matikan semua lampu dan kunci pintu"               │  │
│  │                    │                                        │  │
│  │                    ▼                                        │  │
│  │  ┌───────────┐  ┌──────────┐  ┌──────────────┐           │  │
│  │  │ Rule-based│  │ LLM-based│  │ Hybrid       │           │  │
│  │  │ Regex     │──│ Fallback │──│ (Rule first, │           │  │
│  │  │ Parser    │  │ Parser   │  │  LLM if fail)│           │  │
│  │  └─────┬─────┘  └────┬─────┘  └──────┬───────┘           │  │
│  │        │              │               │                    │  │
│  │        └──────────────┴───────────────┘                    │  │
│  │                       │                                     │  │
│  │                       ▼                                     │  │
│  │        [ { domain: "light", service: "turn_off",           │  │
│  │            entityId: "light.all" },                         │  │
│  │          { domain: "lock", service: "lock",                │  │
│  │            entityId: "lock.front_door" } ]                 │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                         │                                         │
│           ┌─────────────┴─────────────┐                          │
│           ▼                           ▼                           │
│  ┌──────────────────┐       ┌──────────────────┐                │
│  │  Home Assistant   │       │  MQTT Direct      │                │
│  │  REST API         │       │  Client            │                │
│  │                   │       │                   │                │
│  │  /api/services/   │       │  Zigbee2MQTT      │                │
│  │  /api/states      │       │  Tasmota           │                │
│  │  /api/events      │       │  ESPHome           │                │
│  │  WebSocket (push) │       │  Custom Devices    │                │
│  └──────────────────┘       └──────────────────┘                │
│           │                           │                           │
│           └─────────────┬─────────────┘                          │
│                         ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Device Registry                          │  │
│  │                                                             │  │
│  │  In-memory cache of all devices:                           │  │
│  │  { entityId, friendlyName, domain, room, state,            │  │
│  │    lastChanged, capabilities, source: "ha" | "mqtt" }      │  │
│  │                                                             │  │
│  │  Auto-refresh: every 60s (HA) + MQTT subscription (push)   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Scene Manager                            │  │
│  │                                                             │  │
│  │  Presets:                                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │  │
│  │  │ "Good Night" │  │ "Movie Time" │  │ "Good Morning"│    │  │
│  │  │ - lights off │  │ - dim lights │  │ - lights on   │    │  │
│  │  │ - lock door  │  │ - TV on      │  │ - AC off      │    │  │
│  │  │ - AC 25°     │  │ - curtain    │  │ - coffee on   │    │  │
│  │  │ - alarm on   │  │   close      │  │ - curtain open│    │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │  │
│  │                                                             │  │
│  │  Custom: user defines via chat or config file               │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 MQTT Architecture

```
┌───────────────────────────────────────────────┐
│            MQTT Broker (e.g., Mosquitto)        │
│            mqtt://192.168.1.x:1883              │
│                                                  │
│  Topics:                                         │
│  ├── zigbee2mqtt/+/set       (command)          │
│  ├── zigbee2mqtt/+/state     (state update)     │
│  ├── tasmota/+/cmnd/#        (command)          │
│  ├── tasmota/+/stat/#        (state update)     │
│  ├── homeassistant/+/+/state (HA discovery)     │
│  └── nova/iot/#              (Nova custom)      │
└───────────────┬───────────────────────────────┘
                │
                │ MQTT.js client
                ▼
┌───────────────────────────────────────────────┐
│         IoTBridge MQTT Module                   │
│                                                  │
│  subscribe("zigbee2mqtt/+/state")               │
│  subscribe("tasmota/+/stat/#")                  │
│                                                  │
│  on("message", (topic, payload) => {            │
│    // Update device registry                    │
│    // Emit event for proactive notifications    │
│  })                                              │
│                                                  │
│  publish("zigbee2mqtt/lamp_bedroom/set",        │
│    JSON.stringify({ state: "ON", brightness: 254 }))  │
│                                                  │
│  Connection: auto-reconnect, QoS 1              │
└───────────────────────────────────────────────┘
```

### 2.3 Mobile IoT Dashboard (Android/iOS)

```
┌────────────────────────────────────────────────┐
│         MOBILE (React Native Expo)              │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │          IoT Dashboard Screen             │  │
│  │                                           │  │
│  │  ┌─────────────────────────────────────┐ │  │
│  │  │ Rooms (tabs/scroll)                  │ │  │
│  │  │ [Bedroom] [Living] [Kitchen] [All]   │ │  │
│  │  └─────────────────────────────────────┘ │  │
│  │                                           │  │
│  │  ┌─────────────────────────────────────┐ │  │
│  │  │ Quick Scenes                         │ │  │
│  │  │ [🌙 Good Night] [🎬 Movie] [☀ Day]  │ │  │
│  │  └─────────────────────────────────────┘ │  │
│  │                                           │  │
│  │  ┌─────────────────────────────────────┐ │  │
│  │  │ Devices                              │ │  │
│  │  │ 💡 Bedroom Light    [ON ●] (toggle) │ │  │
│  │  │ ❄  Bedroom AC       25°   [▲][▼]   │ │  │
│  │  │ 🔒 Front Door Lock  Locked ✓        │ │  │
│  │  │ 📷 Front Camera     [View]          │ │  │
│  │  └─────────────────────────────────────┘ │  │
│  │                                           │  │
│  │  ┌─────────────────────────────────────┐ │  │
│  │  │ Voice: "Hey Nova, matikan lampu"     │ │  │
│  │  │ [🎤 Push to Talk]                   │ │  │
│  │  └─────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  Data flow:                                      │
│  WS → { type: "iot_states" } → device list      │
│  WS → { type: "iot_control", entityId, action }  │
│  WS ← { type: "iot_update", entityId, state }   │
└────────────────────────────────────────────────┘
```

---

## 3. Komponen yang Harus Dibangun

### 3.1 MQTT Client Implementation

**File:** `orion-ts/src/os-agent/iot-bridge.ts` → `initMQTT()` + `executeMQTT()`

**Status:** ❌ Placeholder (hanya log)

**Implementasi:**
```typescript
import mqtt from "mqtt"

private mqttClient: mqtt.MqttClient | null = null

private async initMQTT(): Promise<void> {
  if (!this.config.mqttBrokerUrl) return

  this.mqttClient = mqtt.connect(this.config.mqttBrokerUrl, {
    username: this.config.mqttUsername,
    password: this.config.mqttPassword,
    reconnectPeriod: 5000,
    keepalive: 60,
    clean: true,
    clientId: `nova-iot-${Date.now()}`,
  })

  this.mqttClient.on("connect", () => {
    this.mqttConnected = true
    log.info("MQTT connected", { broker: this.config.mqttBrokerUrl })
    
    // Subscribe to device state topics
    this.mqttClient!.subscribe([
      "zigbee2mqtt/+",        // Zigbee2MQTT devices
      "tasmota/+/stat/#",     // Tasmota devices
      "homeassistant/+/+/state", // HA MQTT discovery
    ])
  })

  this.mqttClient.on("message", (topic, payload) => {
    this.handleMQTTMessage(topic, payload.toString())
  })

  this.mqttClient.on("error", (err) => {
    log.error("MQTT error", { error: String(err) })
  })

  this.mqttClient.on("close", () => {
    this.mqttConnected = false
    log.warn("MQTT disconnected, reconnecting...")
  })
}

private async executeMQTT(payload: IoTActionPayload): Promise<OSActionResult> {
  if (!this.mqttClient || !this.mqttConnected) {
    return { success: false, error: "MQTT not connected" }
  }

  const topic = this.buildMQTTTopic(payload)
  const message = JSON.stringify(payload.data ?? { state: payload.service === "turn_on" ? "ON" : "OFF" })

  return new Promise((resolve) => {
    this.mqttClient!.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        resolve({ success: false, error: String(err) })
      } else {
        resolve({ success: true, data: { topic, message } })
      }
    })
  })
}
```

### 3.2 Extended Natural Language Parser

**File:** `orion-ts/src/os-agent/iot-bridge.ts` → `parseNaturalLanguage()`

**Status:** ⚠️ Basic (hanya light on/off, climate temp, lock)

**Tambahkan command patterns:**

| Pattern (ID/EN) | Parsed Action |
|-----------------|---------------|
| "nyalakan/matikan lampu {room}" | `light.turn_on/off` ✅ sudah ada |
| "atur suhu {N} derajat" | `climate.set_temperature` ✅ sudah ada |
| "kunci/buka pintu" | `lock.lock/unlock` ✅ sudah ada |
| "buka/tutup tirai {room}" | `cover.open/close_cover` ❌ NEW |
| "setel kecerahan lampu {N}%" | `light.turn_on { brightness: N*2.54 }` ❌ NEW |
| "warna lampu {color}" | `light.turn_on { rgb_color: [R,G,B] }` ❌ NEW |
| "play/pause/stop music" | `media_player.play/pause/stop` ❌ NEW |
| "volume {N}%" | `media_player.volume_set { volume_level: N/100 }` ❌ NEW |
| "aktivasi scene {name}" | `scene.turn_on` ❌ NEW |
| "good night / selamat malam" | Scene: goodnight ❌ NEW |
| "movie time / nonton film" | Scene: movie ❌ NEW |
| "berapa suhu/humidity {room}?" | Read sensor state ❌ NEW |
| "siapa di depan pintu?" | Camera snapshot ❌ NEW |
| "nyalakan/matikan alarm" | `alarm_control_panel.arm/disarm` ❌ NEW |
| "vacuum clean {room}" | `vacuum.start` ❌ NEW |
| "tutup gerbang/garage" | `cover.close_cover` ❌ NEW |

**LLM Fallback Parser:**
```typescript
async parseNaturalLanguageLLM(command: string, availableDevices: Device[]): Promise<ParsedCommand[]> {
  const { getOrchestrator } = await import("../engines/orchestrator.js")
  const orchestrator = getOrchestrator()
  
  const deviceList = availableDevices.map(d => 
    `${d.entityId} (${d.friendlyName}, state: ${d.state})`
  ).join("\n")
  
  const result = await orchestrator.generate("fast", {
    prompt: `Parse this IoT command into Home Assistant service calls.
Available devices:
${deviceList}

User command: "${command}"

Return JSON array: [{ domain, service, entityId, data? }]`,
    maxTokens: 200,
  })
  
  return JSON.parse(result.text)
}
```

### 3.3 Scene Manager

**File:** NEW `orion-ts/src/os-agent/scene-manager.ts`

```typescript
interface Scene {
  id: string
  name: string
  aliases: string[]  // "good night", "selamat malam", "tidur"
  actions: SceneAction[]
}

interface SceneAction {
  domain: string
  service: string
  entityId: string
  data?: Record<string, unknown>
  delay?: number  // ms delay before this action
}

const DEFAULT_SCENES: Scene[] = [
  {
    id: "goodnight",
    name: "Good Night",
    aliases: ["good night", "selamat malam", "tidur", "goodnight"],
    actions: [
      { domain: "light", service: "turn_off", entityId: "light.all" },
      { domain: "lock", service: "lock", entityId: "lock.front_door" },
      { domain: "climate", service: "set_temperature", entityId: "climate.bedroom", 
        data: { temperature: 25 } },
      { domain: "alarm_control_panel", service: "arm_night", entityId: "alarm.home" },
    ],
  },
  {
    id: "movie",
    name: "Movie Time",
    aliases: ["movie time", "nonton", "nonton film", "movie"],
    actions: [
      { domain: "light", service: "turn_on", entityId: "light.living_room", 
        data: { brightness: 30, color_temp: 500 } },
      { domain: "cover", service: "close_cover", entityId: "cover.living_room_curtain" },
      { domain: "media_player", service: "turn_on", entityId: "media_player.tv" },
    ],
  },
  {
    id: "morning",
    name: "Good Morning",
    aliases: ["good morning", "selamat pagi", "bangun", "pagi"],
    actions: [
      { domain: "light", service: "turn_on", entityId: "light.bedroom",
        data: { brightness: 200 } },
      { domain: "cover", service: "open_cover", entityId: "cover.bedroom_curtain" },
      { domain: "climate", service: "turn_off", entityId: "climate.bedroom" },
    ],
  },
]
```

### 3.4 IoT Config Extension

**File:** `orion-ts/src/os-agent/types.ts`

**Tambahkan ke IoTConfig:**
```typescript
export interface IoTConfig {
  enabled: boolean
  // Home Assistant (existing)
  homeAssistantUrl?: string
  homeAssistantToken?: string
  autoDiscover?: boolean
  // MQTT (new)
  mqttBrokerUrl?: string
  mqttUsername?: string
  mqttPassword?: string
  mqttTopicPrefix?: string  // default: "nova/iot"
  // Scenes (new)
  scenesEnabled?: boolean
  customScenes?: Scene[]
  // Room mapping (new)
  roomMapping?: Record<string, string[]>  // { "bedroom": ["kamar", "kamar tidur"] }
}
```

### 3.5 Gateway IoT Endpoints

**File:** `orion-ts/src/gateway/server.ts`

**WebSocket messages baru:**

| Direction | Type | Payload |
|-----------|------|---------|
| Client→Server | `iot_states` | `{}` → request all device states |
| Client→Server | `iot_control` | `{ entityId, action, data? }` |
| Client→Server | `iot_scene` | `{ sceneId }` |
| Server→Client | `iot_states_result` | `{ devices: Device[] }` |
| Server→Client | `iot_update` | `{ entityId, state, attributes }` (push on change) |
| Server→Client | `iot_scene_result` | `{ sceneId, actionsExecuted: number }` |

### 3.6 Mobile IoT Dashboard

**File:** NEW `apps/mobile/screens/IoTDashboard.tsx`

**Dependencies:**
```json
{
  "expo-haptics": "~13.0.0"   // Haptic feedback saat tap device toggle
}
```

---

## 4. Dependency Tree

```
Production Dependencies:
├── mqtt                  # MQTT.js client — NEW
└── (no other new deps)

Mobile Dependencies:
├── expo-haptics          # Haptic feedback — NEW  
└── (expo base sudah ada)

Config Files:
├── scenes.yaml           # NEW: Custom scene definitions (optional)
└── room-mapping.yaml     # NEW: Room name aliases (optional)  
```

---

## 5. Implementation Roadmap

### Week 1: MQTT + Extended NL + Scenes

| Task | File | Detail |
|------|------|--------|
| Install mqtt package | package.json | `pnpm add mqtt` |
| Implement MQTT connect | iot-bridge.ts | Auto-connect, reconnect, subscribe |
| Implement MQTT publish | iot-bridge.ts | Build topics for Zigbee2MQTT/Tasmota |
| Handle MQTT messages | iot-bridge.ts | Parse state updates, device registry |
| Extend NL parser (12 patterns) | iot-bridge.ts | Cover, media, brightness, color, scene, etc. |
| Create SceneManager | scene-manager.ts | Default + custom scenes, execute in sequence |
| LLM fallback parser | iot-bridge.ts | When regex fails, use LLM to parse |
| Update IoTConfig types | types.ts | MQTT, scene, room mapping fields |
| Tests: MQTT mock client | __tests__/ | Verify connect, publish, subscribe |
| Tests: NL parser (new patterns) | __tests__/ | 12 new command patterns |

### Week 2: Gateway + Mobile Dashboard

| Task | File | Detail |
|------|------|--------|
| Gateway iot_states handler | server.ts | Return all device states via WS |
| Gateway iot_control handler | server.ts | Execute via HA or MQTT based on source |
| Gateway iot_scene handler | server.ts | Trigger scene execution |
| MQTT push → WS broadcast | server.ts | Real-time state push ke connected clients |
| Mobile: IoTDashboard screen | IoTDashboard.tsx | Room tabs, device list, scene buttons |
| Mobile: Device toggle component | DeviceCard.tsx | ON/OFF switch, slider, color picker |
| Mobile: Scene button component | SceneButton.tsx | Quick-activate preset scenes |
| Mobile: navigation update | App.tsx | Add IoT tab/screen |
| Integration tests | __tests__/ | WS → IoT → response flow |

---

## 6. Android-Specific Considerations

### Performance
- Device states refresh via WebSocket push (real-time, no polling)
- UI renders device cards as FlatList (virtualized for 100+ devices)
- Haptic feedback (`expo-haptics`) on toggle actions

### Background Notifications
```typescript
// Proactive IoT notifications via expo-notifications (already installed)
// Example: Door unlocked → push notification to phone
// Triggered by daemon when MQTT state change detected

import * as Notifications from "expo-notifications"

await Notifications.scheduleNotificationAsync({
  content: {
    title: "🔓 Front Door Unlocked",
    body: "The front door was unlocked at 10:30 PM",
    sound: true,
  },
  trigger: null, // Immediate
})
```

### Offline Fallback
- Cache last-known device states di AsyncStorage
- Show cached states with "offline" indicator
- Queue control commands → execute on reconnect

### Widget (Future)
- Android home screen widget for quick scenes
- Requires `expo-widget` (still experimental) atau native module

---

## 7. Testing Strategy

```
Unit Tests (10 tests — dari Phase 2):
├── MQTT connect + subscribe with mock broker
├── MQTT publish message formation (Zigbee2MQTT topic)
├── MQTT publish message formation (Tasmota topic)
├── MQTT state update → device registry update
├── NL parse: "buka tirai kamar" → cover.open_cover
├── NL parse: "setel kecerahan 50%" → light.turn_on brightness
├── NL parse: "good night" → scene trigger
├── Scene execution: runs all actions in sequence
├── Scene execution: handles partial failure
└── LLM fallback parser: freeform command → structured output

Integration Tests (4 tests):
├── HA + MQTT combined device listing
├── Mobile → WS iot_control → HA execution → state update push
├── Scene trigger → multiple HA service calls
└── MQTT state change → WS push to mobile
```

---

## 8. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `src/os-agent/iot-bridge.ts` | MQTT client, extended NL parser, device registry | +250 |
| `src/os-agent/scene-manager.ts` | NEW: Scene definitions + execution | +150 |
| `src/os-agent/types.ts` | Extended IoTConfig + Scene types | +40 |
| `src/gateway/server.ts` | iot_states, iot_control, iot_scene handlers | +60 |
| `apps/mobile/screens/IoTDashboard.tsx` | NEW: IoT dashboard screen | +300 |
| `apps/mobile/components/DeviceCard.tsx` | NEW: Device control card | +120 |
| `apps/mobile/components/SceneButton.tsx` | NEW: Scene activation button | +60 |
| `apps/mobile/App.tsx` | Add IoT navigation | +20 |
| `src/os-agent/__tests__/iot-bridge.test.ts` | Extended tests | +150 |
| `orion-ts/package.json` | Add mqtt dependency | +1 |
| **Total** | | **~1151 lines** |
