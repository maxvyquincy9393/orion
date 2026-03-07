# Atom 2 — gui-agent.test.ts

**File target:** `src/os-agent/__tests__/gui-agent.test.ts`  
**Source yang ditest:** `src/os-agent/gui-agent.ts`  
**Dependencies:** Atom 0 (test-helpers)  
**Tests:** 12 tests  
**Coverage target:** 85%

---

## Apa yang Harus Diperbaiki di Source (`gui-agent.ts`)

### 1. `verifyDependencies()` hanya check Linux

```typescript
// Source baris ~290:
private async verifyDependencies(): Promise<void> {
  if (this.platform === "linux") {
    try {
      await execa("which", ["xdotool"])
    } catch {
      log.warn("xdotool not found...")
    }
  }
  // Windows dan macOS: tidak ada verification = langsung initialized
}
```

**Implikasi test:** Untuk Windows/macOS path, `initialize()` tidak memanggil execa sama sekali (hanya log). Test `initialized` state cukup cek bahwa tidak ada error throw.

### 2. `checkRateLimit()` pakai private counter

```typescript
private actionCount = 0
private lastActionReset = Date.now()

private checkRateLimit(): boolean {
  const now = Date.now()
  if (now - this.lastActionReset > 60_000) {
    this.actionCount = 0
    this.lastActionReset = now
  }
  return this.actionCount < this.config.maxActionsPerMinute
}
```

**Masalah:** `actionCount` private — kita tidak bisa set dari luar. Untuk test "rate limit exceeded", kita harus exhaust limit dulu dengan memanggil `execute()` sejumlah `maxActionsPerMinute` kali, ATAU set `maxActionsPerMinute: 0` di config (lebih simpel).

### 3. `execute()` punya DESTRUCTIVE_ACTIONS gate

```typescript
// Source:
const DESTRUCTIVE_ACTIONS = new Set(["close_window", "type", "drag", "open_app"])
if (this.config.requireConfirmation && DESTRUCTIVE_ACTIONS.has(payload.action)) {
  return { success: false, error: `Action "${payload.action}" requires confirmation...` }
}
```

**Implikasi test:** Harus ada test dengan `requireConfirmation: true` yang verify rejection.

### 4. `click()` Windows path pakai PowerShell dengan `mouse_event`

```typescript
private async click(coords): Promise<string> {
  if (this.platform === "win32") {
    const script = `...mouse_event(0x0002, 0, 0, 0, 0); ...(0x0004, 0, 0, 0, 0)`
    await execa("powershell", ["-command", script], { timeout: 5_000 })
  }
  // ...
}
```

**Yang perlu di-assert:** execa dipanggil dengan `"powershell"` dan args yang contain `"mouse_event"`.

### 5. `captureScreenshot()` tulis ke tmpdir lalu baca

```typescript
const tmpPath = path.join(os.tmpdir(), `edith-screenshot-${Date.now()}.png`)
// ... execa menulis ke tmpPath
const buffer = await fs.readFile(tmpPath)
await fs.unlink(tmpPath)
```

**Implikasi test:** Mock `fs.readFile` untuk return `FAKE_PNG` dan mock `fs.unlink` untuk return void.

---

## Mock Setup

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { GUIAgent } from "../gui-agent.js"
import { createMockGUIConfig, FAKE_PNG } from "./test-helpers.js"

// ── WAJIB: mock sebelum import source ──
vi.mock("execa", () => ({ execa: vi.fn() }))
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock("node:os", () => ({
  default: {
    tmpdir: vi.fn().mockReturnValue("/tmp"),
    platform: vi.fn().mockReturnValue("win32"),
  },
}))

import { execa } from "execa"
import fs from "node:fs/promises"

// Reset setiap test
beforeEach(() => {
  vi.clearAllMocks()
  // Default execa: selalu sukses
  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)
  // Default fs.readFile: return FAKE_PNG
  vi.mocked(fs.readFile).mockResolvedValue(FAKE_PNG as any)
})
```

---

## Test Cases Detail (12 tests)

### Group 1: Initialization

#### Test 1 — initializes on Windows (no execa call needed)

```typescript
it("initializes on Windows with native backend", async () => {
  // Windows tidak perlu verify deps (beda dengan Linux)
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await expect(agent.initialize()).resolves.not.toThrow()

  // execa TIDAK dipanggil saat initialize di Windows
  expect(vi.mocked(execa)).not.toHaveBeenCalled()
})
```

#### Test 2 — initializes on macOS

```typescript
it("initializes on macOS with native backend", async () => {
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await expect(agent.initialize()).resolves.not.toThrow()
})
```

#### Test 3 — skips when disabled

```typescript
it("skips init when disabled", async () => {
  const agent = new GUIAgent(createMockGUIConfig({ enabled: false }))
  await agent.initialize()

  // Kalau disabled, execute harus return error
  const result = await agent.execute({ action: "click", coordinates: { x: 100, y: 100 } })
  expect(result.success).toBe(false)
  expect(result.error).toMatch(/not initialized|disabled/)
})
```

---

### Group 2: Screenshot

#### Test 4 — captures screenshot on Windows via PowerShell

```typescript
it("captures screenshot on Windows via PowerShell", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await agent.initialize()

  const buffer = await agent.captureScreenshot()

  // Harus call execa dengan powershell
  expect(vi.mocked(execa)).toHaveBeenCalledWith(
    "powershell",
    ["-command", expect.stringContaining("CopyFromScreen")],
    expect.objectContaining({ timeout: 10_000 })
  )

  // Harus return buffer dari fs.readFile mock
  expect(buffer).toEqual(FAKE_PNG)
})
```

#### Test 5 — captures screenshot on macOS via screencapture

```typescript
it("captures screenshot on macOS via screencapture", async () => {
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await agent.initialize()

  const buffer = await agent.captureScreenshot()

  expect(vi.mocked(execa)).toHaveBeenCalledWith(
    "screencapture",
    ["-x", expect.stringContaining("edith-screenshot")],
    undefined // screencapture tidak pakai options di source
  )
  expect(buffer).toEqual(FAKE_PNG)
})
```

#### Test 6 — captures region screenshot with bounds

```typescript
it("captures region screenshot with bounds", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await agent.initialize()

  const region = { x: 100, y: 200, width: 400, height: 300 }
  await agent.captureScreenshot(region)

  // Script PowerShell harus contain koordinat region
  const callArgs = vi.mocked(execa).mock.calls[0]
  const script = callArgs[1]?.[1] as string
  expect(script).toContain("400")
  expect(script).toContain("300")
})
```

---

### Group 3: Mouse Actions

#### Test 7 — clicks at coordinates using PowerShell mouse_event

```typescript
it("clicks at coordinates using PowerShell mouse_event", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await agent.initialize()

  const result = await agent.execute({ action: "click", coordinates: { x: 500, y: 300 } })

  expect(result.success).toBe(true)
  expect(result.data).toContain("Clicked at (500, 300)")

  // Harus pakai mouse_event
  const wasCalled = vi.mocked(execa).mock.calls.some(
    (call) => call[0] === "powershell" && String(call[1]).includes("mouse_event")
  )
  expect(wasCalled).toBe(true)
})
```

#### Test 8 — double-clicks at coordinates

```typescript
it("double-clicks at coordinates", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await agent.initialize()

  const result = await agent.execute({ action: "double_click", coordinates: { x: 200, y: 150 } })

  expect(result.success).toBe(true)
  expect(result.data).toContain("Double-clicked")

  // double_click = 2 click calls → execa harus dipanggil ≥ 2 kali
  expect(vi.mocked(execa).mock.calls.length).toBeGreaterThanOrEqual(2)
})
```

#### Test 9 — drags from source to target

```typescript
it("drags from source to target (mouse down→move→up)", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig({ requireConfirmation: false }))
  await agent.initialize()

  const result = await agent.execute({
    action: "drag",
    coordinates: { x: 100, y: 100 },
    endCoordinates: { x: 400, y: 400 },
  })

  expect(result.success).toBe(true)
  expect(result.data).toContain("Dragged from")

  // PowerShell drag script harus contain mouse down (0x0002) dan up (0x0004)
  const dragCall = vi.mocked(execa).mock.calls.find(
    (call) => call[0] === "powershell" && String(call[1]).includes("0x0002")
  )
  expect(dragCall).toBeDefined()
})
```

---

### Group 4: Keyboard Actions

#### Test 10 — types text via SendKeys

```typescript
it("types text via SendKeys", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig({ requireConfirmation: false }))
  await agent.initialize()

  const result = await agent.execute({ action: "type", text: "Hello EDITH" })

  expect(result.success).toBe(true)
  expect(result.data).toContain("Typed 11 characters")

  // Harus pakai SendKeys
  const sendKeysCall = vi.mocked(execa).mock.calls.find(
    (call) => String(call[1]).includes("SendKeys")
  )
  expect(sendKeysCall).toBeDefined()
})
```

#### Test 11 — sends hotkey combination (Ctrl+S)

```typescript
it("sends hotkey combination (Ctrl+S)", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const agent = new GUIAgent(createMockGUIConfig())
  await agent.initialize()

  const result = await agent.execute({ action: "hotkey", keys: ["ctrl", "s"] })

  expect(result.success).toBe(true)
  expect(result.data).toContain("ctrl+s")
})
```

---

### Group 5: Safety

#### Test 12 — rejects actions when rate limit exceeded

```typescript
it("rejects actions when rate limit exceeded", async () => {
  // maxActionsPerMinute: 0 → langsung rate limited
  const agent = new GUIAgent(createMockGUIConfig({ maxActionsPerMinute: 0 }))
  await agent.initialize()

  const result = await agent.execute({ action: "click", coordinates: { x: 100, y: 100 } })

  expect(result.success).toBe(false)
  expect(result.error).toMatch(/rate limit/i)
})
```

**Bonus test (optional) — requireConfirmation blocks type action:**

```typescript
it("blocks type action when requireConfirmation is true", async () => {
  const agent = new GUIAgent(createMockGUIConfig({ requireConfirmation: true }))
  await agent.initialize()

  const result = await agent.execute({ action: "type", text: "hello" })

  expect(result.success).toBe(false)
  expect(result.error).toMatch(/requires confirmation/i)
})
```

---

## Catatan Penting

- Setiap test yang test platform-specific behavior **wajib restore** `process.platform` setelah test:
  ```typescript
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
  })
  ```
- `captureScreenshot()` adalah public method di source, jadi bisa di-test langsung.
- Untuk test execa calls, lebih aman gunakan `expect.stringContaining()` daripada exact match karena PowerShell scripts panjang dan bisa berubah.

---

## Checklist

- [ ] Test 1: init Windows ✅/❌
- [ ] Test 2: init macOS ✅/❌
- [ ] Test 3: disabled ✅/❌
- [ ] Test 4: screenshot Windows ✅/❌
- [ ] Test 5: screenshot macOS ✅/❌
- [ ] Test 6: region screenshot ✅/❌
- [ ] Test 7: click mouse_event ✅/❌
- [ ] Test 8: double click ✅/❌
- [ ] Test 9: drag ✅/❌
- [ ] Test 10: type SendKeys ✅/❌
- [ ] Test 11: hotkey ✅/❌
- [ ] Test 12: rate limit ✅/❌
- [ ] Coverage ≥ 85%
