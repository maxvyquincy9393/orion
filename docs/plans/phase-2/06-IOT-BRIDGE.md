# Atom 5 — iot-bridge.test.ts

**File target:** `src/os-agent/__tests__/iot-bridge.test.ts`  
**Source yang ditest:** `src/os-agent/iot-bridge.ts`  
**Dependencies:** Atom 0 (test-helpers), fixtures/ha-entities.json  
**Tests:** 10 tests  
**Coverage target:** 85%

---

## Apa yang Harus Diperbaiki di Source (`iot-bridge.ts`)

### 1. `initHomeAssistant()` pakai global `fetch`

```typescript
private async initHomeAssistant(): Promise<void> {
  const response = await fetch(`${this.config.homeAssistantUrl}/api/`, {
    headers: { Authorization: `Bearer ${this.config.homeAssistantToken}` },
  })
  // ...
}
```

**Masalah:** `fetch` adalah global di Node 18+. Untuk mock, gunakan `vi.stubGlobal("fetch", vi.fn())`.

### 2. Rate limiting di `refreshHAEntities()`

```typescript
private static readonly HA_REFRESH_MIN_INTERVAL_MS = 30_000
private lastHARefresh = 0

private async refreshHAEntities(): Promise<void> {
  const now = Date.now()
  if (now - this.lastHARefresh < IoTBridge.HA_REFRESH_MIN_INTERVAL_MS && this.haEntities.length > 0) {
    return  // ← Skip refresh kalau terlalu cepat
  }
  // fetch entities...
}
```

**Test untuk rate limit:** Panggil `getStates()` dua kali cepat — fetch hanya boleh dipanggil sekali. Untuk test yang ke-2, advance `Date.now()` > 30s.

### 3. `parseNaturalLanguage()` adalah pure function (tidak perlu init)

```typescript
parseNaturalLanguage(command: string): Array<{...}> {
  // Regex matching, tidak butuh network
}
```

**Implikasi:** Test NL parsing TIDAK perlu `initialize()`, bisa langsung panggil method.

### 4. `execute()` bergantung pada `initialized` flag

```typescript
async execute(payload: IoTActionPayload): Promise<OSActionResult> {
  if (!this.initialized) {
    return { success: false, error: "IoT Bridge not initialized" }
  }
  // ...
}
```

### 5. MQTT masih placeholder (`executeMQTT` selalu return error)

```typescript
private async executeMQTT(payload: IoTActionPayload): Promise<OSActionResult> {
  if (!this.mqttConnected) {
    return { success: false, error: "MQTT not connected" }
  }
  return { success: false, error: "MQTT publish not yet implemented" }
}
```

**Implikasi:** Tidak ada test MQTT yang bisa pass karena sengaja tidak diimplementasi. Lewati.

---

## Mock Setup

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { IoTBridge } from "../iot-bridge.js"
import { createMockIoTConfig, mockFetchOk, mockFetchFail } from "./test-helpers.js"
import haEntities from "./fixtures/ha-entities.json"
import haServiceResponse from "./fixtures/ha-service-response.json"

// Mock fetch global
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
```

---

## Test Cases Detail (10 tests)

### Group 1: Initialization

#### Test 1 — connects to HA and discovers entities

```typescript
it("connects to Home Assistant and discovers entities", async () => {
  // Mock: /api/ → ok, /api/states → entity list
  vi.mocked(fetch).mockImplementation((url: any) => {
    if (String(url).endsWith("/api/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ message: "API running." }) }) as any
    }
    if (String(url).includes("/api/states")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(haEntities) }) as any
    }
    return Promise.resolve({ ok: false, status: 404 }) as any
  })

  const iot = new IoTBridge(createMockIoTConfig({
    enabled: true,
    homeAssistantUrl: "http://localhost:8123",
    homeAssistantToken: "test_token",
    autoDiscover: true,
  }))

  await iot.initialize()

  const states = await iot.getStates()
  expect(states.connectedDevices).toBe(3)
  expect(states.devices.length).toBe(3)
  expect(states.devices[0].entityId).toBe("light.bedroom")
})
```

#### Test 2 — warns when HA token missing (tapi tidak crash)

```typescript
it("warns when HA token missing", async () => {
  const iot = new IoTBridge(createMockIoTConfig({
    enabled: true,
    homeAssistantUrl: "http://localhost:8123",
    homeAssistantToken: undefined, // ← tidak ada token
    autoDiscover: false,
  }))

  // Tidak boleh throw meski token missing
  await expect(iot.initialize()).resolves.not.toThrow()
  // fetch tidak dipanggil karena token undefined
  expect(vi.mocked(fetch)).not.toHaveBeenCalled()
})
```

#### Test 3 — skips when disabled

```typescript
it("skips when disabled", async () => {
  const iot = new IoTBridge(createMockIoTConfig({ enabled: false }))
  await iot.initialize()

  // fetch tidak pernah dipanggil
  expect(vi.mocked(fetch)).not.toHaveBeenCalled()

  // execute harus return not initialized
  const result = await iot.execute({
    target: "home_assistant",
    domain: "light",
    service: "turn_on",
    entityId: "light.bedroom",
  })
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/not initialized/i)
})
```

---

### Group 2: HA Execution

#### Test 4 — calls HA service API for light.turn_on

```typescript
it("calls HA service API for light.turn_on", async () => {
  vi.mocked(fetch).mockImplementation((url: any) => {
    if (String(url).endsWith("/api/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }) as any
    }
    if (String(url).includes("/api/services/light/turn_on")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(haServiceResponse) }) as any
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }) as any
  })

  const iot = new IoTBridge(createMockIoTConfig({
    enabled: true,
    homeAssistantUrl: "http://localhost:8123",
    homeAssistantToken: "valid_token",
    autoDiscover: false,
  }))
  await iot.initialize()

  const result = await iot.execute({
    target: "home_assistant",
    domain: "light",
    service: "turn_on",
    entityId: "light.bedroom",
  })

  expect(result.success).toBe(true)

  // Pastikan fetch dipanggil ke endpoint yang benar
  const serviceCall = vi.mocked(fetch).mock.calls.find(
    (c) => String(c[0]).includes("/api/services/light/turn_on")
  )
  expect(serviceCall).toBeDefined()

  // Body harus contain entity_id
  const body = JSON.parse(serviceCall![1]?.body as string)
  expect(body.entity_id).toBe("light.bedroom")
})
```

#### Test 5 — handles HA API error response

```typescript
it("handles HA API error response", async () => {
  vi.mocked(fetch).mockImplementation((url: any) => {
    if (String(url).endsWith("/api/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }) as any
    }
    // Service call gagal
    return Promise.resolve({ ok: false, status: 401, statusText: "Unauthorized" }) as any
  })

  const iot = new IoTBridge(createMockIoTConfig({
    enabled: true,
    homeAssistantUrl: "http://localhost:8123",
    homeAssistantToken: "invalid_token",
    autoDiscover: false,
  }))
  await iot.initialize()

  const result = await iot.execute({
    target: "home_assistant",
    domain: "light",
    service: "turn_on",
    entityId: "light.bedroom",
  })

  expect(result.success).toBe(false)
  expect(result.error).toMatch(/401|Unauthorized/i)
})
```

#### Test 6 — rate-limits entity refresh to 30s

```typescript
it("rate-limits entity refresh to 30 seconds", async () => {
  vi.mocked(fetch).mockImplementation((url: any) => {
    if (String(url).endsWith("/api/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }) as any
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(haEntities) }) as any
  })

  const iot = new IoTBridge(createMockIoTConfig({
    enabled: true,
    homeAssistantUrl: "http://localhost:8123",
    homeAssistantToken: "token",
    autoDiscover: true,
  }))
  await iot.initialize()

  const fetchCountAfterInit = vi.mocked(fetch).mock.calls.length

  // Call getStates() dua kali berturut-turut (< 30s)
  await iot.getStates()
  await iot.getStates()

  // Fetch tidak boleh nambah (rate limited)
  expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCountAfterInit)
})
```

---

### Group 3: Natural Language Parsing

#### Test 7 — "nyalakan lampu kamar" → light.turn_on bedroom

```typescript
it("parses 'nyalakan lampu kamar' → light.turn_on bedroom", () => {
  const iot = new IoTBridge(createMockIoTConfig())

  const result = iot.parseNaturalLanguage("nyalakan lampu kamar")

  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({
    domain: "light",
    service: "turn_on",
    entityId: "light.bedroom",
  })
})
```

#### Test 8 — "set suhu 24" → climate.set_temperature 24

```typescript
it("parses 'set suhu 24' → climate.set_temperature 24", () => {
  const iot = new IoTBridge(createMockIoTConfig())

  const result = iot.parseNaturalLanguage("set suhu 24")

  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({
    domain: "climate",
    service: "set_temperature",
    data: { temperature: 24 },
  })
})
```

#### Test 9 — "kunci pintu" → lock.lock front_door

```typescript
it("parses 'kunci pintu' → lock.lock front_door", () => {
  const iot = new IoTBridge(createMockIoTConfig())

  const result = iot.parseNaturalLanguage("kunci pintu")

  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({
    domain: "lock",
    service: "lock",
    entityId: "lock.front_door",
  })
})
```

---

### Group 4: States

#### Test 10 — returns device states with friendly names

```typescript
it("returns device states with friendly names", async () => {
  vi.mocked(fetch).mockImplementation((url: any) => {
    if (String(url).endsWith("/api/")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }) as any
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(haEntities) }) as any
  })

  const iot = new IoTBridge(createMockIoTConfig({
    enabled: true,
    homeAssistantUrl: "http://localhost:8123",
    homeAssistantToken: "token",
    autoDiscover: true,
  }))
  await iot.initialize()

  const states = await iot.getStates()

  expect(states.connectedDevices).toBeGreaterThan(0)
  const bedroom = states.devices.find((d) => d.entityId === "light.bedroom")
  expect(bedroom?.friendlyName).toBe("Bedroom Light")
  expect(bedroom?.state).toBe("on")
  expect(bedroom?.domain).toBe("light")
})
```

---

## Checklist

- [ ] Test 1: connect HA + discover entities ✅/❌
- [ ] Test 2: missing token no crash ✅/❌
- [ ] Test 3: disabled ✅/❌
- [ ] Test 4: light.turn_on API call ✅/❌
- [ ] Test 5: HA error response ✅/❌
- [ ] Test 6: rate limit 30s ✅/❌
- [ ] Test 7: NL "nyalakan lampu kamar" ✅/❌
- [ ] Test 8: NL "set suhu 24" ✅/❌
- [ ] Test 9: NL "kunci pintu" ✅/❌
- [ ] Test 10: getStates friendly names ✅/❌
- [ ] Coverage ≥ 85%
