/**
 * @file os-agent/gui-agent.ts — GUI Automation Agent
 * @description Cross-platform GUI automation for EDITH-style computer control.
 * Enables EDITH to see the screen, click, type, and navigate applications.
 *
 * Based on:
 * - OSWorld (arXiv:2404.07972) — OS-level agent benchmark
 * - Claude Computer Use (arXiv:2411.10323) — GUI agent framework
 * - UFO (Microsoft) — Windows UI-Focused Agent
 *
 * @module os-agent/gui-agent
 */

import { execa } from "execa"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { createLogger } from "../logger.js"
import type {
  GUIConfig,
  GUIActionPayload,
  OSActionResult,
  WindowInfo,
} from "./types.js"

const log = createLogger("os-agent.gui")

/**
 * Escape a string for safe use in PowerShell.
 * Wraps in single quotes and doubles any embedded single quotes.
 */
function escapePS(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export class GUIAgent {
  private platform = process.platform
  private actionCount = 0
  private lastActionReset = Date.now()
  private initialized = false

  constructor(private config: GUIConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("GUI Agent disabled by config")
      return
    }

    // Verify platform-specific dependencies
    await this.verifyDependencies()
    this.initialized = true
    log.info(`GUI Agent initialized (platform: ${this.platform}, backend: ${this.config.backend})`)
  }

  /**
   * Execute a GUI action (click, type, hotkey, etc.)
   */
  async execute(payload: GUIActionPayload): Promise<OSActionResult> {
    if (!this.initialized || !this.config.enabled) {
      return { success: false, error: "GUI Agent not initialized or disabled" }
    }

    // Rate limiting
    if (!this.checkRateLimit()) {
      return { success: false, error: `Rate limit exceeded (max ${this.config.maxActionsPerMinute}/min)` }
    }

    // Confirmation gate for destructive actions
    const DESTRUCTIVE_ACTIONS = new Set(["close_window", "type", "drag", "open_app"])
    if (this.config.requireConfirmation && DESTRUCTIVE_ACTIONS.has(payload.action)) {
      return { success: false, error: `Action "${payload.action}" requires confirmation (requireConfirmation=true). Disable in config or use the confirmation API.` }
    }

    const start = Date.now()
    try {
      let result: string

      switch (payload.action) {
        case "click":
          if (!payload.coordinates) return { success: false, error: "coordinates required for click" }
          result = await this.click(payload.coordinates)
          break
        case "double_click":
          if (!payload.coordinates) return { success: false, error: "coordinates required for double_click" }
          result = await this.doubleClick(payload.coordinates)
          break
        case "right_click":
          if (!payload.coordinates) return { success: false, error: "coordinates required for right_click" }
          result = await this.rightClick(payload.coordinates)
          break
        case "type":
          if (!payload.text) return { success: false, error: "text required for type" }
          result = await this.typeText(payload.text)
          break
        case "hotkey":
          if (!payload.keys?.length) return { success: false, error: "keys array required for hotkey" }
          result = await this.pressHotkey(payload.keys)
          break
        case "scroll":
          if (!payload.direction) return { success: false, error: "direction required for scroll" }
          result = await this.scroll(payload.direction, payload.amount ?? 3)
          break
        case "drag":
          if (!payload.coordinates || !payload.endCoordinates) return { success: false, error: "coordinates and endCoordinates required for drag" }
          result = await this.drag(payload.coordinates, payload.endCoordinates)
          break
        case "move":
          if (!payload.coordinates) return { success: false, error: "coordinates required for move" }
          result = await this.moveMouse(payload.coordinates)
          break
        case "focus_window":
          if (!payload.windowTitle) return { success: false, error: "windowTitle required for focus_window" }
          result = await this.focusWindow(payload.windowTitle)
          break
        case "open_app":
          if (!payload.appName) return { success: false, error: "appName required for open_app" }
          result = await this.openApp(payload.appName)
          break
        case "close_window":
          result = await this.closeWindow(payload.windowTitle)
          break
        default:
          return { success: false, error: `Unknown GUI action: ${payload.action}` }
      }

      this.actionCount++
      return { success: true, data: result, duration: Date.now() - start }
    } catch (err) {
      log.error("GUI action failed", { action: payload.action, error: String(err) })
      return { success: false, error: String(err), duration: Date.now() - start }
    }
  }

  /**
   * Capture a screenshot and return as Buffer.
   */
  async captureScreenshot(region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    const tmpPath = path.join(os.tmpdir(), `edith-screenshot-${Date.now()}.png`)

    try {
      if (this.platform === "win32") {
        // PowerShell screenshot using .NET
        const script = region
          ? `Add-Type -AssemblyName System.Windows.Forms; $bmp = New-Object Drawing.Bitmap(${region.width}, ${region.height}); $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, $bmp.Size); $bmp.Save('${tmpPath}')`
          : `Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object Drawing.Bitmap($screen.Width, $screen.Height); $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save('${tmpPath}')`
        await execa("powershell", ["-command", script], { timeout: 10_000 })
      } else if (this.platform === "darwin") {
        if (region) {
          await execa("screencapture", ["-R", `${region.x},${region.y},${region.width},${region.height}`, tmpPath])
        } else {
          await execa("screencapture", ["-x", tmpPath])
        }
      } else {
        // Linux
        if (region) {
          await execa("scrot", ["-a", `${region.x},${region.y},${region.width},${region.height}`, tmpPath])
        } else {
          await execa("scrot", [tmpPath]).catch(() =>
            execa("gnome-screenshot", ["-f", tmpPath])
          )
        }
      }

      const buffer = await fs.readFile(tmpPath)
      await fs.unlink(tmpPath).catch(() => {})
      return buffer
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {})
      throw new Error(`Screenshot failed: ${err}`)
    }
  }

  /**
   * Get the currently active window info.
   */
  async getActiveWindow(): Promise<WindowInfo | null> {
    try {
      if (this.platform === "win32") {
        const script = `
          Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$hwnd = [WinAPI]::GetForegroundWindow()
$sb = New-Object Text.StringBuilder 256
[WinAPI]::GetWindowText($hwnd, $sb, 256) | Out-Null
$pid = 0
[WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
$rect = New-Object WinAPI+RECT
[WinAPI]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
@{ title=$sb.ToString(); process=$proc.ProcessName; pid=$pid; x=$rect.Left; y=$rect.Top; w=$rect.Right-$rect.Left; h=$rect.Bottom-$rect.Top } | ConvertTo-Json`
        const { stdout } = await execa("powershell", ["-command", script], { timeout: 5_000 })
        const data = JSON.parse(stdout)
        return {
          title: data.title,
          processName: data.process,
          pid: data.pid,
          bounds: { x: data.x, y: data.y, width: data.w, height: data.h },
          isActive: true,
        }
      }

      if (this.platform === "darwin") {
        const { stdout } = await execa("osascript", [
          "-e",
          'tell application "System Events" to get {name, unix id} of first process whose frontmost is true',
        ])
        const [name, pid] = stdout.split(", ")
        return {
          title: name ?? "Unknown",
          processName: name ?? "Unknown",
          pid: parseInt(pid ?? "0"),
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          isActive: true,
        }
      }

      // Linux (X11)
      const { stdout: windowId } = await execa("xdotool", ["getactivewindow"])
      const { stdout: windowName } = await execa("xdotool", ["getactivewindow", "getwindowname"])
      const { stdout: windowPid } = await execa("xdotool", ["getactivewindow", "getwindowpid"])
      return {
        title: windowName.trim(),
        processName: windowName.trim(),
        pid: parseInt(windowPid.trim()),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        isActive: true,
      }
    } catch (err) {
      log.warn("Failed to get active window", { error: String(err) })
      return null
    }
  }

  /**
   * List all open windows.
   */
  async listWindows(): Promise<WindowInfo[]> {
    try {
      if (this.platform === "win32") {
        const script = `Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json`
        const { stdout } = await execa("powershell", ["-command", script], { timeout: 5_000 })
        const data = JSON.parse(stdout)
        const list = Array.isArray(data) ? data : [data]
        return list.map((w: any) => ({
          title: w.MainWindowTitle,
          processName: w.ProcessName,
          pid: w.Id,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          isActive: false,
        }))
      }
      return []
    } catch {
      return []
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    log.info("GUI Agent shut down")
  }

  // ── Private Helpers ──

  private async click(coords: { x: number; y: number }): Promise<string> {
    if (this.platform === "win32") {
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${coords.x}, ${coords.y}); Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32; [Win32.Mouse]::mouse_event(0x0002, 0, 0, 0, 0); [Win32.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)`
      await execa("powershell", ["-command", script], { timeout: 5_000 })
    } else if (this.platform === "darwin") {
      await execa("cliclick", [`c:${coords.x},${coords.y}`])
    } else {
      await execa("xdotool", ["mousemove", String(coords.x), String(coords.y), "click", "1"])
    }
    return `Clicked at (${coords.x}, ${coords.y})`
  }

  private async doubleClick(coords: { x: number; y: number }): Promise<string> {
    if (this.platform === "win32") {
      await this.click(coords)
      await new Promise(r => setTimeout(r, 50))
      await this.click(coords)
    } else if (this.platform === "darwin") {
      await execa("cliclick", [`dc:${coords.x},${coords.y}`])
    } else {
      await execa("xdotool", ["mousemove", String(coords.x), String(coords.y), "click", "--repeat", "2", "1"])
    }
    return `Double-clicked at (${coords.x}, ${coords.y})`
  }

  private async rightClick(coords: { x: number; y: number }): Promise<string> {
    if (this.platform === "win32") {
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${coords.x}, ${coords.y}); Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32; [Win32.Mouse]::mouse_event(0x0008, 0, 0, 0, 0); [Win32.Mouse]::mouse_event(0x0010, 0, 0, 0, 0)`
      await execa("powershell", ["-command", script], { timeout: 5_000 })
    } else if (this.platform === "darwin") {
      await execa("cliclick", [`rc:${coords.x},${coords.y}`])
    } else {
      await execa("xdotool", ["mousemove", String(coords.x), String(coords.y), "click", "3"])
    }
    return `Right-clicked at (${coords.x}, ${coords.y})`
  }

  private async typeText(text: string): Promise<string> {
    if (this.platform === "win32") {
      // Use SendKeys for reliable typing on Windows
      const escaped = text.replace(/[+^%~(){}[\]]/g, "{$&}")
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')`
      await execa("powershell", ["-command", script], { timeout: 10_000 })
    } else if (this.platform === "darwin") {
      await execa("cliclick", [`t:${text}`])
    } else {
      await execa("xdotool", ["type", "--delay", "20", text])
    }
    return `Typed ${text.length} characters`
  }

  private async pressHotkey(keys: string[]): Promise<string> {
    const combo = keys.join("+")
    if (this.platform === "win32") {
      // Map to SendKeys format
      const keyMap: Record<string, string> = {
        ctrl: "^", alt: "%", shift: "+", enter: "{ENTER}", tab: "{TAB}",
        escape: "{ESC}", backspace: "{BS}", delete: "{DEL}", up: "{UP}",
        down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}",
        end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}",
      }
      const mapped = keys.map(k => keyMap[k.toLowerCase()] ?? k)
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${mapped.join("")}')`
      await execa("powershell", ["-command", script], { timeout: 5_000 })
    } else if (this.platform === "darwin") {
      await execa("cliclick", [`kp:${combo}`])
    } else {
      await execa("xdotool", ["key", combo])
    }
    return `Pressed hotkey: ${combo}`
  }

  private async scroll(direction: string, amount: number): Promise<string> {
    const dir = direction === "up" ? -amount : amount
    if (this.platform === "win32") {
      const script = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32; [Win32.Mouse]::mouse_event(0x0800, 0, 0, ${-dir * 120}, 0)`
      await execa("powershell", ["-command", script], { timeout: 5_000 })
    } else if (this.platform === "darwin") {
      // AppleScript scroll
      await execa("osascript", ["-e", `tell application "System Events" to scroll ${dir > 0 ? "down" : "up"} by ${Math.abs(dir)}`])
    } else {
      const button = dir > 0 ? "5" : "4"
      await execa("xdotool", ["click", "--repeat", String(Math.abs(dir)), button])
    }
    return `Scrolled ${direction} by ${amount}`
  }

  private async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<string> {
    if (this.platform === "win32") {
      // Move to start, mouse down, move to end, mouse up
      const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Mouse -Namespace Win32
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${from.x}, ${from.y})
Start-Sleep -Milliseconds 50
[Win32.Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${to.x}, ${to.y})
Start-Sleep -Milliseconds 50
[Win32.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)`
      await execa("powershell", ["-command", script], { timeout: 5_000 })
    } else if (this.platform === "darwin") {
      await execa("cliclick", [`dd:${from.x},${from.y}`, `dm:${to.x},${to.y}`, `du:${to.x},${to.y}`])
    } else {
      await execa("xdotool", [
        "mousemove", String(from.x), String(from.y),
        "mousedown", "1",
        "mousemove", "--sync", String(to.x), String(to.y),
        "mouseup", "1",
      ])
    }
    return `Dragged from (${from.x},${from.y}) to (${to.x},${to.y})`
  }

  private async moveMouse(coords: { x: number; y: number }): Promise<string> {
    if (this.platform === "win32") {
      const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${coords.x}, ${coords.y})`
      await execa("powershell", ["-command", script])
    } else if (this.platform === "darwin") {
      await execa("cliclick", [`m:${coords.x},${coords.y}`])
    } else {
      await execa("xdotool", ["mousemove", String(coords.x), String(coords.y)])
    }
    return `Mouse moved to (${coords.x}, ${coords.y})`
  }

  private async focusWindow(title: string): Promise<string> {
    if (this.platform === "win32") {
      const safeTitle = escapePS(title)
      const script = `$w = Get-Process | Where-Object { $_.MainWindowTitle -like ('*' + ${safeTitle} + '*') } | Select-Object -First 1; if ($w) { [void][System.Reflection.Assembly]::LoadWithPartialName('Microsoft.VisualBasic'); [Microsoft.VisualBasic.Interaction]::AppActivate($w.Id) }`
      await execa("powershell", ["-command", script], { timeout: 5_000 })
    } else if (this.platform === "darwin") {
      // AppleScript: pass title as a variable, not interpolated
      await execa("osascript", ["-e", `set appName to "${title.replace(/[\\"/]/g, '')}"`, "-e", `tell application appName to activate`])
    } else {
      await execa("xdotool", ["search", "--name", title, "windowactivate"])
    }
    return `Focused window: ${title}`
  }

  private async openApp(appName: string): Promise<string> {
    if (this.platform === "win32") {
      const safeApp = escapePS(appName)
      await execa("powershell", ["-command", `Start-Process ${safeApp}`], { timeout: 10_000 })
    } else if (this.platform === "darwin") {
      await execa("open", ["-a", appName])
    } else {
      await execa(appName, [], { detached: true, stdio: "ignore" })
    }
    return `Opened app: ${appName}`
  }

  private async closeWindow(title?: string): Promise<string> {
    if (this.platform === "win32") {
      if (title) {
        const safeTitle = escapePS(title)
        const script = `Get-Process | Where-Object { $_.MainWindowTitle -like ('*' + ${safeTitle} + '*') } | Stop-Process -Force`
        await execa("powershell", ["-command", script])
      } else {
        await this.pressHotkey(["alt", "F4"])
      }
    } else if (this.platform === "darwin") {
      await execa("osascript", ["-e", `tell application "System Events" to keystroke "w" using command down`])
    } else {
      await execa("xdotool", ["getactivewindow", "windowclose"])
    }
    return `Closed window: ${title ?? "active"}`
  }

  private checkRateLimit(): boolean {
    const now = Date.now()
    if (now - this.lastActionReset > 60_000) {
      this.actionCount = 0
      this.lastActionReset = now
    }
    return this.actionCount < this.config.maxActionsPerMinute
  }

  private async verifyDependencies(): Promise<void> {
    if (this.platform === "linux") {
      try {
        await execa("which", ["xdotool"])
      } catch {
        log.warn("xdotool not found — GUI automation may not work on Linux. Install with: sudo apt install xdotool")
      }
    }
  }
}
