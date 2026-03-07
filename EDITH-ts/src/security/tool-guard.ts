import { createLogger } from "../logger.js"

const log = createLogger("security.tool-guard")

export const BLOCKED_COMMANDS = [
  "rm -rf",
  "rm -rf /",
  "rm -rf /*",
  "del /f",
  "format",
  "mkfs",
  "shutdown",
  "reboot",
  "init 0",
  "init 6",
  ":(){:|:&};:",
  "dd if=",
  "dd if=/dev/zero",
  "dd if=/dev/urandom",
  "> /dev/sda",
  "mv /* /dev/null",
  "chmod -R 777 /",
  "chown -R",
  "wget",
  "curl",
  "nc -l",
  "ncat",
]

const DANGEROUS_COMMAND_CHAINS = [
  /\|\s*(rm|del|format|shutdown|reboot)/i,
  /&&\s*(rm|del|format|shutdown|reboot)/i,
  /;\s*(rm|del|format|shutdown|reboot)/i,
  /\|\|\s*(rm|del|format|shutdown|reboot)/i,
  /\$\(/,
  /`/,
  />\s*\/dev\/(sda|hda|nvme)/i,
]

const PROTECTED_PATHS = [
  "/etc",
  "/sys",
  "/proc",
  "/root",
  "/boot",
  "/dev",
  "/lib",
  "/usr",
  "/bin",
  "/sbin",
  "C:\\Windows",
  "C:\\System",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
]

const SENSITIVE_FILES = [
  ".env",
  ".ssh",
  ".git/config",
  ".git/credentials",
  ".aws/credentials",
  ".npmrc",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
  ".pgpass",
  ".my.cnf",
]

const SSRF_BLOCKED_HOSTS = [
  "localhost",
  "127.",
  "0.0.0.0",
  "10.",
  "192.168.",
  "172.16",
  "172.17",
  "172.18",
  "172.19",
  "172.20",
  "172.21",
  "172.22",
  "172.23",
  "172.24",
  "172.25",
  "172.26",
  "172.27",
  "172.28",
  "172.29",
  "172.30",
  "172.31",
  "169.254.",
  "::1",
  "fd00::",
  "fc00::",
  "fe80::",
  "0.0.0.0",
]

export interface GuardResult {
  allowed: boolean
  reason?: string
}

export function guardTerminal(command: string, userId: string): GuardResult {
  try {
    const normalizedCommand = command.toLowerCase().trim()

    for (const blocked of BLOCKED_COMMANDS) {
      if (normalizedCommand.includes(blocked.toLowerCase())) {
        log.warn("Terminal command blocked", {
          userId,
          reason: "blocked command",
          preview: command.slice(0, 50),
        })
        return { allowed: false, reason: `Command contains blocked pattern: "${blocked}"` }
      }
    }

    for (const pattern of DANGEROUS_COMMAND_CHAINS) {
      if (pattern.test(command)) {
        log.warn("Terminal command blocked", {
          userId,
          reason: "dangerous chain pattern",
          preview: command.slice(0, 50),
        })
        return { allowed: false, reason: "Command contains dangerous chain pattern" }
      }
    }

    if (command.includes("../") || command.includes("..\\\\")) {
      const traversalCount = (command.match(/\.\.\//g) || []).length + (command.match(/\.\.\\\\/g) || []).length
      if (traversalCount > 2) {
        log.warn("Terminal command blocked", {
          userId,
          reason: "path traversal",
          preview: command.slice(0, 50),
        })
        return { allowed: false, reason: "Command contains excessive path traversal" }
      }
    }

    return { allowed: true }
  } catch (error) {
    log.error("guardTerminal error", error)
    return { allowed: false, reason: "Guard check failed" }
  }
}

export function guardFilePath(
  filePath: string,
  action: "read" | "write",
  userId: string
): GuardResult {
  try {
    const normalizedPath = filePath.replace(/\\\\/g, "/").toLowerCase()

    for (const protectedPath of PROTECTED_PATHS) {
      const normalized = protectedPath.replace(/\\\\/g, "/").toLowerCase()
      if (normalizedPath.startsWith(normalized)) {
        log.warn("File access blocked", {
          userId,
          action,
          reason: "protected path",
          preview: filePath.slice(0, 50),
        })
        return { allowed: false, reason: `Access to protected path: "${protectedPath}"` }
      }
    }

    const traversalCount = (filePath.match(/\.\.\//g) || []).length + (filePath.match(/\.\.\\\\/g) || []).length
    if (traversalCount > 2) {
      log.warn("File access blocked", {
        userId,
        action,
        reason: "path traversal",
        preview: filePath.slice(0, 50),
      })
      return { allowed: false, reason: "Excessive path traversal not allowed" }
    }

    for (const sensitive of SENSITIVE_FILES) {
      if (normalizedPath.endsWith(sensitive.toLowerCase())) {
        log.warn("File access blocked", {
          userId,
          action,
          reason: "sensitive file",
          preview: filePath.slice(0, 50),
        })
        return { allowed: false, reason: `Access to sensitive file: "${sensitive}"` }
      }
    }

    return { allowed: true }
  } catch (error) {
    log.error("guardFilePath error", error)
    return { allowed: false, reason: "Guard check failed" }
  }
}

export function guardUrl(url: string): GuardResult {
  try {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return { allowed: false, reason: "Invalid URL format" }
    }

    if (parsedUrl.protocol === "file:") {
      log.warn("URL blocked", { reason: "file protocol", preview: url.slice(0, 50) })
      return { allowed: false, reason: "file:// protocol is not allowed" }
    }

    const hostname = parsedUrl.hostname.toLowerCase()

    for (const blocked of SSRF_BLOCKED_HOSTS) {
      if (hostname === blocked || hostname.startsWith(blocked)) {
        log.warn("URL blocked", { reason: "SSRF protection", preview: url.slice(0, 50) })
        return { allowed: false, reason: `Access to internal network is not allowed: "${hostname}"` }
      }
    }

    return { allowed: true }
  } catch (error) {
    log.error("guardUrl error", error)
    return { allowed: false, reason: "Guard check failed" }
  }
}

export function wrapWithGuard(
  tools: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {}

  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool !== "object" || tool === null) {
      wrapped[name] = tool
      continue
    }

    const toolObj = tool as Record<string, unknown>
    if (typeof toolObj.execute !== "function") {
      wrapped[name] = tool
      continue
    }

    const originalExecute = toolObj.execute as (...args: unknown[]) => Promise<unknown>

    const wrappedExecute = async (...args: unknown[]): Promise<unknown> => {
      const firstArg = args[0] as Record<string, unknown> | undefined

      if (firstArg) {
        if ("command" in firstArg && typeof firstArg.command === "string") {
          const guard = guardTerminal(firstArg.command, userId)
          if (!guard.allowed) {
            return guard.reason ?? "Command blocked by security guard"
          }
        }

        if ("path" in firstArg && typeof firstArg.path === "string") {
          const action = name.includes("write") || name.includes("Write") ? "write" : "read"
          const guard = guardFilePath(firstArg.path, action, userId)
          if (!guard.allowed) {
            return guard.reason ?? "File access blocked by security guard"
          }
        }

        if ("url" in firstArg && typeof firstArg.url === "string") {
          const guard = guardUrl(firstArg.url)
          if (!guard.allowed) {
            return guard.reason ?? "URL blocked by security guard"
          }
        }
      }

      try {
        return await originalExecute(...args)
      } catch (error) {
        log.error("Tool execution error", { tool: name, error })
        return `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    wrapped[name] = {
      ...toolObj,
      execute: wrappedExecute,
    }
  }

  return wrapped
}
