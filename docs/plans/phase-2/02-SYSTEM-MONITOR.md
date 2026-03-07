# Atom 1 — system-monitor.test.ts

**File target:** `src/os-agent/__tests__/system-monitor.test.ts`  
**Source yang ditest:** `src/os-agent/system-monitor.ts`  
**Dependencies:** Atom 0 (test-helpers) harus selesai dulu  
**Tests:** 11 tests  
**Coverage target:** 85%

---

## Apa yang Harus Diperbaiki di Source (`system-monitor.ts`)

Sebelum nulis test, pahami dulu ini — ini yang membuat testing tricky:

### 1. `getCPUUsage()` pakai two-sample delta

```typescript
// Di source (baris ~185):
private lastCpuTimes: Array<{ idle: number; total: number }> | null = null

private async getCPUUsage(): Promise<number> {
  const cpus = os.cpus()
  // ... kalkulasi delta antara dua calls ke os.cpus()
  if (!this.lastCpuTimes || this.lastCpuTimes.length !== currentTimes.length) {
    this.lastCpuTimes = currentTimes
    return 0  // ← FIRST CALL SELALU RETURN 0!
  }
  // ...
}
```

**Implikasi test:** Mock `os.cpus()` harus dipanggil DUA KALI dengan values berbeda biar CPU% bukan 0. Tapi karena `refreshState()` memanggil `getCPUUsage()` sekali, kita perlu trigger dua cycle refresh.

**Solusi di test:** Panggil `monitor.initialize()` (first call → baseline), lalu panggil lagi sebuah method yang trigger `refreshState()` (second call → actual delta).

### 2. `refreshState()` adalah private

Kita tidak bisa panggil `monitor.refreshState()` langsung dari test. Tapi `initialize()` memanggil `refreshState()` sekali. Untuk trigger lagi, kita bisa pakai `startMonitoring()` + fake timer, atau expose via `getMetrics()` kalau ada — tapi source tidak punya `getMetrics()` public. 

**Solusi:** Gunakan `monitor.state` getter (public) yang return cached state setelah `initialize()`.

### 3. `executeCommand()` pakai conditional shell

```typescript
// Di source:
const shell = options?.shell === "powershell" || (this.platform === "win32" && !options?.shell)
  ? "powershell" : ...
```

**Implikasi test:** Test untuk Windows path harus mock `process.platform` === "win32" ATAU pass `{ shell: "powershell" }` secara explicit di options.

### 4. `checkNetworkConnection()` pakai `Test-Connection` (Windows) atau `ping` (Unix)

```typescript
// Windows:
await execa("powershell", ["-command", "(Test-Connection ...)"])
// Unix:
await execa("ping", ["-c", "1", "-W", "2", "8.8.8.8"])
```

**Implikasi test:** Mock execa harus bisa handle BOTH patterns. Gunakan `vi.fn()` dengan conditional based on first argument.

### 5. `getBatteryInfo()` return `null` jika tidak ada battery

Source meng-handle ini dengan try/catch return null. Test harus cover: ada battery, tidak ada battery (null).

---

## Mock Setup (wajib di top of file)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SystemMonitor } from "../system-monitor.js"
import {
  createMockSystemConfig,
  mockExecaSuccess,
  mockExecaFail,
} from "./test-helpers.js"

// ── Mock execa ──
vi.mock("execa", () => ({ execa: vi.fn() }))

// ── Mock os module ──
vi.mock("node:os", () => ({
  default: {
    cpus: vi.fn(),
    totalmem: vi.fn().mockReturnValue(16 * 1024 ** 3),   // 16 GB
    freemem: vi.fn().mockReturnValue(8 * 1024 ** 3),     // 8 GB free
    platform: vi.fn().mockReturnValue("win32"),
  },
}))

// ── Import setelah mock ──
import { execa } from "execa"
import os from "node:os"
```

---

## Test Cases Detail (11 tests)

### Group 1: Initialization

#### Test 1 — initializes dan collect baseline metrics

```typescript
it("initializes and collects baseline metrics", async () => {
  // Setup
  const mockCpus = [
    { model: "Intel", speed: 2400, times: { user: 1000, nice: 0, sys: 500, idle: 8500, irq: 0 } },
    { model: "Intel", speed: 2400, times: { user: 1000, nice: 0, sys: 500, idle: 8500, irq: 0 } },
  ]
  vi.mocked(os.cpus).mockReturnValue(mockCpus as any)
  vi.mocked(execa).mockResolvedValue({ stdout: "50", stderr: "", exitCode: 0 } as any)

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  // Setelah init, state harus ada
  const state = monitor.state
  expect(state).toBeDefined()
  expect(state.ramUsage).toBeGreaterThanOrEqual(0)
  expect(state.ramUsage).toBeLessThanOrEqual(100)
  expect(state.diskUsage).toBeGreaterThanOrEqual(0)
})
```

#### Test 2 — skips initialization when disabled

```typescript
it("skips initialization when disabled", async () => {
  const monitor = new SystemMonitor(createMockSystemConfig({ enabled: false }))
  await monitor.initialize()

  // State masih default (tidak ada refreshState dipanggil)
  expect(monitor.state.cpuUsage).toBe(0)
  expect(vi.mocked(execa)).not.toHaveBeenCalled()
})
```

---

### Group 2: CPU Usage

#### Test 3 — measures CPU via two-sample delta

```typescript
it("measures CPU usage with two-sample delta", async () => {
  // First call (baseline) → cpus dengan idle tinggi
  const baseCpus = [
    { model: "i", speed: 2400, times: { user: 1000, nice: 0, sys: 500, idle: 8000, irq: 0 } },
  ]
  // Second call (measurement) → idle lebih rendah = CPU dipakai
  const activeCpus = [
    { model: "i", speed: 2400, times: { user: 1500, nice: 0, sys: 700, idle: 8200, irq: 0 } },
  ]

  vi.mocked(os.cpus)
    .mockReturnValueOnce(baseCpus as any)   // call pertama: baseline
    .mockReturnValueOnce(activeCpus as any) // call kedua: measurement

  vi.mocked(execa).mockResolvedValue({ stdout: "0", stderr: "", exitCode: 0 } as any)

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize() // first sample stored → cpuUsage = 0

  // Trigger manual refresh via startMonitoring + fake timer
  vi.useFakeTimers()
  monitor.startMonitoring()
  await vi.runAllTimersAsync()
  monitor.stopMonitoring()
  vi.useRealTimers()

  const state = monitor.state
  expect(typeof state.cpuUsage).toBe("number")
  expect(state.cpuUsage).toBeGreaterThanOrEqual(0)
  expect(state.cpuUsage).toBeLessThanOrEqual(100)
})
```

#### Test 4 — CPU usage antara 0-100

```typescript
it("returns CPU percentage between 0 and 100", async () => {
  const cpus = Array(4).fill({
    model: "Intel", speed: 2400,
    times: { user: 2000, nice: 0, sys: 1000, idle: 7000, irq: 0 },
  })
  vi.mocked(os.cpus).mockReturnValue(cpus as any)
  vi.mocked(execa).mockResolvedValue({ stdout: "0", stderr: "", exitCode: 0 } as any)

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  expect(monitor.state.cpuUsage).toBeGreaterThanOrEqual(0)
  expect(monitor.state.cpuUsage).toBeLessThanOrEqual(100)
})
```

---

### Group 3: Memory

#### Test 5 — RAM usage dari os.totalmem/freemem

```typescript
it("returns RAM usage from os.totalmem/freemem", async () => {
  // 16GB total, 12GB dipakai = 75%
  vi.mocked(os.totalmem).mockReturnValue(16 * 1024 ** 3)
  vi.mocked(os.freemem).mockReturnValue(4 * 1024 ** 3)
  vi.mocked(os.cpus).mockReturnValue([
    { model: "i", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 10000, irq: 0 } },
  ] as any)
  vi.mocked(execa).mockResolvedValue({ stdout: "0", stderr: "", exitCode: 0 } as any)

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  // (16 - 4) / 16 * 100 = 75%
  expect(monitor.state.ramUsage).toBe(75)
})
```

---

### Group 4: Disk

#### Test 6 — disk usage via PowerShell on Windows

```typescript
it("gets disk usage via PowerShell on Windows", async () => {
  vi.mocked(os.cpus).mockReturnValue([
    { model: "i", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 10000, irq: 0 } },
  ] as any)

  // Mock execa: PowerShell disk command return "65"
  vi.mocked(execa).mockImplementation((cmd: string, args?: string[]) => {
    const script = (args ?? []).join(" ")
    if (script.includes("Get-PSDrive")) {
      return Promise.resolve({ stdout: "65", stderr: "", exitCode: 0 }) as any
    }
    return Promise.resolve({ stdout: "0", stderr: "", exitCode: 0 }) as any
  })

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  expect(monitor.state.diskUsage).toBe(65)
})
```

#### Test 7 — disk usage via `df` on Unix

```typescript
it("gets disk usage via df on Unix", async () => {
  // Mock platform = linux
  vi.mocked(os.cpus).mockReturnValue([
    { model: "i", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 10000, irq: 0 } },
  ] as any)

  vi.mocked(execa).mockImplementation((cmd: string, args?: string[]) => {
    if (cmd === "df") {
      return Promise.resolve({
        stdout: "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   55G   45G  55% /",
        stderr: "",
        exitCode: 0,
      }) as any
    }
    return Promise.resolve({ stdout: "0", stderr: "", exitCode: 0 }) as any
  })

  // Temporarily mock platform to linux
  const originalPlatform = process.platform
  Object.defineProperty(process, "platform", { value: "linux", configurable: true })

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })

  expect(monitor.state.diskUsage).toBe(55)
})
```

---

### Group 5: Network

#### Test 8 — network connectivity via ping

```typescript
it("checks network connectivity via ping", async () => {
  vi.mocked(os.cpus).mockReturnValue([
    { model: "i", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 10000, irq: 0 } },
  ] as any)

  vi.mocked(execa).mockImplementation((cmd: string, args?: string[]) => {
    const script = (args ?? []).join(" ")
    // Windows: Test-Connection → "true"
    if (script.includes("Test-Connection")) {
      return Promise.resolve({ stdout: "true", stderr: "", exitCode: 0 }) as any
    }
    // Linux/Mac: ping
    if (cmd === "ping") {
      return Promise.resolve({ stdout: "1 packets received", stderr: "", exitCode: 0 }) as any
    }
    return Promise.resolve({ stdout: "0", stderr: "", exitCode: 0 }) as any
  })

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  expect(monitor.state.networkConnected).toBe(true)
})
```

#### Test 9 — handles network failure gracefully

```typescript
it("handles network failure gracefully", async () => {
  vi.mocked(os.cpus).mockReturnValue([
    { model: "i", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 10000, irq: 0 } },
  ] as any)

  vi.mocked(execa).mockImplementation((cmd: string, args?: string[]) => {
    const script = (args ?? []).join(" ")
    if (script.includes("Test-Connection") || cmd === "ping") {
      return Promise.reject(new Error("Request timeout")) as any
    }
    return Promise.resolve({ stdout: "0", stderr: "", exitCode: 0 }) as any
  })

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  // Tidak boleh throw, network = false
  expect(monitor.state.networkConnected).toBe(false)
})
```

---

### Group 6: Process List

#### Test 10 — returns running processes list

```typescript
it("returns running processes list", async () => {
  vi.mocked(os.cpus).mockReturnValue([
    { model: "i", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 10000, irq: 0 } },
  ] as any)

  vi.mocked(execa).mockImplementation((cmd: string, args?: string[]) => {
    const script = (args ?? []).join(" ")
    if (script.includes("Get-Process") && script.includes("ProcessName")) {
      return Promise.resolve({
        stdout: "Code\nChrome\nnode\nexporer\npowershell",
        stderr: "",
        exitCode: 0,
      }) as any
    }
    return Promise.resolve({ stdout: "0", stderr: "", exitCode: 0 }) as any
  })

  const monitor = new SystemMonitor(createMockSystemConfig())
  await monitor.initialize()

  expect(Array.isArray(monitor.state.topProcesses)).toBe(true)
  expect(monitor.state.topProcesses.length).toBeGreaterThan(0)
  expect(monitor.state.topProcesses).toContain("Code")
})
```

---

### Group 7: Clipboard

#### Test 11 — reads clipboard content on Windows

```typescript
it("reads clipboard content on Windows", async () => {
  vi.mocked(os.cpus).mockReturnValue([
    { model: "i", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 10000, irq: 0 } },
  ] as any)

  vi.mocked(execa).mockImplementation((cmd: string, args?: string[]) => {
    const script = (args ?? []).join(" ")
    if (script.includes("Get-Clipboard")) {
      return Promise.resolve({ stdout: "Hello from clipboard", stderr: "", exitCode: 0 }) as any
    }
    return Promise.resolve({ stdout: "0", stderr: "", exitCode: 0 }) as any
  })

  // Enable clipboard watching
  const monitor = new SystemMonitor(createMockSystemConfig({ watchClipboard: true }))
  await monitor.initialize()

  expect(monitor.state.clipboardPreview).toBe("Hello from clipboard")
})
```

---

## Checklist

- [ ] Test 1: initializes and collects baseline metrics ✅/❌
- [ ] Test 2: skips when disabled ✅/❌
- [ ] Test 3: measures CPU two-sample delta ✅/❌
- [ ] Test 4: CPU 0-100 ✅/❌
- [ ] Test 5: RAM from os module ✅/❌
- [ ] Test 6: disk via PowerShell ✅/❌
- [ ] Test 7: disk via df (Unix) ✅/❌
- [ ] Test 8: network ping ✅/❌
- [ ] Test 9: network failure graceful ✅/❌
- [ ] Test 10: process list ✅/❌
- [ ] Test 11: clipboard ✅/❌
- [ ] Coverage ≥ 85% verified (`pnpm vitest run --coverage`)
