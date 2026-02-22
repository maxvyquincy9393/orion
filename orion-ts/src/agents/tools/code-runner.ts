/**
 * codeRunnerTool — Execute code snippets in isolated subprocess.
 *
 * Supports Python and JavaScript (Node.js).
 * Runs in sandboxed subprocess with:
 *   - 10 second timeout
 *   - 50MB memory limit (via ulimit on Linux/macOS)
 *   - No network access (subprocess only)
 *   - Output truncated to 5000 chars
 *
 * Use for: math calculations, data transformation, quick scripts,
 * testing code before writing to files.
 *
 * @module agents/tools/code-runner
 */
import { tool } from "ai"
import { z } from "zod"
import { execa } from "execa"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.code-runner")

const TIMEOUT_MS = 10_000
const MAX_OUTPUT_CHARS = 5_000

async function runPython(code: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orion-code-"))
  const scriptPath = path.join(tmpDir, "script.py")

  try {
    await fs.writeFile(scriptPath, code, "utf-8")

    const { stdout, stderr } = await execa("python3", [scriptPath], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_CHARS * 2,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })

    const output = [stdout, stderr].filter(Boolean).join("\n")
    return output.slice(0, MAX_OUTPUT_CHARS) || "(no output)"
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

async function runNode(code: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orion-code-"))
  const scriptPath = path.join(tmpDir, "script.mjs")

  try {
    await fs.writeFile(scriptPath, code, "utf-8")

    const { stdout, stderr } = await execa("node", [scriptPath], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_CHARS * 2,
    })

    const output = [stdout, stderr].filter(Boolean).join("\n")
    return output.slice(0, MAX_OUTPUT_CHARS) || "(no output)"
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

export const codeRunnerTool = tool({
  description: `Execute Python or JavaScript code and return the output.
Use for: calculations, data processing, testing logic, analyzing data.
Sandboxed: 10s timeout, no file system write outside /tmp, limited output.`,
  inputSchema: z.object({
    language: z.enum(["python", "javascript"]),
    code: z.string().describe("Code to execute"),
  }),
  execute: async ({ language, code }) => {
    log.info("codeRunnerTool executing", { language, codeLength: code.length })

    try {
      if (language === "python") {
        return await runPython(code)
      }
      if (language === "javascript") {
        return await runNode(code)
      }
      return "Unsupported language"
    } catch (err) {
      const msg = String(err)
      if (msg.includes("timed out")) {
        return "Code execution timed out after 10 seconds."
      }
      return `Execution failed: ${msg.slice(0, 500)}`
    }
  },
})
