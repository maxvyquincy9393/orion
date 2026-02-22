import { tool } from "ai"
import { z } from "zod"
import { execa } from "execa"
import fs from "fs/promises"
import path from "node:path"

import { memory } from "../memory/store.js"
import { filterToolResult } from "../security/prompt-filter.js"
import { BLOCKED_COMMANDS, guardTerminal, guardFilePath } from "../security/tool-guard.js"
import { createLogger } from "../logger.js"
import { skillLoader } from "../skills/loader.js"

// Phase T-1: New Super-Tools
import { browserTool } from "./tools/browser.js"
import { httpTool } from "./tools/http.js"
import { emailTool } from "./tools/email.js"
import { systemTool } from "./tools/system.js"
import { notesTool } from "./tools/notes.js"
import { channelSendTool, channelStatusTool } from "./tools/channel.js"
import { screenshotAnalyzeTool } from "./tools/screenshot.js"
import { codeRunnerTool } from "./tools/code-runner.js"
import { weatherTimeTool } from "./tools/weather-time.js"

const logger = createLogger("tools")

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
  inputSchema: z.object({
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

      const rawOutput = results
        .map((item) => `${item.title}\n${item.url}\n${item.snippet}\n---`)
        .join("\n")

      const filtered = filterToolResult(rawOutput)
      return filtered.sanitized
    } catch (err) {
      logger.error("search failed", err)
      return "Search unavailable."
    }
  },
})

export const memoryQueryTool = tool({
  description: "Search Orion memory for past conversations",
  inputSchema: z.object({
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
  inputSchema: z.object({
    path: z.string(),
  }),
  execute: async ({ path }) => {
    const guard = guardFilePath(path, "read", "tool")
    if (!guard.allowed) {
      return guard.reason ?? "File access blocked"
    }
    try {
      return await fs.readFile(path, "utf-8")
    } catch (err) {
      return `Error reading file: ${String(err)}`
    }
  },
})

export const fileWriteTool = tool({
  description: "Write content to a file",
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  execute: async ({ path, content }) => {
    const guard = guardFilePath(path, "write", "tool")
    if (!guard.allowed) {
      return guard.reason ?? "File access blocked"
    }
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
  inputSchema: z.object({
    path: z.string(),
  }),
  execute: async ({ path }) => {
    const guard = guardFilePath(path, "read", "tool")
    if (!guard.allowed) {
      return guard.reason ?? "File access blocked"
    }
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

export const readSkillTool = tool({
  description:
    "Read the full instructions for a skill. Use this for skills listed in <available_skills>.",
  inputSchema: z.object({
    location: z
      .string()
      .describe("Full path to the SKILL.md file from the <available_skills> index"),
  }),
  execute: async ({ location }) => {
    const content = await skillLoader.loadSkillContent(location)
    if (!content) {
      return { error: `Skill not found or access denied: ${location}` }
    }

    return {
      content,
      skillName: path.basename(path.dirname(location)),
    }
  },
})

export const terminalTool = tool({
  description: "Run a terminal command",
  inputSchema: z.object({
    command: z.string(),
  }),
  execute: async ({ command }) => {
    const guard = guardTerminal(command, "tool")
    if (!guard.allowed) {
      return guard.reason ?? "Command blocked"
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
  inputSchema: z.object({
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
  // Existing tools
  searchTool,
  memoryQueryTool,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  read_skill: readSkillTool,
  terminalTool,
  calendarTool,
  // Phase T-1: Super-Tools
  browserTool,
  httpTool,
  emailTool,
  systemTool,
  notesTool,
  channelSendTool,
  channelStatusTool,
  screenshotAnalyzeTool,
  codeRunnerTool,
  weatherTimeTool,
}
