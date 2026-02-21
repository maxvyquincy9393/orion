import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"

export enum PermissionAction {
  SEND_MESSAGE = "messaging.send",
  PROACTIVE_MESSAGE = "proactive.message",
  FILE_READ = "files.read",
  FILE_WRITE = "files.write",
  TERMINAL_RUN = "terminal.run",
  CALENDAR_READ = "calendar.read",
  CALENDAR_WRITE = "calendar.write",
  BROWSER_SEARCH = "browser.search",
  BROWSER_NAVIGATE = "browser.navigate",
}

const ACTION_TO_SECTION: Record<string, string> = {
  [PermissionAction.SEND_MESSAGE]: "messaging",
  [PermissionAction.PROACTIVE_MESSAGE]: "proactive",
  [PermissionAction.FILE_READ]: "file_system",
  [PermissionAction.FILE_WRITE]: "file_system",
  [PermissionAction.TERMINAL_RUN]: "terminal",
  [PermissionAction.CALENDAR_READ]: "calendar",
  [PermissionAction.CALENDAR_WRITE]: "calendar",
  [PermissionAction.BROWSER_SEARCH]: "search",
  [PermissionAction.BROWSER_NAVIGATE]: "browsing",
}

interface PermissionSection {
  enabled?: boolean
  require_confirm?: boolean
  read?: boolean
  write?: boolean
  blocked_paths?: string[]
  allowed_paths?: string[]
  blocked_commands?: string[]
  allowed_domains?: string[]
  blocked_domains?: string[]
  quiet_hours?: { start: string; end: string }
}

interface PermissionResult {
  allowed: boolean
  requiresConfirm: boolean
  reason: string
}

type ChannelManager = {
  sendWithConfirm: (userId: string, message: string, action: string) => Promise<boolean>
}

export class PermissionSandbox {
  private config: Record<string, PermissionSection> = {}
  private channelManager: ChannelManager | null = null
  private defaultUserId: string

  constructor(defaultUserId = "owner") {
    this.defaultUserId = defaultUserId
  }

  setChannelManager(manager: ChannelManager): void {
    this.channelManager = manager
  }

  async load(filePath: string): Promise<void> {
    try {
      const absolutePath = path.resolve(filePath)
      const content = await fs.promises.readFile(absolutePath, "utf-8")
      this.config = yaml.load(content) as Record<string, PermissionSection>
      console.log("[PermissionSandbox] Permissions loaded from", absolutePath)
    } catch (err) {
      console.error("[PermissionSandbox] Failed to load permissions:", err)
      this.config = {}
    }
  }

  async check(action: PermissionAction, userId: string): Promise<boolean> {
    const sectionKey = ACTION_TO_SECTION[action]
    if (!sectionKey) {
      return false
    }

    const section = this.config[sectionKey]
    if (!section) {
      return false
    }

    if (!section.enabled) {
      return false
    }

    if (section.quiet_hours) {
      const now = new Date()
      const currentTime = now.toTimeString().slice(0, 5)
      const { start, end } = section.quiet_hours
      if (currentTime >= start && currentTime <= end) {
        return false
      }
    }

    return true
  }

  async checkWithConfirm(
    action: PermissionAction,
    userId: string,
    description: string
  ): Promise<boolean> {
    const sectionKey = ACTION_TO_SECTION[action]
    if (!sectionKey) {
      return false
    }

    const section = this.config[sectionKey]
    if (!section) {
      return false
    }

    if (!section.enabled) {
      return false
    }

    const baseAllowed = await this.check(action, userId)
    if (!baseAllowed) {
      return false
    }

    if (section.require_confirm) {
      if (!this.channelManager) {
        return false
      }

      const confirmMessage = `Permission request: ${description}\n\nReply with YES to confirm or NO to cancel.`
      const confirmed = await this.channelManager.sendWithConfirm(
        userId,
        confirmMessage,
        action
      )
      return confirmed
    }

    return true
  }

  getSection(action: PermissionAction): PermissionSection | null {
    const sectionKey = ACTION_TO_SECTION[action]
    return sectionKey ? this.config[sectionKey] || null : null
  }

  getConfig(): Record<string, PermissionSection> {
    return this.config
  }
}

export const sandbox = new PermissionSandbox()
