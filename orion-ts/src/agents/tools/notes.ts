/**
 * notesTool — Persistent notes and journal management.
 *
 * Actions:
 *   append  — Add a new note or journal entry
 *   read    — Read notes (optionally filtered by tag or date)
 *   search  — Full-text search in notes
 *   list    — List recent note titles
 *
 * Notes stored in .orion/notes/YYYY-MM-DD.md (one file per day)
 * with YAML frontmatter for metadata (tags, category).
 *
 * @module agents/tools/notes
 */
import { tool } from "ai"
import { z } from "zod"
import fs from "node:fs/promises"
import path from "node:path"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.notes")
const NOTES_DIR = path.resolve(process.cwd(), ".orion", "notes")

async function ensureNotesDir(): Promise<void> {
  await fs.mkdir(NOTES_DIR, { recursive: true })
}

function todayFilename(): string {
  return new Date().toISOString().slice(0, 10) + ".md"
}

export const notesTool = tool({
  description: `Manage persistent notes and journal entries.
Actions: append(text, tags?), read(date?), search(query), list.
Notes persist across sessions in .orion/notes/.
Use for: saving important info, journaling, tagging observations, to-do items.`,
  inputSchema: z.object({
    action: z.enum(["append", "read", "search", "list"]),
    text: z.string().optional().describe("Note content to append"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    date: z.string().optional().describe("Date to read (YYYY-MM-DD). Defaults to today."),
    query: z.string().optional().describe("Search query for full-text search"),
    limit: z.number().optional().default(10),
  }),
  execute: async ({ action, text, tags, date, query, limit }) => {
    try {
      await ensureNotesDir()

      if (action === "append") {
        if (!text) return "Error: text required"
        const filename = path.join(NOTES_DIR, todayFilename())
        const timestamp = new Date().toISOString()
        const tagStr = tags?.length ? `\ntags: [${tags.join(", ")}]` : ""
        const entry = `\n---\ntime: ${timestamp}${tagStr}\n\n${text}\n`
        await fs.appendFile(filename, entry, "utf-8")
        log.info("note appended", { chars: text.length })
        return `Note saved (${text.length} chars)`
      }

      if (action === "read") {
        const filename = path.join(NOTES_DIR, `${date ?? new Date().toISOString().slice(0, 10)}.md`)
        try {
          return await fs.readFile(filename, "utf-8")
        } catch {
          return `No notes found for ${date ?? "today"}.`
        }
      }

      if (action === "list") {
        const files = await fs.readdir(NOTES_DIR)
        const mdFiles = files
          .filter((f) => f.endsWith(".md"))
          .sort()
          .slice(-limit)
        return mdFiles.length > 0 ? mdFiles.join("\n") : "No notes found."
      }

      if (action === "search") {
        if (!query) return "Error: query required"
        const files = await fs.readdir(NOTES_DIR)
        const results: string[] = []
        const queryLower = query.toLowerCase()

        for (const file of files.filter((f) => f.endsWith(".md")).slice(-30)) {
          const content = await fs.readFile(path.join(NOTES_DIR, file), "utf-8")
          if (content.toLowerCase().includes(queryLower)) {
            const lines = content
              .split("\n")
              .filter((l) => l.toLowerCase().includes(queryLower))
              .slice(0, 3)
            results.push(`[${file}] ${lines.join(" | ")}`)
          }
          if (results.length >= limit) break
        }

        return results.length > 0 ? results.join("\n") : "No matching notes."
      }

      return "Unknown action"
    } catch (err) {
      log.error("notesTool failed", { action, error: String(err) })
      return `Notes action failed: ${String(err)}`
    }
  },
})
