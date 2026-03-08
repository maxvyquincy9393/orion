/**
 * @file test-skill.ts
 * @description EDITH skill for generating Vitest unit tests from source code.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements the Skill interface from src/skills/manager.ts.
 *   Delegates to codeAgent.generateTests() (src/agents/code-agent.ts).
 *   Accepts code pasted in the message or a file path.
 *
 *   Register via skillManager.register(testSkill) in src/core/startup.ts.
 */

import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { createLogger } from "../logger.js"
import { codeAgent } from "../agents/code-agent.js"
import type { Skill } from "./manager.js"

const log = createLogger("skills.test")

/** Trigger pattern for test-generation requests. */
const TEST_TRIGGER =
  /\b(?:generate|write|create|scaffold)\s+(?:unit\s+)?tests?\b|\btest\s+(?:this|the|my)\s+(?:code|file|function|class|module)\b|\bvitest\b.*\bgenerate\b|\bgenerate\b.*\bvitest\b/i

/**
 * Extracts a file path from the user message.
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
 * Extracts an inline code block from the user message.
 * @param input - Raw user message
 * @returns Code string or null
 */
function extractCodeBlock(input: string): string | null {
  const match = input.match(/```[\w]*\n([\s\S]+?)```/)
  return match?.[1]?.trim() ?? null
}

/**
 * Derives a conventional test file path from the source file path.
 * e.g. `src/memory/store.ts` → `src/memory/__tests__/store.test.ts`
 * @param filePath - Source file path
 * @returns Test file import path string
 */
function deriveTestImportPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath))
  // relative import from the __tests__ sibling directory
  return `../${base}.js`
}

/**
 * Routes test generation requests to the CodeAgent.
 * @param input - User message
 * @param _userId - Unused
 * @returns Generated Vitest test file content in a Markdown code block
 */
async function executeTestSkill(input: string, _userId: string): Promise<string> {
  log.info("test skill invoked", { input: input.slice(0, 80) })

  // 1. Inline code block
  const inlineCode = extractCodeBlock(input)
  if (inlineCode) {
    const result = await codeAgent.generateTests({
      code: inlineCode,
      filePath: "../module.js",
    })
    return result
  }

  // 2. File path
  const filePath = extractFilePath(input)
  if (filePath) {
    let code: string
    try {
      code = await readFile(filePath, "utf8")
    } catch {
      return `Test skill: Could not read file \`${filePath}\`. Is the path relative to the working directory?`
    }
    const importPath = deriveTestImportPath(filePath)
    const result = await codeAgent.generateTests({ code, filePath: importPath })
    return `**Generated tests for \`${filePath}\`:**\n\n${result}`
  }

  return `Test skill: Please either paste code in a code block (\`\`\`...\`\`\`) or specify a file path, e.g.:
_"Generate tests for src/memory/store.ts"_`
}

/** EDITH skill for generating Vitest unit tests. */
export const testSkill: Skill = {
  name: "test-gen",
  description:
    "Generate Vitest unit tests for TypeScript or JavaScript code. Accepts inline code blocks or file paths.",
  trigger: TEST_TRIGGER,
  execute: executeTestSkill,
}
