/**
 * emailTool — Email read and send via IMAP/SMTP.
 *
 * Actions:
 *   read    — Fetch recent emails from inbox (IMAP)
 *   send    — Send an email (SMTP)
 *   search  — Search emails by query
 *
 * Config (from .env):
 *   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS
 *   EMAIL_SMTP_HOST, EMAIL_SMTP_PORT
 *
 * Note: This tool requires Python with the email-handling packages.
 * If not configured, it returns an error explaining the setup.
 *
 * @module agents/tools/email
 */
import { tool } from "ai"
import { z } from "zod"
import { execa } from "execa"
import path from "node:path"
import config from "../../config.js"
import { filterToolResult } from "../../security/prompt-filter.js"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.email")
const MAX_BODY_CHARS = 3_000
const MAX_EMAILS = 10

const PYTHON_PATH = config.PYTHON_PATH || "python"
const CWD = path.resolve(process.cwd())

async function readEmails(query?: string): Promise<string> {
  const pythonCode = `
import sys
sys.path.insert(0, '.')
try:
    from delivery.email_client import EmailClient
    client = EmailClient()
    emails = client.read_recent(${MAX_EMAILS}${query ? `, "${query}"` : ""})
    import json
    print(json.dumps(emails))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
  `.trim()

  const { stdout, stderr } = await execa(
    PYTHON_PATH,
    ["-c", pythonCode],
    { cwd: CWD, timeout: 30_000 }
  )

  if (stderr) {
    log.warn("email read warning", { stderr })
  }

  const emails = JSON.parse(stdout) as Array<{ from: string; subject: string; date: string; body: string }>

  if (emails.length === 0) {
    return "No emails found."
  }

  return emails
    .map((e) => `From: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\n\n${e.body.slice(0, MAX_BODY_CHARS)}`)
    .join("\n\n---\n\n")
}

async function sendEmail(to: string, subject: string, body: string): Promise<string> {
  const pythonCode = `
import sys
sys.path.insert(0, '.')
try:
    from delivery.email_client import EmailClient
    client = EmailClient()
    result = client.send("${to}", "${subject.replace(/"/g, '\\"')}", """${body.replace(/"/g, '\\"')}""")
    print(result)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
  `.trim()

  await execa(
    PYTHON_PATH,
    ["-c", pythonCode],
    { cwd: CWD, timeout: 30_000 }
  )

  log.info("email sent", { to, subject })
  return `Email sent to ${to}: "${subject}"`
}

export const emailTool = tool({
  description: `Read and send emails.
Actions: read (fetch recent/unread), send (compose and send), search (find by keyword).
Requires EMAIL_USER and EMAIL_PASS in environment.
Use for: reading inbox, sending messages, email summaries.`,
  inputSchema: z.object({
    action: z.enum(["read", "send", "search"]),
    to: z.string().optional().describe("Recipient email address (for send)"),
    subject: z.string().optional().describe("Email subject (for send)"),
    body: z.string().optional().describe("Email body text (for send)"),
    query: z.string().optional().describe("Search query (for search/read filtering)"),
  }),
  execute: async ({ action, to, subject, body, query }) => {
    // Check if email is configured
    if (!config.EMAIL_USER || !config.EMAIL_PASS) {
      return "Email not configured. Set EMAIL_USER and EMAIL_PASS in environment variables."
    }

    try {
      if (action === "send") {
        if (!to || !subject || !body) return "Error: to, subject, and body required for send"
        return await sendEmail(to, subject, body)
      }

      if (action === "read" || action === "search") {
        const raw = await readEmails(query)
        const filtered = filterToolResult(raw)
        return filtered.sanitized
      }

      return "Unknown action"
    } catch (err) {
      log.error("emailTool failed", { action, error: String(err) })
      return `Email action failed: ${String(err)}`
    }
  },
})
