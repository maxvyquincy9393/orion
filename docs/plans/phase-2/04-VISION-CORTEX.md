# Atom 3 — vision-cortex.test.ts

**File target:** `src/os-agent/__tests__/vision-cortex.test.ts`  
**Source yang ditest:** `src/os-agent/vision-cortex.ts`  
**Dependencies:** Atom 0 (test-helpers), Atom 2 (GUIAgent mock pattern)  
**Tests:** 10 tests  
**Coverage target:** 80%

---

## Apa yang Harus Diperbaiki di Source (`vision-cortex.ts`)

### 1. `captureAndAnalyze()` return type bukan Buffer, tapi `OSActionResult`

```typescript
// Source:
async captureAndAnalyze(): Promise<OSActionResult> {
  const screenshot = await this.captureScreen(region)
  const [ocrText, elements] = await Promise.all([
    this.extractText(screenshot),
    this.detectElements(screenshot),
  ])
  return {
    success: true,
    data: { ocrText, elements, screenshotSize: screenshot.length },
  }
}
```

**Implikasi test:** Assert `result.success === true` dan `result.data.ocrText`, bukan langsung buffer.

### 2. `describeImage()` saat ini return placeholder string

```typescript
// Source:
async describeImage(imageBuffer: Buffer, question?: string): Promise<string> {
  // Return placeholder — actual implementation will call orchestrator.generate()
  return `[Vision analysis pending — image size: ${imageBuffer.length} bytes...]`
}
```

**Implikasi test:** Test ini cukup assert output mengandung kata "pending" atau "Vision analysis". Tidak perlu mock LLM.

### 3. `tesseractOCR()` menulis file temp dulu

```typescript
private async tesseractOCR(imageBuffer: Buffer): Promise<string> {
  const tmpIn = path.join(os.tmpdir(), `edith-ocr-in-${Date.now()}.png`)
  const tmpOut = path.join(os.tmpdir(), `edith-ocr-out-${Date.now()}`)

  try {
    await fs.writeFile(tmpIn, imageBuffer)
    await execa("tesseract", [tmpIn, tmpOut, "-l", "eng+ind"], { timeout: 30_000 })
    const text = await fs.readFile(`${tmpOut}.txt`, "utf-8")
    return text.trim()
  } catch (err) {
    log.warn("Tesseract OCR failed", ...)
    return ""  // ← graceful fallback!
  } finally {
    await fs.unlink(tmpIn).catch(() => {})
    await fs.unlink(`${tmpOut}.txt`).catch(() => {})
  }
}
```

**Yang perlu di-mock:** `fs.writeFile`, `fs.readFile`, `fs.unlink`, dan `execa("tesseract", ...)`.

### 4. `setGUIAgent()` adalah dependency injection

```typescript
// Source:
setGUIAgent(gui: GUIAgent): void {
  this.guiAgent = gui
}

private async captureScreen(region?): Promise<Buffer> {
  if (this.guiAgent) {
    return this.guiAgent.captureScreenshot(region) // ← delegate ke GUIAgent
  }
  // else: own implementation
}
```

**Implikasi test:** Ada 2 path screenshot yang harus di-test:
1. **Dengan GUIAgent** → test bahwa `guiAgent.captureScreenshot` dipanggil
2. **Tanpa GUIAgent** → test fallback own implementation

### 5. `verifyTesseract()` dipanggil saat initialize

```typescript
private async verifyTesseract(): Promise<void> {
  try {
    await execa("tesseract", ["--version"])
    log.info("Tesseract OCR available")
  } catch {
    log.warn("Tesseract not found...")
    // Tidak throw! Hanya warn.
  }
}
```

**Implikasi test:** Test bahwa `initialize()` tidak throw meski tesseract gagal (graceful).

### 6. `getAccessibilityElements()` hanya diimplementasi untuk Windows

```typescript
private async getAccessibilityElements(): Promise<UIElement[]> {
  if (this.platform === "win32") {
    // PowerShell UIAutomation...
  }
  return []  // ← Non-Windows return empty array
}
```

**Implikasi test:** Test Windows path (mock PowerShell output), dan test non-Windows return `[]`.

---

## Mock Setup

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { VisionCortex } from "../vision-cortex.js"
import { GUIAgent } from "../gui-agent.js"
import { createMockVisionConfig, createMockGUIConfig, FAKE_PNG } from "./test-helpers.js"

vi.mock("execa", () => ({ execa: vi.fn() }))
vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock("node:os", () => ({
  default: {
    tmpdir: vi.fn().mockReturnValue("/tmp"),
  },
}))

import { execa } from "execa"
import fs from "node:fs/promises"

beforeEach(() => {
  vi.clearAllMocks()
  // Default: execa sukses
  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)
  // Default: fs.readFile return FAKE_PNG untuk screenshot, atau OCR text
  vi.mocked(fs.readFile).mockImplementation((filePath: any) => {
    if (String(filePath).endsWith(".txt")) {
      return Promise.resolve(Buffer.from("mocked OCR text"))
    }
    return Promise.resolve(FAKE_PNG)
  })
})
```

---

## Test Cases Detail (10 tests)

### Group 1: Initialization

#### Test 1 — initializes dengan tesseract verified

```typescript
it("initializes with tesseract verified", async () => {
  // tesseract --version sukses
  vi.mocked(execa).mockImplementation((cmd: string, args?: string[]) => {
    if (cmd === "tesseract" && args?.includes("--version")) {
      return Promise.resolve({ stdout: "tesseract 5.0.0", stderr: "", exitCode: 0 }) as any
    }
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }) as any
  })

  const vision = new VisionCortex(createMockVisionConfig())
  await expect(vision.initialize()).resolves.not.toThrow()
})
```

#### Test 2 — warns when tesseract not found (tapi tidak throw)

```typescript
it("warns when tesseract not found — does not throw", async () => {
  vi.mocked(execa).mockRejectedValueOnce(new Error("tesseract: command not found"))

  const vision = new VisionCortex(createMockVisionConfig())

  // Harus tidak throw! Source punya try/catch di verifyTesseract()
  await expect(vision.initialize()).resolves.not.toThrow()
})
```

#### Test 3 — skips when disabled

```typescript
it("skips when disabled", async () => {
  const vision = new VisionCortex(createMockVisionConfig({ enabled: false }))
  await vision.initialize()

  const result = await vision.captureAndAnalyze()

  expect(result.success).toBe(false)
  expect(result.error).toMatch(/not initialized/i)
  // execa tidak dipanggil
  expect(vi.mocked(execa)).not.toHaveBeenCalled()
})
```

---

### Group 2: Screenshot + Analysis (ScreenAgent pipeline)

#### Test 4 — captureAndAnalyze returns OCR text + elements

```typescript
it("captureAndAnalyze returns OCR text + elements", async () => {
  // Verify tesseract available
  vi.mocked(execa).mockImplementation((cmd: string, args?: any[]) => {
    if (cmd === "tesseract" && args?.includes("--version")) {
      return Promise.resolve({ stdout: "5.0.0", stderr: "", exitCode: 0 }) as any
    }
    // tesseract OCR call
    if (cmd === "tesseract") {
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }) as any
    }
    // PowerShell screenshot
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }) as any
  })

  // OCR output file
  vi.mocked(fs.readFile).mockImplementation((path: any) => {
    if (String(path).endsWith(".txt")) return Promise.resolve(Buffer.from("Hello World from OCR"))
    return Promise.resolve(FAKE_PNG)
  })

  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const vision = new VisionCortex(createMockVisionConfig())
  await vision.initialize()

  const result = await vision.captureAndAnalyze()

  expect(result.success).toBe(true)
  expect(result.data).toMatchObject({
    ocrText: expect.any(String),
    elements: expect.any(Array),
    screenshotSize: expect.any(Number),
  })
})
```

#### Test 5 — delegates screenshot ke GUIAgent ketika tersedia

```typescript
it("delegates screenshot to GUIAgent when available", async () => {
  vi.mocked(execa).mockResolvedValue({ stdout: "5.0.0", stderr: "", exitCode: 0 } as any)
  vi.mocked(fs.readFile).mockImplementation((p: any) => {
    if (String(p).endsWith(".txt")) return Promise.resolve(Buffer.from("ocr text"))
    return Promise.resolve(FAKE_PNG)
  })

  const vision = new VisionCortex(createMockVisionConfig())

  // Buat GUIAgent mock
  const mockGUI = {
    captureScreenshot: vi.fn().mockResolvedValue(FAKE_PNG),
  } as unknown as GUIAgent

  vision.setGUIAgent(mockGUI)
  await vision.initialize()

  await vision.captureAndAnalyze()

  // GUIAgent.captureScreenshot harus dipanggil
  expect(mockGUI.captureScreenshot).toHaveBeenCalled()
})
```

#### Test 6 — fallback to own capture when no GUIAgent

```typescript
it("falls back to own capture when no GUIAgent", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 } as any)
  vi.mocked(fs.readFile).mockImplementation((p: any) => {
    if (String(p).endsWith(".txt")) return Promise.resolve(Buffer.from(""))
    return Promise.resolve(FAKE_PNG)
  })

  // TIDAK set GUIAgent
  const vision = new VisionCortex(createMockVisionConfig())
  await vision.initialize()

  const result = await vision.captureAndAnalyze()

  // Harus sukses via own implementation
  expect(result.success).toBe(true)
  // PowerShell harus dipanggil untuk screenshot
  const psCall = vi.mocked(execa).mock.calls.find((c) => c[0] === "powershell")
  expect(psCall).toBeDefined()
})
```

---

### Group 3: OCR

#### Test 7 — extracts text via tesseract subprocess

```typescript
it("extracts text via tesseract subprocess", async () => {
  vi.mocked(execa).mockResolvedValue({ stdout: "5.0.0", stderr: "", exitCode: 0 } as any)
  vi.mocked(fs.readFile).mockImplementation((p: any) => {
    if (String(p).endsWith(".txt")) return Promise.resolve(Buffer.from("extracted text here"))
    return Promise.resolve(FAKE_PNG)
  })

  const vision = new VisionCortex(createMockVisionConfig())
  vision.setGUIAgent({ captureScreenshot: vi.fn().mockResolvedValue(FAKE_PNG) } as any)
  await vision.initialize()

  const text = await vision.extractText(FAKE_PNG)

  expect(text).toBe("extracted text here")
  // tesseract harus dipanggil dengan -l eng+ind
  const tesseractCall = vi.mocked(execa).mock.calls.find(
    (c) => c[0] === "tesseract" && String(c[1]).includes("eng+ind")
  )
  expect(tesseractCall).toBeDefined()
})
```

#### Test 8 — handles tesseract failure gracefully (return empty string)

```typescript
it("handles tesseract failure gracefully", async () => {
  // tesseract --version OK tapi tesseract OCR call gagal
  vi.mocked(execa).mockImplementation((cmd: string, args?: any[]) => {
    if (args?.includes("--version")) return Promise.resolve({ stdout: "5.0.0" }) as any
    if (cmd === "tesseract") return Promise.reject(new Error("OCR process crashed"))
    return Promise.resolve({ stdout: "" }) as any
  })

  const vision = new VisionCortex(createMockVisionConfig())
  await vision.initialize()

  // Tidak boleh throw — return empty string
  const text = await vision.extractText(FAKE_PNG)
  expect(text).toBe("")
})
```

---

### Group 4: UI Elements

#### Test 9 — detects accessibility elements on Windows (mock UIAutomation output)

```typescript
it("detects accessibility elements on Windows", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  const mockUIElements = JSON.stringify([
    { name: "Submit Button", type: "ControlType.Button", x: 100, y: 200, w: 80, h: 30 },
    { name: "Email Input", type: "ControlType.Edit", x: 50, y: 100, w: 200, h: 25 },
  ])

  vi.mocked(execa).mockImplementation((cmd: string, args?: any[]) => {
    if (cmd === "powershell" && String(args).includes("UIAutomationClient")) {
      return Promise.resolve({ stdout: mockUIElements, stderr: "", exitCode: 0 }) as any
    }
    return Promise.resolve({ stdout: "5.0.0", stderr: "", exitCode: 0 }) as any
  })

  const vision = new VisionCortex(createMockVisionConfig({ elementDetection: "accessibility" }))
  await vision.initialize()

  const elements = await vision.detectElements(FAKE_PNG)

  expect(elements.length).toBe(2)
  expect(elements[0].type).toBe("button")
  expect(elements[0].text).toBe("Submit Button")
  expect(elements[1].type).toBe("input")
})
```

---

### Group 5: Screen State

#### Test 10 — returns active window title and resolution

```typescript
it("returns active window title and resolution", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })

  vi.mocked(execa).mockImplementation((cmd: string, args?: any[]) => {
    if (cmd === "powershell" && String(args).includes("GetForegroundWindow")) {
      return Promise.resolve({ stdout: "Visual Studio Code", stderr: "", exitCode: 0 }) as any
    }
    if (cmd === "powershell" && String(args).includes("PrimaryScreen")) {
      return Promise.resolve({ stdout: "1920x1080", stderr: "", exitCode: 0 }) as any
    }
    return Promise.resolve({ stdout: "5.0.0", stderr: "", exitCode: 0 }) as any
  })

  const vision = new VisionCortex(createMockVisionConfig())
  await vision.initialize()

  const state = await vision.getScreenState()

  expect(state).not.toBeNull()
  expect(state?.activeWindowTitle).toBeDefined()
  expect(state?.resolution).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
  })
})
```

---

## Checklist

- [ ] Test 1: init tesseract verified ✅/❌
- [ ] Test 2: warn not found no throw ✅/❌
- [ ] Test 3: disabled ✅/❌
- [ ] Test 4: captureAndAnalyze full pipeline ✅/❌
- [ ] Test 5: delegates to GUIAgent ✅/❌
- [ ] Test 6: fallback own capture ✅/❌
- [ ] Test 7: tesseract OCR text extraction ✅/❌
- [ ] Test 8: tesseract failure graceful ✅/❌
- [ ] Test 9: accessibility elements Windows ✅/❌
- [ ] Test 10: screen state ✅/❌
- [ ] Coverage ≥ 80%
