/**
 * @file os-agent/vision-cortex.ts — Screen Understanding & Vision
 * @description Captures and analyzes screen content using OCR and multimodal LLMs.
 * Enables Nova to "see" what's on screen, extract text, detect UI elements,
 * and understand visual content.
 *
 * Based on:
 * - OSWorld (arXiv:2404.07972) — GUI grounding challenges
 * - OmniParser — UI element detection
 *
 * @module os-agent/vision-cortex
 */

import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { execa } from "execa"
import { createLogger } from "../logger.js"
import type { VisionConfig, OSActionResult, UIElement, ScreenState } from "./types.js"
import type { GUIAgent } from "./gui-agent.js"

const log = createLogger("os-agent.vision")

export class VisionCortex {
  private initialized = false
  private platform = process.platform
  private guiAgent: GUIAgent | null = null

  constructor(private config: VisionConfig) {}

  /**
   * Optionally inject a GUIAgent reference to reuse its screenshot logic.
   */
  setGUIAgent(gui: GUIAgent): void {
    this.guiAgent = gui
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("Vision Cortex disabled by config")
      return
    }

    // Verify OCR is available
    if (this.config.ocrEngine === "tesseract") {
      await this.verifyTesseract()
    }

    this.initialized = true
    log.info("Vision Cortex initialized", { ocr: this.config.ocrEngine, detection: this.config.elementDetection })
  }

  /**
   * Capture screenshot and analyze it.
   * Returns OCR text + detected elements + screenshot buffer.
   */
  async captureAndAnalyze(region?: { x: number; y: number; width: number; height: number }): Promise<OSActionResult> {
    if (!this.initialized) {
      return { success: false, error: "Vision Cortex not initialized" }
    }

    const start = Date.now()
    try {
      const screenshot = await this.captureScreen(region)
      const [ocrText, elements] = await Promise.all([
        this.extractText(screenshot),
        this.detectElements(screenshot),
      ])

      return {
        success: true,
        data: {
          ocrText,
          elements,
          screenshotSize: screenshot.length,
        },
        duration: Date.now() - start,
      }
    } catch (err) {
      return { success: false, error: String(err), duration: Date.now() - start }
    }
  }

  /**
   * Extract text from an image using OCR.
   */
  async extractText(imageBuffer: Buffer): Promise<string> {
    if (this.config.ocrEngine === "tesseract") {
      return this.tesseractOCR(imageBuffer)
    }
    // Cloud OCR would go here (Google Vision, Azure, etc.)
    return ""
  }

  /**
   * Detect UI elements in a screenshot.
   * Uses platform accessibility APIs when available, falls back to heuristics.
   */
  async detectElements(_screenshot: Buffer): Promise<UIElement[]> {
    if (this.config.elementDetection === "accessibility") {
      return this.getAccessibilityElements()
    }
    // YOLO/OmniParser detection would go here
    return []
  }

  /**
   * Describe an image using a multimodal LLM.
   * Useful for understanding complex visual content.
   */
  async describeImage(imageBuffer: Buffer, question?: string): Promise<string> {
    // This delegates to the engine orchestrator with vision capability
    const base64 = imageBuffer.toString("base64")
    const prompt = question ?? "Describe what you see in this image in detail."

    // Return placeholder — actual implementation will call orchestrator.generate()
    // with multimodal payload
    log.info("describeImage called", { imageSize: imageBuffer.length, hasQuestion: !!question })
    return `[Vision analysis pending — image size: ${imageBuffer.length} bytes, prompt: "${prompt}"]`
  }

  /**
   * Get current screen state (active window, resolution, etc.)
   */
  async getScreenState(): Promise<ScreenState | null> {
    try {
      const activeWindow = await this.getActiveWindowTitle()
      const resolution = await this.getScreenResolution()

      return {
        activeWindowTitle: activeWindow.title,
        activeWindowProcess: activeWindow.process,
        resolution,
      }
    } catch {
      return null
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    log.info("Vision Cortex shut down")
  }

  // ── Private Helpers ──

  private async captureScreen(region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    // Delegate to GUIAgent if available to avoid code duplication
    if (this.guiAgent) {
      return this.guiAgent.captureScreenshot(region)
    }

    // Fallback: own implementation (used when GUIAgent is not injected)
    const tmpPath = path.join(os.tmpdir(), `nova-vision-${Date.now()}.png`)

    try {
      if (this.platform === "win32") {
        const script = region
          ? `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $bmp = New-Object Drawing.Bitmap(${region.width},${region.height}); $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${region.x},${region.y},0,0,$bmp.Size); $bmp.Save('${tmpPath}')`
          : `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object Drawing.Bitmap($s.Width,$s.Height); $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $bmp.Save('${tmpPath}')`
        await execa("powershell", ["-command", script], { timeout: 10_000 })
      } else if (this.platform === "darwin") {
        await execa("screencapture", ["-x", tmpPath])
      } else {
        await execa("scrot", [tmpPath]).catch(() => execa("gnome-screenshot", ["-f", tmpPath]))
      }

      const buffer = await fs.readFile(tmpPath)
      await fs.unlink(tmpPath).catch(() => {})
      return buffer
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {})
      throw new Error(`Screen capture failed: ${err}`)
    }
  }

  private async tesseractOCR(imageBuffer: Buffer): Promise<string> {
    const tmpIn = path.join(os.tmpdir(), `nova-ocr-in-${Date.now()}.png`)
    const tmpOut = path.join(os.tmpdir(), `nova-ocr-out-${Date.now()}`)

    try {
      await fs.writeFile(tmpIn, imageBuffer)
      await execa("tesseract", [tmpIn, tmpOut, "-l", "eng+ind"], { timeout: 30_000 })
      const text = await fs.readFile(`${tmpOut}.txt`, "utf-8")
      return text.trim()
    } catch (err) {
      log.warn("Tesseract OCR failed", { error: String(err) })
      return ""
    } finally {
      await fs.unlink(tmpIn).catch(() => {})
      await fs.unlink(`${tmpOut}.txt`).catch(() => {})
    }
  }

  private async getAccessibilityElements(): Promise<UIElement[]> {
    // Platform-specific accessibility API integration
    // Windows: UI Automation API via PowerShell
    // macOS: Accessibility API via osascript
    // Linux: AT-SPI via atspi
    if (this.platform === "win32") {
      try {
        const script = `
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::FocusedElement
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$elements = @()
$child = $walker.GetFirstChild($root)
$count = 0
while ($child -ne $null -and $count -lt 50) {
  $name = $child.Current.Name
  $type = $child.Current.ControlType.ProgrammaticName
  $rect = $child.Current.BoundingRectangle
  if ($name -and $rect.Width -gt 0) {
    $elements += @{ name=$name; type=$type; x=[int]$rect.X; y=[int]$rect.Y; w=[int]$rect.Width; h=[int]$rect.Height }
  }
  $child = $walker.GetNextSibling($child)
  $count++
}
$elements | ConvertTo-Json -Depth 3`
        const { stdout } = await execa("powershell", ["-command", script], { timeout: 10_000 })
        if (!stdout.trim()) return []
        const data = JSON.parse(stdout)
        const list = Array.isArray(data) ? data : [data]
        return list.map((el: any) => ({
          type: this.mapUIAType(el.type),
          text: el.name,
          bounds: { x: el.x, y: el.y, width: el.w, height: el.h },
          interactable: true,
          role: el.type,
          name: el.name,
        }))
      } catch {
        return []
      }
    }

    return []
  }

  private mapUIAType(uiaType: string): UIElement["type"] {
    const map: Record<string, UIElement["type"]> = {
      "ControlType.Button": "button",
      "ControlType.Edit": "input",
      "ControlType.Hyperlink": "link",
      "ControlType.Text": "text",
      "ControlType.Image": "image",
      "ControlType.Menu": "menu",
      "ControlType.CheckBox": "checkbox",
      "ControlType.ComboBox": "dropdown",
      "ControlType.Tab": "tab",
    }
    return map[uiaType] ?? "unknown"
  }

  private async getActiveWindowTitle(): Promise<{ title: string; process: string }> {
    if (this.platform === "win32") {
      const script = `(Get-Process | Where-Object { $_.MainWindowHandle -eq (Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -Name User32 -Namespace Win -PassThru)::GetForegroundWindow() }).MainWindowTitle`
      try {
        const { stdout } = await execa("powershell", ["-command", script], { timeout: 3_000 })
        return { title: stdout.trim(), process: "unknown" }
      } catch {
        return { title: "Unknown", process: "unknown" }
      }
    }
    return { title: "Unknown", process: "unknown" }
  }

  private async getScreenResolution(): Promise<{ width: number; height: number }> {
    if (this.platform === "win32") {
      try {
        const script = `Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($s.Width)x$($s.Height)"`
        const { stdout } = await execa("powershell", ["-command", script])
        const [w, h] = stdout.trim().split("x").map(Number)
        return { width: w, height: h }
      } catch {
        return { width: 1920, height: 1080 }
      }
    }
    return { width: 1920, height: 1080 }
  }

  private async verifyTesseract(): Promise<void> {
    try {
      await execa("tesseract", ["--version"])
      log.info("Tesseract OCR available")
    } catch {
      log.warn("Tesseract not found — OCR will not be available. Install: choco install tesseract / apt install tesseract-ocr")
    }
  }
}
