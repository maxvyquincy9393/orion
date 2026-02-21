import { tool } from "ai"
import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { execa } from "execa"
import { sandbox, PermissionAction } from "../permissions/sandbox"
import config from "../config"

const BLOCKED_COMMANDS = ["rm -rf", "format", "del /", "mkfs", "dd if=", "> /dev/sd"]

async function duckDuckGoSearch(query: string, maxResults: number): Promise<string> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  try {
    const response = await fetch(searchUrl)
    const html = await response.text()
    const results: string[] = []
    const regex = /<a[^>]*class="result__a"[^>]*>([^<]+)<\/a>/g
    let match
    let count = 0
    while ((match = regex.exec(html)) !== null && count < maxResults) {
      results.push(`${count + 1}. ${match[1].trim()}`)
      count++
    }
    if (results.length === 0) {
      return "No search results found."
    }
    return `Search results for: ${query}\n\n${results.join("\n")}`
  } catch (err) {
    return `Search failed: ${err}`
  }
}

export const searchTool = tool({
  description: "Search the web for information",
  parameters: z.object({
    query: z.string(),
    maxResults: z.number().default(5),
  }),
  execute: async ({ query, maxResults }) => {
    return await duckDuckGoSearch(query, maxResults)
  },
})

export const memoryQueryTool = tool({
  description: "Search Orion memory for past information",
  parameters: z.object({
    query: z.string(),
    userId: z.string(),
  }),
  execute: async ({ query, userId }) => {
    try {
      const dbPath = path.resolve(".orion/memory.db")
      if (!fs.existsSync(dbPath)) {
        return "No memory database found."
      }
      return `Memory search for '${query}' (user: ${userId}): Feature requires database integration.`
    } catch (err) {
      return `Memory query failed: ${err}`
    }
  },
})

export const fileReadTool = tool({
  description: "Read a file from the filesystem",
  parameters: z.object({
    path: z.string(),
  }),
  execute: async ({ path: filePath }) => {
    const allowed = await sandbox.check(PermissionAction.FILE_READ, config.DEFAULT_USER_ID)
    if (!allowed) {
      return "[Permission Denied] File read is not allowed."
    }

    try {
      const content = await fs.promises.readFile(filePath, "utf-8")
      return `Contents of ${filePath}:\n\n${content}`
    } catch (err) {
      return `[Error] Failed to read file: ${err}`
    }
  },
})

export const fileWriteTool = tool({
  description: "Write content to a file",
  parameters: z.object({
    path: z.string(),
    content: z.string(),
  }),
  execute: async ({ path: filePath, content }) => {
    const allowed = await sandbox.checkWithConfirm(
      PermissionAction.FILE_WRITE,
      config.DEFAULT_USER_ID,
      `Write to file: ${filePath}`
    )
    if (!allowed) {
      return "[Permission Denied] File write was not confirmed."
    }

    try {
      await fs.promises.writeFile(filePath, content, "utf-8")
      return `Successfully wrote to ${filePath}`
    } catch (err) {
      return `[Error] Failed to write file: ${err}`
    }
  },
})

export const terminalTool = tool({
  description: "Run a terminal command",
  parameters: z.object({
    command: z.string(),
  }),
  execute: async ({ command }) => {
    const isBlocked = BLOCKED_COMMANDS.some((blocked) =>
      command.toLowerCase().includes(blocked.toLowerCase())
    )
    if (isBlocked) {
      return "[Error] Command blocked for safety reasons."
    }

    const allowed = await sandbox.checkWithConfirm(
      PermissionAction.TERMINAL_RUN,
      config.DEFAULT_USER_ID,
      `Run command: ${command}`
    )
    if (!allowed) {
      return "[Permission Denied] Terminal command was not confirmed."
    }

    try {
      const result = await execa(command, {
        shell: true,
        timeout: 30000,
        reject: false,
      })
      const output = []
      if (result.stdout) {
        output.push(`STDOUT:\n${result.stdout}`)
      }
      if (result.stderr) {
        output.push(`STDERR:\n${result.stderr}`)
      }
      output.push(`Exit code: ${result.exitCode}`)
      return output.join("\n\n")
    } catch (err) {
      return `[Error] Command failed: ${err}`
    }
  },
})

export const calendarTool = tool({
  description: "Get or add calendar events",
  parameters: z.object({
    action: z.enum(["get", "add"]),
    title: z.string().optional(),
    date: z.string().optional(),
  }),
  execute: async ({ action, title, date }) => {
    const calendarPath = path.resolve(".orion/calendar.ics")

    if (action === "get") {
      const allowed = await sandbox.check(PermissionAction.CALENDAR_READ, config.DEFAULT_USER_ID)
      if (!allowed) {
        return "[Permission Denied] Calendar read is not allowed."
      }

      try {
        if (!fs.existsSync(calendarPath)) {
          return "No calendar events found."
        }
        const content = await fs.promises.readFile(calendarPath, "utf-8")
        return `Calendar events:\n${content}`
      } catch (err) {
        return `[Error] Failed to read calendar: ${err}`
      }
    }

    if (action === "add") {
      const allowed = await sandbox.checkWithConfirm(
        PermissionAction.CALENDAR_WRITE,
        config.DEFAULT_USER_ID,
        `Add calendar event: ${title} on ${date}`
      )
      if (!allowed) {
        return "[Permission Denied] Calendar write was not confirmed."
      }

      try {
        const event = `BEGIN:VEVENT\nDTSTART:${date}\nSUMMARY:${title}\nEND:VEVENT\n`
        if (fs.existsSync(calendarPath)) {
          const existing = await fs.promises.readFile(calendarPath, "utf-8")
          const updated = existing.replace("END:VCALENDAR", `${event}END:VCALENDAR`)
          await fs.promises.writeFile(calendarPath, updated)
        } else {
          const newCal = `BEGIN:VCALENDAR\nVERSION:2.0\n${event}END:VCALENDAR`
          await fs.promises.writeFile(calendarPath, newCal)
        }
        return `Added event: ${title} on ${date}`
      } catch (err) {
        return `[Error] Failed to add event: ${err}`
      }
    }

    return "[Error] Unknown calendar action."
  },
})

export const orionTools = {
  searchTool,
  memoryQueryTool,
  fileReadTool,
  fileWriteTool,
  terminalTool,
  calendarTool,
}
