/**
 * systemTool — OS-level operations for Jarvis-style awareness.
 *
 * Actions:
 *   clipboard_read   — Read current clipboard content
 *   clipboard_write  — Write text to clipboard
 *   processes        — List running processes (top 20 by CPU)
 *   system_info      — CPU, RAM, disk, uptime
 *   notify           — Send desktop notification
 *
 * Based on OS Agent paradigm (arXiv 2501.16150):
 * agents need system observation space including process state
 * and environment context to make grounded decisions.
 *
 * @module agents/tools/system
 */
import { tool } from "ai"
import { z } from "zod"
import os from "node:os"
import { execa } from "execa"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.system")

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3)
  return `${gb.toFixed(1)} GB`
}

async function getClipboard(): Promise<string> {
  const platform = process.platform
  if (platform === "darwin") {
    const { stdout } = await execa("pbpaste")
    return stdout
  }
  if (platform === "linux") {
    const { stdout } = await execa("xclip", ["-selection", "clipboard", "-o"]).catch(() =>
      execa("xsel", ["--clipboard", "--output"])
    )
    return stdout
  }
  if (platform === "win32") {
    const { stdout } = await execa("powershell", ["-command", "Get-Clipboard"])
    return stdout
  }
  return "Clipboard not supported on this platform"
}

async function setClipboard(text: string): Promise<void> {
  const platform = process.platform
  if (platform === "darwin") {
    const proc = execa("pbcopy")
    proc.stdin?.write(text)
    proc.stdin?.end()
    await proc
    return
  }
  if (platform === "linux") {
    const proc = execa("xclip", ["-selection", "clipboard"])
    proc.stdin?.write(text)
    proc.stdin?.end()
    await proc
    return
  }
  if (platform === "win32") {
    await execa("powershell", ["-command", `Set-Clipboard -Value '${text.replace(/'/g, "''")}'`])
    return
  }
}

async function sendNotification(title: string, message: string): Promise<void> {
  const platform = process.platform
  if (platform === "darwin") {
    await execa("osascript", ["-e", `display notification "${message}" with title "${title}"`])
    return
  }
  if (platform === "linux") {
    await execa("notify-send", [title, message]).catch(() => {
      log.warn("notify-send not available")
    })
    return
  }
  if (platform === "win32") {
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${message}', '${title}')`
    await execa("powershell", ["-command", script])
    return
  }
}

export const systemTool = tool({
  description: `Access OS-level information and controls.
Actions: clipboard_read, clipboard_write(text), processes, system_info, notify(title, message).
Use for: reading/writing clipboard, checking running processes, system health, desktop notifications.`,
  inputSchema: z.object({
    action: z.enum(["clipboard_read", "clipboard_write", "processes", "system_info", "notify"]),
    text: z.string().optional().describe("Text to write to clipboard or notification message"),
    title: z.string().optional().describe("Notification title"),
  }),
  execute: async ({ action, text, title }) => {
    try {
      if (action === "clipboard_read") {
        const content = await getClipboard()
        return content.slice(0, 2_000)
      }

      if (action === "clipboard_write") {
        if (!text) return "Error: text required"
        await setClipboard(text)
        return `Clipboard updated (${text.length} chars)`
      }

      if (action === "processes") {
        const platform = process.platform
        if (platform === "win32") {
          const { stdout } = await execa("tasklist", ["/fo", "table"], { timeout: 5_000 })
          return stdout.split("\n").slice(0, 25).join("\n")
        }
        // Linux/macOS
        const { stdout } = await execa("ps", ["aux", "--sort=-%cpu"], {
          timeout: 5_000,
        })
        return stdout.split("\n").slice(0, 20).join("\n")
      }

      if (action === "system_info") {
        const info = {
          platform: process.platform,
          arch: process.arch,
          hostname: os.hostname(),
          uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
          cpuModel: os.cpus()[0]?.model ?? "unknown",
          cpuCores: os.cpus().length,
          totalMem: formatBytes(os.totalmem()),
          freeMem: formatBytes(os.freemem()),
          loadAvg: os.loadavg().map((n) => n.toFixed(2)).join(", "),
          nodeVersion: process.version,
        }
        return JSON.stringify(info, null, 2)
      }

      if (action === "notify") {
        await sendNotification(title ?? "Orion", text ?? "")
        return "Notification sent"
      }

      return "Unknown action"
    } catch (err) {
      log.error("systemTool failed", { action, error: String(err) })
      return `System action failed: ${String(err)}`
    }
  },
})
