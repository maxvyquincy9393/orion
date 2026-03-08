/**
 * @file code-agent-prompts.ts
 * @description LLM prompt templates for the CodeAgent SWE-agent implementation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Imported by code-agent.ts. All prompts follow a locate→understand→plan→patch→verify
 *   cycle matching the SWE-agent paper (Yang et al., 2024 arXiv:2405.15793).
 *
 * PAPER BASIS:
 *   - SWE-agent: arXiv:2405.15793 — agent-computer interface for autonomous patch generation
 */

// ---------------------------------------------------------------------------
// Bug fix
// ---------------------------------------------------------------------------

/** System prompt for the bug-fix agent. */
export const BUG_FIX_SYSTEM_PROMPT = `You are SWE-EDITH, an autonomous software engineering agent.
Your goal is to reproduce, localise, and fix a reported bug.

Follow this structured process:
1. LOCATE — Identify the relevant files, functions, and lines from the issue description.
2. UNDERSTAND — Explain the root cause in one paragraph.
3. PLAN — List the minimal surgical changes needed to fix the bug without side-effects.
4. PATCH — Output the final fix as a unified diff or clearly marked code blocks.
5. VERIFY — Describe how to verify the fix (test command, expected output).

Rules:
- Prefer the smallest change that fully fixes the bug.
- Do NOT refactor unrelated code.
- If you need more context, explicitly list what file/function you need to read.
- All code must be syntactically correct TypeScript (or match the project language).
- Output Markdown.`

/**
 * Builds the bug-fix prompt.
 * @param issue - Bug description or issue text
 * @param codebase - Relevant file contents (path: content pairs)
 * @returns Formatted prompt string
 */
export function buildBugFixPrompt(issue: string, codebase: Record<string, string>): string {
  const filesSection = Object.entries(codebase)
    .map(([filePath, content]) => {
      const truncated = content.length > 4_000 ? content.slice(0, 4_000) + "\n…[truncated]" : content
      return `### ${filePath}\n\`\`\`typescript\n${truncated}\n\`\`\``
    })
    .join("\n\n")

  return `## Bug Report
${issue}

## Relevant Code
${filesSection || "_No code provided._"}

Analyse the bug and produce a patch.`
}

// ---------------------------------------------------------------------------
// Code explanation
// ---------------------------------------------------------------------------

/** System prompt for code explanation. */
export const EXPLAIN_SYSTEM_PROMPT = `You are an expert software engineer. Explain the provided code clearly and concisely.
Structure your explanation as:
1. **Summary** — What does this code do? (1–2 sentences)
2. **How it works** — Step-by-step walkthrough of the key logic.
3. **Key design decisions** — Non-obvious choices and their rationale.
4. **Potential issues** — Edge cases, performance risks, or fragile assumptions.

Use plain English. Avoid over-explaining obvious things. Target audience: mid-level engineer.
Output Markdown.`

/**
 * Builds the code explanation prompt.
 * @param code - Source code to explain
 * @param language - Programming language name
 * @returns Formatted prompt string
 */
export function buildExplainPrompt(code: string, language = "typescript"): string {
  const truncated = code.length > 10_000 ? code.slice(0, 10_000) + "\n…[truncated]" : code
  return `Explain this ${language} code:

\`\`\`${language}
${truncated}
\`\`\``
}

// ---------------------------------------------------------------------------
// Refactoring
// ---------------------------------------------------------------------------

/** System prompt for code refactoring. */
export const REFACTOR_SYSTEM_PROMPT = `You are a senior software engineer specialising in clean, maintainable code.
Refactor the provided code according to the stated goal.

Rules:
- Preserve exact external behaviour (same inputs → same outputs).
- Do NOT add features or change APIs unless explicitly requested.
- Show the full refactored version (not just the diff) unless input is large.
- Briefly explain each significant change in a "## Changes" section after the code.
- Output Markdown with a code block followed by the changes section.`

/**
 * Builds the refactoring prompt.
 * @param code - Source code to refactor
 * @param goal - Refactoring objective, e.g. "extract repeated logic into helpers"
 * @param language - Programming language name
 * @returns Formatted prompt string
 */
export function buildRefactorPrompt(code: string, goal: string, language = "typescript"): string {
  const truncated = code.length > 10_000 ? code.slice(0, 10_000) + "\n…[truncated]" : code
  return `Refactoring goal: ${goal}

\`\`\`${language}
${truncated}
\`\`\`

Apply the refactoring and explain what you changed.`
}

// ---------------------------------------------------------------------------
// Test generation (reused by test-skill)
// ---------------------------------------------------------------------------

/** System prompt for automated test generation. */
export const TEST_GEN_SYSTEM_PROMPT = `You are an expert TypeScript engineer writing Vitest unit tests.
Rules:
- Use describe/it/expect blocks.
- Mock external dependencies with vi.mock() or vi.fn().
- Follow the arrange → act → assert pattern with comments.
- Cover: happy path, edge cases (empty, null, boundary), error paths.
- Do NOT import the actual module under test with a hard path — use the path provided.
- Return ONLY the test file content, no explanation.`

/**
 * Builds the test generation prompt.
 * @param code - Source code to generate tests for
 * @param filePath - Relative file path (used in the import statement)
 * @param language - Programming language
 * @returns Formatted prompt string
 */
export function buildTestGenPrompt(code: string, filePath: string, language = "typescript"): string {
  const truncated = code.length > 8_000 ? code.slice(0, 8_000) + "\n…[truncated]" : code
  return `Generate Vitest unit tests for the following ${language} module.
Import path: \`${filePath}\`

\`\`\`${language}
${truncated}
\`\`\``
}

// ---------------------------------------------------------------------------
// Documentation generation (reused by doc-skill)
// ---------------------------------------------------------------------------

/** System prompt for documentation generation. */
export const DOC_GEN_SYSTEM_PROMPT = `You are a technical writer generating JSDoc/TSDoc documentation.
Rules:
- Add a file-level @file + @description block if missing.
- Add @param, @returns, @throws for every exported function/method.
- Add @example blocks where helpful.
- Do NOT change any logic — only add or improve documentation comments.
- Return the FULL file content with documentation added.
- Use the project's documentation style: /** ... */ blocks.`

/**
 * Builds the documentation generation prompt.
 * @param code - Source code to document
 * @param language - Programming language
 * @returns Formatted prompt string
 */
export function buildDocGenPrompt(code: string, language = "typescript"): string {
  const truncated = code.length > 10_000 ? code.slice(0, 10_000) + "\n…[truncated]" : code
  return `Add JSDoc/TSDoc documentation to this ${language} code:

\`\`\`${language}
${truncated}
\`\`\`

Return the full file with documentation added.`
}
