/**
 * @file os-agent/system-monitor.ts — System Monitoring & Activity Tracking
 * @description Monitors system resources, active windows, clipboard, and user activity.
 * Provides environmental awareness for EDITH-style proactive behavior.
 *
 * @module os-agent/system-monitor
 */

import os from "node:os"
import { execa } from "execa"
import { createLogger } from "../logger.js"
import type { SystemConfig, OSActionResult, SystemState } from "./types.js"

const log = createLogger("os-agent.system-monitor")

export class SystemMonitor {
  private initialized = false
  private platform = process.platform
  private monitorInterval: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()

  /** Latest system state snapshot */
  private _state: SystemState = {
    cpuUsage: 0,
    ramUsage: 0,
    diskUsage: 0,
    topProcesses: [],
    networkConnected: true,
    idleTimeSeconds: 0,
  }

  constructor(private config: SystemConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      log.info("System Monitor disabled by config")
      return
    }

    await this.refreshState()
    this.initialized = true
    log.info("System Monitor initialized")
  }

  /**
   * Start the monitoring loop.
   */
  startMonitoring(): void {
    if (this.monitorInterval) return

    this.monitorInterval = setInterval(async () => {
      try {
        await this.refreshState()
      } catch (err) {
        log.warn("System monitor tick failed", { error: String(err) })
      }
    }, this.config.resourceCheckIntervalMs)

    log.info(`System monitoring started (interval: ${this.config.resourceCheckIntervalMs}ms)`)
  }

  /**
   * Stop the monitoring loop.
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }
  }

  /**
   * Get the latest system state.
   */
  get state(): SystemState {
    return { ...this._state }
  }

  /**
   * Execute a shell command safely.
   */
  async executeCommand(
    command: string,
    options?: { cwd?: string; timeout?: number; shell?: string; background?: boolean },
  ): Promise<OSActionResult> {
    const start = Date.now()
    const timeout = options?.timeout ?? 30_000

    // Security: block dangerous commands
    const blocked = ["rm -rf /", "format c:", "del /s /q c:\\", ":(){:|:&};:"]
    if (blocked.some((b) => command.includes(b))) {
      return { success: false, error: "Command blocked by safety filter" }
    }

    try {
      const shell =
        options?.shell === "powershell" || (this.platform === "win32" && !options?.shell)
          ? "powershell"
          : options?.shell === "cmd"
            ? "cmd"
            : undefined

      if (options?.background) {
        // Fire and forget
        const proc = execa(shell ?? command, shell ? ["-command", command] : [], {
          cwd: options?.cwd,
          detached: true,
          stdio: "ignore",
        })
        proc.unref()
        return { success: true, data: "Started in background", duration: Date.now() - start }
      }

      const result = shell
        ? await execa(shell, [shell === "cmd" ? "/c" : "-command", command], {
            cwd: options?.cwd,
            timeout,
          })
        : await execa(command, [], { cwd: options?.cwd, timeout, shell: true })

      return {
        success: true,
        data: { stdout: result.stdout.slice(0, 10_000), stderr: result.stderr.slice(0, 2_000) },
        duration: Date.now() - start,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.stderr?.slice(0, 2_000) ?? String(err),
        duration: Date.now() - start,
      }
    }
  }

  /**
   * Get idle time in seconds.
   */
  async getIdleTime(): Promise<number> {
    try {
      if (this.platform === "win32") {
        const script = `Add-Type -MemberDefinition '
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
[StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
' -Name IdleTime -Namespace Win32
$lii = New-Object Win32.IdleTime+LASTINPUTINFO
$lii.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($lii)
[Win32.IdleTime]::GetLastInputInfo([ref]$lii) | Out-Null
$idle = ([Environment]::TickCount - $lii.dwTime) / 1000
[math]::Round($idle)`
        const { stdout } = await execa("powershell", ["-command", script], { timeout: 3_000 })
        return parseInt(stdout.trim()) || 0
      }

      if (this.platform === "darwin") {
        const { stdout } = await execa("ioreg", ["-c", "IOHIDSystem"])
        const match = stdout.match(/HIDIdleTime.*?(\d+)/)
        return match ? Math.floor(parseInt(match[1]) / 1_000_000_000) : 0
      }

      if (this.platform === "linux") {
        const { stdout } = await execa("xprintidle").catch(() => ({ stdout: "0" }))
        return Math.floor(parseInt(stdout) / 1000)
      }
    } catch {
      // Fallback: estimate from last known activity time
    }
    return Math.floor((Date.now() - this.lastActivity) / 1000)
  }

  /**
   * Get battery info (laptop only).
   */
  async getBatteryInfo(): Promise<{ level: number; charging: boolean } | null> {
    try {
      if (this.platform === "win32") {
        const script = `Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json`
        const { stdout } = await execa("powershell", ["-command", script], { timeout: 5_000 })
        if (!stdout.trim()) return null
        const data = JSON.parse(stdout)
        return {
          level: data.EstimatedChargeRemaining ?? 100,
          charging: data.BatteryStatus === 2,
        }
      }

      if (this.platform === "darwin") {
        const { stdout } = await execa("pmset", ["-g", "batt"])
        const match = stdout.match(/(\d+)%/)
        const charging = stdout.includes("charging") || stdout.includes("AC Power")
        return match ? { level: parseInt(match[1]), charging } : null
      }

      if (this.platform === "linux") {
        const level = await import("node:fs/promises")
          .then((f) => f.readFile("/sys/class/power_supply/BAT0/capacity", "utf-8"))
          .catch(() => null)
        const status = await import("node:fs/promises")
          .then((f) => f.readFile("/sys/class/power_supply/BAT0/status", "utf-8"))
          .catch(() => null)
        if (level) {
          return { level: parseInt(level.trim()), charging: status?.trim() === "Charging" }
        }
      }
    } catch {}
    return null
  }

  async shutdown(): Promise<void> {
    this.stopMonitoring()
    this.initialized = false
    log.info("System Monitor shut down")
  }

  // ── Private ──

  private async refreshState(): Promise<void> {
    const [cpuUsage, battery, idleTime, topProcesses, clipboard, diskUsage, networkConnected] = await Promise.all([
      this.getCPUUsage(),
      this.getBatteryInfo(),
      this.getIdleTime(),
      this.getTopProcesses(),
      this.config.watchClipboard ? this.getClipboard() : Promise.resolve(undefined),
      this.getDiskUsage(),
      this.checkNetworkConnection(),
    ])

    const totalMem = os.totalmem()
    const freeMem = os.freemem()

    this._state = {
      cpuUsage,
      ramUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
      batteryLevel: battery?.level,
      isCharging: battery?.charging,
      diskUsage,
      topProcesses,
      networkConnected,
      idleTimeSeconds: idleTime,
      clipboardPreview: clipboard?.slice(0, 200),
    }

    // Check thresholds and warn
    if (this._state.cpuUsage > this.config.cpuWarningThreshold) {
      log.warn(`CPU usage high: ${this._state.cpuUsage}%`)
    }
    if (this._state.ramUsage > this.config.ramWarningThreshold) {
      log.warn(`RAM usage high: ${this._state.ramUsage}%`)
    }
  }

  private lastCpuTimes: Array<{ idle: number; total: number }> | null = null

  private async getCPUUsage(): Promise<number> {
    const cpus = os.cpus()
    const currentTimes = cpus.map((cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)
      return { idle: cpu.times.idle, total }
    })

    if (!this.lastCpuTimes || this.lastCpuTimes.length !== currentTimes.length) {
      // First sample — store baseline and return estimate
      this.lastCpuTimes = currentTimes
      return 0
    }

    // Compute delta between two samples for actual current usage
    let totalDelta = 0
    let idleDelta = 0
    for (let i = 0; i < currentTimes.length; i++) {
      totalDelta += currentTimes[i].total - this.lastCpuTimes[i].total
      idleDelta += currentTimes[i].idle - this.lastCpuTimes[i].idle
    }

    this.lastCpuTimes = currentTimes

    if (totalDelta === 0) return 0
    return Math.round(((totalDelta - idleDelta) / totalDelta) * 100)
  }

  private async getTopProcesses(): Promise<string[]> {
    try {
      if (this.platform === "win32") {
        const { stdout } = await execa("powershell", [
          "-command",
          "Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 ProcessName | ForEach-Object { $_.ProcessName }",
        ], { timeout: 5_000 })
        return stdout.trim().split("\n").filter(Boolean)
      }

      const { stdout } = await execa("ps", ["aux", "--sort=-%cpu"], { timeout: 5_000 })
      return stdout
        .split("\n")
        .slice(1, 11)
        .map((line) => line.split(/\s+/)[10] ?? "")
        .filter(Boolean)
    } catch {
      return []
    }
  }

  private async getDiskUsage(): Promise<number> {
    try {
      if (this.platform === "win32") {
        const { stdout } = await execa("powershell", [
          "-command",
          `$d = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -eq 'C' }; [math]::Round(($d.Used / ($d.Used + $d.Free)) * 100)`,
        ], { timeout: 5_000 })
        return parseInt(stdout.trim()) || 0
      }
      if (this.platform === "darwin" || this.platform === "linux") {
        const { stdout } = await execa("df", ["-h", "/"], { timeout: 3_000 })
        const match = stdout.match(/(\d+)%/)
        return match ? parseInt(match[1]) : 0
      }
    } catch {}
    return 0
  }

  private async checkNetworkConnection(): Promise<boolean> {
    try {
      if (this.platform === "win32") {
        const { stdout } = await execa("powershell", [
          "-command",
          `(Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet)`,
        ], { timeout: 5_000 })
        return stdout.trim().toLowerCase() === "true"
      }
      // macOS / Linux: use ping
      await execa("ping", ["-c", "1", "-W", "2", "8.8.8.8"], { timeout: 5_000 })
      return true
    } catch {
      return false
    }
  }

  private async getClipboard(): Promise<string> {
    try {
      if (this.platform === "win32") {
        const { stdout } = await execa("powershell", ["-command", "Get-Clipboard"], { timeout: 2_000 })
        return stdout
      }
      if (this.platform === "darwin") {
        const { stdout } = await execa("pbpaste", [], { timeout: 2_000 })
        return stdout
      }
      if (this.platform === "linux") {
        const { stdout } = await execa("xclip", ["-selection", "clipboard", "-o"], { timeout: 2_000 }).catch(() =>
          execa("xsel", ["--clipboard", "--output"], { timeout: 2_000 }),
        )
        return stdout
      }
    } catch {}
    return ""
  }
}
