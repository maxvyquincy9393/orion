# Atom 7 — os-agent-tool.test.ts

**File target:** `src/os-agent/__tests__/os-agent-tool.test.ts`  
**Source yang ditest:** `src/os-agent/os-agent-tool.ts`  
**Dependencies:** Atom 0, butuh mock `OSAgent` instance  
**Tests:** 15 tests  
**Coverage target:** 90% — ini main agent interface

---

## Apa yang Harus Diperbaiki di Source (`os-agent-tool.ts`)

### 1. `createOSAgentTool()` pakai Vercel AI SDK `tool()`

```typescript
import { tool } from "ai"
import { z } from "zod"

export function createOSAgentTool(osAgent: OSAgent) {
  return tool({
    description: `...`,
    inputSchema: z.object({ action: z.enum([...]), ... }),
    execute: async (input) => { ... }
  })
}
```

**Masalah:** `tool()` dari `ai` SDK tidak perlu di-mock — kita cukup call `tool.execute` secara langsung. Tapi kita perlu mock `OSAgent` yang dipass ke function.

**Cara test:** Import `createOSAgentTool`, buat mock `OSAgent`, call `tool.execute(input)` langsung.

### 2. Tool `execute()` return `string`, bukan `OSActionResult`

```typescript
execute: async (input) => {
  // ...
  case "screenshot": {
    const result = await osAgent.vision.captureAndAnalyze()
    if (result.success) {
      return `Screen captured (${data.screenshotSize} bytes). OCR text:\n${data.ocrText}`
    }
    return `Screenshot failed: ${result.error}`
  }
}
```

**Implikasi test:** Assert return value adalah STRING, bukan object.

### 3. Validation di execute() pakai early return (bukan Zod validation)

```typescript
case "click": {
  if (input.x === undefined || input.y === undefined) return "Error: x and y coordinates required"
}
case "type": {
  if (!input.text) return "Error: text required"
}
```

**Implikasi test:** Test validation = call execute dengan input yang missing required field, assert return string mengandung "Error:".

### 4. Confirmation gate berada di `os-agent-tool.ts` untuk run_command dan open_app

Di source, `requireConfirmation` ada di `GUIConfig` level, bukan di tool level. Tool `open_app` memanggil `osAgent.gui.execute({ action: "open_app", ... })` yang akan return error kalau `requireConfirmation: true` di GUIAgent.

**Implikasi:** "Confirmation gate" test di tool level = mock GUIAgent.execute() return `{ success: false, error: "requires confirmation" }` dan assert tool return string berisi "Failed".

### 5. `osAgent.perception.summarize()` dipanggil di `active_context` dan `perception`

```typescript
case "active_context": {
  await osAgent.getContextSnapshot()
  return osAgent.perception.summarize()
}
case "perception": {
  return osAgent.perception.summarize()
}
```

### 6. Mock `OSAgent` yang diperlukan

Berdasarkan semua `case` di execute, OSAgent mock butuh:
```typescript
const mockOSAgent = {
  gui: { execute: vi.fn(), listWindows: vi.fn() },
  vision: { captureAndAnalyze: vi.fn() },
  voice: { speak: vi.fn() },
  system: { state: {...}, executeCommand: vi.fn() },
  iot: { parseNaturalLanguage: vi.fn(), execute: vi.fn() },
  perception: { summarize: vi.fn() },
  getContextSnapshot: vi.fn(),
}
```

---

## Mock Setup

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createOSAgentTool } from "../os-agent-tool.js"
import { createMockSystemState } from "./test-helpers.js"

// Mock 'ai' SDK biar tidak perlu real implementation
vi.mock("ai", () => ({
  tool: vi.fn((config) => config), // passthrough: return config as-is
}))

// Buat mock OSAgent
function createMockAgent() {
  return {
    gui: {
      execute: vi.fn().mockResolvedValue({ success: true, data: "action done" }),
      listWindows: vi.fn().mockResolvedValue([
        { title: "VS Code", processName: "Code", pid: 1234, bounds: {}, isActive: true },
      ]),
    },
    vision: {
      captureAndAnalyze: vi.fn().mockResolvedValue({
        success: true,
        data: { ocrText: "Hello World", elements: [], screenshotSize: 68 },
      }),
    },
    voice: {
      speak: vi.fn().mockResolvedValue({ success: true, data: { textLength: 5, audioBytes: 4, duration: 100 } }),
    },
    system: {
      get state() { return createMockSystemState() },
      executeCommand: vi.fn().mockResolvedValue({ success: true, data: { stdout: "command output", stderr: "" } }),
    },
    iot: {
      parseNaturalLanguage: vi.fn().mockReturnValue([
        { domain: "light", service: "turn_on", entityId: "light.bedroom" },
      ]),
      execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
    },
    perception: {
      summarize: vi.fn().mockReturnValue("CPU 15%, RAM 45% | Active: coding"),
    },
    getContextSnapshot: vi.fn().mockResolvedValue({}),
  }
}

let mockAgent: ReturnType<typeof createMockAgent>
let toolExecute: (input: any) => Promise<string>

beforeEach(() => {
  vi.clearAllMocks()
  mockAgent = createMockAgent()
  const toolConfig = createOSAgentTool(mockAgent as any)
  toolExecute = toolConfig.execute
})
```

---

## Test Cases Detail (15 tests)

### Group 1: Action Routing

#### Test 1 — routes 'screenshot' to vision.captureAndAnalyze

```typescript
it("routes 'screenshot' to vision.captureAndAnalyze", async () => {
  const result = await toolExecute({ action: "screenshot" })

  expect(mockAgent.vision.captureAndAnalyze).toHaveBeenCalled()
  expect(result).toContain("Screen captured")
  expect(result).toContain("Hello World") // OCR text
})
```

#### Test 2 — routes 'click' to gui.execute

```typescript
it("routes 'click' to gui.execute", async () => {
  const result = await toolExecute({ action: "click", x: 100, y: 200 })

  expect(mockAgent.gui.execute).toHaveBeenCalledWith(
    expect.objectContaining({ action: "click", coordinates: { x: 100, y: 200 } })
  )
  expect(result).toBe("action done")
})
```

#### Test 3 — routes 'type' to gui.execute

```typescript
it("routes 'type' to gui.execute", async () => {
  const result = await toolExecute({ action: "type", text: "Hello" })

  expect(mockAgent.gui.execute).toHaveBeenCalledWith(
    expect.objectContaining({ action: "type", text: "Hello" })
  )
})
```

#### Test 4 — routes 'speak' to voice.speak

```typescript
it("routes 'speak' to voice.speak", async () => {
  const result = await toolExecute({ action: "speak", text: "Hello EDITH" })

  expect(mockAgent.voice.speak).toHaveBeenCalledWith("Hello EDITH")
  expect(result).toContain("Spoke")
})
```

#### Test 5 — routes 'system_info' to system.state

```typescript
it("routes 'system_info' to system.state", async () => {
  const result = await toolExecute({ action: "system_info" })

  // Harus return JSON string dari system state
  const parsed = JSON.parse(result)
  expect(parsed).toMatchObject({
    cpuUsage: expect.any(Number),
    ramUsage: expect.any(Number),
  })
})
```

#### Test 6 — routes 'iot' to iot.parseNaturalLanguage + execute

```typescript
it("routes 'iot' to iot.parseNaturalLanguage + execute", async () => {
  const result = await toolExecute({ action: "iot", iotCommand: "nyalakan lampu kamar" })

  expect(mockAgent.iot.parseNaturalLanguage).toHaveBeenCalledWith("nyalakan lampu kamar")
  expect(mockAgent.iot.execute).toHaveBeenCalled()
  expect(result).toContain("light.bedroom")
  expect(result).toContain("OK")
})
```

---

### Group 2: Safety / Confirmation Gate

#### Test 7 — requires confirmation for 'shell' (run_command)

```typescript
it("returns error when gui.execute fails for open_app (confirmation gate)", async () => {
  // Mock GUIAgent menolak open_app (konfirmasi diperlukan di config level)
  mockAgent.gui.execute.mockResolvedValue({
    success: false,
    error: 'Action "open_app" requires confirmation',
  })

  const result = await toolExecute({ action: "open_app", name: "Notepad" })

  expect(result).toContain("Failed")
  expect(result).toContain("requires confirmation")
})
```

#### Test 8 — does NOT require confirmation for 'screenshot'

```typescript
it("does NOT require confirmation for screenshot (safe action)", async () => {
  const result = await toolExecute({ action: "screenshot" })

  // Screenshot langsung dieksekusi tanpa error konfirmasi
  expect(result).toContain("Screen captured")
  expect(result).not.toContain("requires confirmation")
})
```

#### Test 9 — shell action delegates to system.executeCommand

```typescript
it("routes 'shell' to system.executeCommand", async () => {
  const result = await toolExecute({ action: "shell", command: "echo hello" })

  expect(mockAgent.system.executeCommand).toHaveBeenCalledWith("echo hello")
  expect(result).toBe("command output")
})
```

---

### Group 3: Input Validation

#### Test 10 — validates required x and y for click

```typescript
it("validates required x and y for click action", async () => {
  const result = await toolExecute({ action: "click" }) // missing x, y

  expect(result).toContain("Error:")
  expect(result.toLowerCase()).toContain("coordinates")
  // gui.execute TIDAK dipanggil
  expect(mockAgent.gui.execute).not.toHaveBeenCalled()
})
```

#### Test 11 — validates required text for type_text

```typescript
it("validates required text for type action", async () => {
  const result = await toolExecute({ action: "type" }) // missing text

  expect(result).toContain("Error:")
  expect(result.toLowerCase()).toContain("text")
  expect(mockAgent.gui.execute).not.toHaveBeenCalled()
})
```

#### Test 12 — rejects unknown action type

```typescript
it("rejects unknown action type", async () => {
  const result = await toolExecute({ action: "totally_unknown_action" as any })

  expect(result).toContain("Unknown action")
})
```

---

### Group 4: Error Handling

#### Test 13 — returns error string when subsystem fails

```typescript
it("returns error string when vision subsystem fails", async () => {
  mockAgent.vision.captureAndAnalyze.mockResolvedValue({
    success: false,
    error: "Screenshot buffer unavailable",
  })

  const result = await toolExecute({ action: "screenshot" })

  expect(result).toContain("Screenshot failed")
  expect(result).toContain("Screenshot buffer unavailable")
})
```

#### Test 14 — returns error for malformed IoT command (no NL match)

```typescript
it("returns error for IoT command that cannot be parsed", async () => {
  mockAgent.iot.parseNaturalLanguage.mockReturnValue([]) // no commands parsed

  const result = await toolExecute({ action: "iot", iotCommand: "blabla tidak jelas" })

  expect(result).toContain("Could not parse")
})
```

---

### Group 5: Tool Registration

#### Test 15 — tool has correct input schema with action enum

```typescript
it("registers OS agent tool with correct action schema", () => {
  const toolConfig = createOSAgentTool(mockAgent as any)

  // inputSchema harus ada
  expect(toolConfig.inputSchema).toBeDefined()

  // Validate beberapa known actions
  const parseResult = toolConfig.inputSchema.safeParse({ action: "screenshot" })
  expect(parseResult.success).toBe(true)

  // Validate invalid action
  const badResult = toolConfig.inputSchema.safeParse({ action: "totally_invalid" })
  expect(badResult.success).toBe(false)
})
```

---

## Catatan Penting

- `ai` SDK `tool()` function perlu di-mock dengan passthrough: `vi.fn((config) => config)` agar `createOSAgentTool()` return object yang kita bisa call `.execute` dan access `.inputSchema`.
- Test validation menggunakan early-return pattern di source (bukan Zod safeParse dalam execute) — assert return string "Error:...".
- Test tool registration (Test 15) menggunakan `inputSchema.safeParse()` langsung.

---

## Checklist

- [ ] Test 1: screenshot routing ✅/❌
- [ ] Test 2: click routing ✅/❌
- [ ] Test 3: type routing ✅/❌
- [ ] Test 4: speak routing ✅/❌
- [ ] Test 5: system_info routing ✅/❌
- [ ] Test 6: iot routing ✅/❌
- [ ] Test 7: open_app confirmation gate ✅/❌
- [ ] Test 8: screenshot no confirmation ✅/❌
- [ ] Test 9: shell delegation ✅/❌
- [ ] Test 10: click missing coords ✅/❌
- [ ] Test 11: type missing text ✅/❌
- [ ] Test 12: unknown action ✅/❌
- [ ] Test 13: subsystem failure ✅/❌
- [ ] Test 14: IoT parse fail ✅/❌
- [ ] Test 15: schema registration ✅/❌
- [ ] Coverage ≥ 90%
