/**
 * @file doc-skill.ts
 * @description EDITH skill for generating JSDoc/TSDoc documentation from source code.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements the Skill interface from src/skills/manager.ts.
 *   Delegates to codeAgent.generateDocs() (src/agents/code-agent.ts).
 *   Accepts source code pasted directly in the message or a file path in the cwd.
 *
 *   Register via skillManager.register(docSkill) in src/core/startup.ts.
 */

import { readFile } from "node:fs/promises"
import { createLogger } from "../logger.js"
import { codeAgent } from "../agents/code-agent.js"
import type { Skill } from "./manager.js"

const log = createLogger("skills.doc")

/** Trigger pattern for documentation-related requests. */
const DOC_TRIGGER =
  /\b(?:generate|add|write|create)\s+(?:docs?|documentation|jsdoc|tsdoc|comments?)\b|\bdocument\s+(?:this|the|my)\s+(?:code|file|function|class|module)\b/i

/**
 * Extracts a file path from the user message if one is present.
 * Looks for patterns like "for src/foo.ts", "in src/foo.ts", or a bare .ts/.js path.
 * @param input - Raw user message
 * @returns File path string or null
 */
function extractFilePath(input: string): string | null {
  const match = input.match(/(?:for|in|from|file)\s+([\w./-]+\.(?:ts|js|tsx|jsx|py))\b/i)
  if (match?.[1]) return match[1]
  const bare = input.match(/\b([\w/-]+\.(?:ts|js|tsx|jsx|py))\b/)
  return bare?.[1] ?? null
}

/**
 * Extracts an inline code block from the user message (```...```).
 * @param input - Raw user message
 * @returns Code string or null
 */
function extractCodeBlock(input: string): string | null {
  const match = input.match(/```[\w]*\n([\s\S]+?)```/)
  return match?.[1]?.trim() ?? null
}

/**
 * Routes documentation requests to the CodeAgent.
 * @param input - User message
 * @param _userId - Unused
 * @returns Markdown response with documented code
 */
async function executeDocSkill(input: string, _userId: string): Promise<string> {
  log.info("doc skill invoked", { input: input.slice(0, 80) })

  // 1. Try inline code block first
  const inlineCode = extractCodeBlock(input)
  if (inlineCode) {
    return codeAgent.generateDocs({ code: inlineCode })
  }

  // 2. Try file path
  const filePath = extractFilePath(input)
  if (filePath) {
    let code: string
    try {
      code = await readFile(filePath, "utf8")
    } catch {
      return `Doc skill: Could not read file \`${filePath}\`. Is the path relative to the working directory?`
    }
    const result = await codeAgent.generateDocs({ code })
    return `**Documented \`${filePath}\`:**\n\n${result}`
  }

  return `Doc skill: Please either paste code in a code block (\`\`\`...\`\`\`) or specify a file path, e.g.:
_"Generate docs for src/memory/store.ts"_`
}

/** EDITH skill for generating JSDoc/TSDoc documentation. */
export const docSkill: Skill = {
  name: "docs",
  description:
    "Generate JSDoc/TSDoc documentation for TypeScript or JavaScript code. Accepts inline code blocks or file paths.",
  trigger: DOC_TRIGGER,
  execute: executeDocSkill,
}
