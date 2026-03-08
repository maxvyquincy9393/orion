/**
 * @file service.ts
 * @description Cross-platform daemon management — install/uninstall/status/restart EDITH as a system service.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Platform detection routes to the appropriate service manager:
 *   - macOS: launchd (~/Library/LaunchAgents)
 *   - Linux: systemd --user
 *   - Windows: Task Scheduler (schtasks)
 *   Used by `edith daemon install/status/uninstall` CLI commands in src/cli/commands/daemon.ts.
 */
import { platform } from 'node:os'
import { createLogger } from '../logger.js'

const log = createLogger('daemon.service')

/** Status of the EDITH daemon process. */
export interface DaemonStatus {
  running: boolean
  pid: number | null
  platform: string
  uptime?: number
}

class DaemonManager {
  /**
   * Install EDITH as a system service for the current platform.
   * - macOS: launchd plist in ~/Library/LaunchAgents
   * - Linux: systemd user unit in ~/.config/systemd/user
   * - Windows: Task Scheduler entry via schtasks
   */
  async install(): Promise<void> {
    switch (platform()) {
      case 'darwin': return this.installLaunchd()
      case 'linux': return this.installSystemd()
      case 'win32': return this.installSchtasks()
      default: throw new Error(`Unsupported platform: ${platform()}`)
    }
  }

  /** Install launchd plist for macOS auto-start. */
  private async installLaunchd(): Promise<void> {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const plistDir = join(homedir(), 'Library', 'LaunchAgents')
    mkdirSync(plistDir, { recursive: true })
    const plistPath = join(plistDir, 'ai.edith.gateway.plist')
    const nodePath = process.execPath
    const editPath = process.argv[1] ?? 'edith'
    writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.edith.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${editPath}</string>
    <string>--mode</string><string>gateway</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${homedir()}/.edith/logs/gateway.log</string>
  <key>StandardErrorPath</key><string>${homedir()}/.edith/logs/gateway.error.log</string>
</dict>
</plist>`)
    log.info('launchd plist installed', { path: plistPath })
    const { execSync } = await import('node:child_process')
    execSync(`launchctl load ${plistPath}`)
  }

  /** Install systemd user unit for Linux auto-start. */
  private async installSystemd(): Promise<void> {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const unitDir = join(homedir(), '.config', 'systemd', 'user')
    mkdirSync(unitDir, { recursive: true })
    writeFileSync(join(unitDir, 'edith.service'), `[Unit]
Description=EDITH AI Gateway
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${process.argv[1] ?? 'edith'} --mode gateway
Restart=always
RestartSec=10

[Install]
WantedBy=default.target`)
    const { execSync } = await import('node:child_process')
    execSync('systemctl --user daemon-reload && systemctl --user enable edith && systemctl --user start edith')
    log.info('systemd unit installed')
  }

  /** Install Windows Task Scheduler entry for auto-start. */
  private async installSchtasks(): Promise<void> {
    const { execSync } = await import('node:child_process')
    const cmd = `node "${process.argv[1] ?? 'edith'}" --mode gateway`
    execSync(`schtasks /create /tn "EDITH Gateway" /tr "${cmd}" /sc onlogon /ru "${process.env.USERNAME ?? 'User'}" /f`)
    log.info('windows task scheduler entry created')
  }

  /**
   * Get current daemon status by pinging the gateway health endpoint.
   * @returns Status object with running flag and platform info.
   */
  async status(): Promise<DaemonStatus> {
    try {
      const res = await fetch('http://localhost:18789/health', { signal: AbortSignal.timeout(2000) })
      return { running: res.ok, pid: null, platform: platform() }
    } catch {
      return { running: false, pid: null, platform: platform() }
    }
  }

  /**
   * Uninstall the EDITH daemon service for the current platform.
   */
  async uninstall(): Promise<void> {
    const { execSync } = await import('node:child_process')
    switch (platform()) {
      case 'darwin':
        try { execSync('launchctl unload ~/Library/LaunchAgents/ai.edith.gateway.plist') } catch { /* not installed */ }
        break
      case 'linux':
        try { execSync('systemctl --user disable edith') } catch { /* not installed */ }
        break
      case 'win32':
        try { execSync('schtasks /delete /tn "EDITH Gateway" /f') } catch { /* not installed */ }
        break
    }
    log.info('daemon uninstalled')
  }
}

/** Singleton daemon manager. */
export const daemonManager = new DaemonManager()
