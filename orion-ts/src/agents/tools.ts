import { tool } from "ai"
import { z } from "zod"
import { execa } from "execa"
import fs from "fs/promises"

import { memory } from "../memory/store.js"
import { createLogger } from "../logger.js"

const logger = createLogger("tools")

const BLOCKED_COMMANDS = [
  "rm -rf",
  "del /f",
  "format",
  "mkfs",
  "shutdown",
  "reboot",
  ":(){:|:&};:",
  "dd if=",
]

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

export const searchTool = tool({
  description: "Search the web for current information",
  parameters: z.object({
    query: z.string(),
    maxResults: z.number().default(5),
  }),
  execute: async ({ query, maxResults }) => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      const html = await res.text()

      const results: Array<{ title: string; url: string; snippet: string }> = []
      const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/g

      const snippets: string[] = []
      let snippetMatch
      while ((snippetMatch = snippetRegex.exec(html)) !== null) {
        const raw = snippetMatch[1] || snippetMatch[2] || ""
        snippets.push(decodeHtml(stripHtml(raw)))
      }

      let match
      let count = 0
      while ((match = linkRegex.exec(html)) !== null && count < maxResults) {
        const href = decodeHtml(match[1])
        const title = decodeHtml(stripHtml(match[2]))
        const snippet = snippets[count] ?? ""
        results.push({ title, url: href, snippet })
        count += 1
      }

      if (!results.length) {
        return "Search unavailable."
      }

      return results
        .map((item) => `${item.title}\n${item.url}\n${item.snippet}\n---`)
        .join("\n")
    } catch (err) {
      logger.error("search failed", err)
      return "Search unavailable."
    }
  },
})

export const memoryQueryTool = tool({
  description: "Search Orion memory for past conversations",
  parameters: z.object({
    query: z.string(),
    userId: z.string().default("owner"),
  }),
  execute: async ({ query, userId }) => {
    const results = await memory.search(userId, query)
    if (!results.length) {
      return "No relevant memories found."
    }
    return results.map((r) => r.content).join("\n---\n")
  },
})

export const fileReadTool = tool({
  description: "Read a file",
  parameters: z.object({
    path: z.string(),
  }),
  execute: async ({ path }) => {
    try {
      return await fs.readFile(path, "utf-8")
    } catch (err) {
      return `Error reading file: ${String(err)}`
    }
  },
})

export const fileWriteTool = tool({
  description: "Write content to a file",
  parameters: z.object({
    path: z.string(),
    content: z.string(),
  }),
  execute: async ({ path, content }) => {
    try {
      await fs.writeFile(path, content, "utf-8")
      return `Written to ${path}`
    } catch (err) {
      return `Error writing file: ${String(err)}`
    }
  },
})

export const fileListTool = tool({
  description: "List files in a directory",
  parameters: z.object({
    path: z.string(),
  }),
  execute: async ({ path }) => {
    try {
      const entries = await fs.readdir(path, { withFileTypes: true })
      return entries
        .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
        .join("\n")
    } catch (err) {
      return `Error listing dir: ${String(err)}`
    }
  },
})

export const terminalTool = tool({
  description: "Run a terminal command",
  parameters: z.object({
    command: z.string(),
  }),
  execute: async ({ command }) => {
    const blocked = BLOCKED_COMMANDS.find((blockedCmd) =>
      command.toLowerCase().includes(blockedCmd),
    )
    if (blocked) {
      return `Command blocked: contains "${blocked}"`
    }

    try {
      const { stdout, stderr } = await execa("sh", ["-c", command], {
        timeout: 30_000,
      })
      return [stdout, stderr].filter(Boolean).join("\n")
    } catch (err) {
      return `Command failed: ${String(err)}`
    }
  },
})

export const calendarTool = tool({
  description: "Get or add calendar events",
  parameters: z.object({
    action: z.enum(["get", "add"]),
    title: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
  }),
  execute: async ({ action, title, date, time }) => {
    const icsPath = ".orion/calendar.ics"

    if (action === "get") {
      try {
        return await fs.readFile(icsPath, "utf-8")
      } catch {
        return "No calendar found."
      }
    }

    const start = date
      ? time
        ? `${date}T${time}`
        : date
      : new Date().toISOString()

    const event = [
      "BEGIN:VEVENT",
      `SUMMARY:${title ?? "Untitled"}`,
      `DTSTART:${start}`,
      "END:VEVENT",
    ].join("\n")

    await fs.appendFile(icsPath, `\n${event}`)
    return `Event added: ${title ?? "Untitled"}`
  },
})

export const orionTools = {
  searchTool,
  memoryQueryTool,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  terminalTool,
  calendarTool,
}
