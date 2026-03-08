/**
 * @file code-agent.ts
 * @description SWE-agent style CodeAgent for autonomous code understanding, bug fixing,
 *              refactoring, explanation, test generation, and documentation.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Follows the SWE-agent (Yang et al., 2024) locate→understand→plan→patch→verify loop.
 *   Uses orchestrator.generate('code', ...) for all LLM calls.
 *   Exposes a `codeAgent` singleton and named methods used by doc-skill, test-skill,
 *   git-skill, and the VS Code extension's gateway request handlers.
 *
 * PAPER BASIS:
 *   - SWE-agent: arXiv:2405.15793 — agent-computer interface for autonomous patch generation
 */

import { readFile } from "node:fs/promises"
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import {
  BUG_FIX_SYSTEM_PROMPT,
  EXPLAIN_SYSTEM_PROMPT,
  REFACTOR_SYSTEM_PROMPT,
  TEST_GEN_SYSTEM_PROMPT,
  DOC_GEN_SYSTEM_PROMPT,
  buildBugFixPrompt,
  buildExplainPrompt,
  buildRefactorPrompt,
  buildTestGenPrompt,
  buildDocGenPrompt,
} from "./code-agent-prompts.js"

const log = createLogger("agents.code")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for a bug-fix request. */
export interface BugFixRequest {
  /** Issue description or reproduction steps. */
  issue: string
  /** Array of file paths whose content should be included as context. */
  contextFiles?: string[]
  /** Pre-provided file contents (path → content). Avoids re-reading disk. */
  inlineContext?: Record<string, string>
}

/** Options for a code-explanation request. */
export interface ExplainRequest {
  /** Source code to explain. */
  code: string
  /** Programming language (default: "typescript"). */
  language?: string
}

/** Options for a refactor request. */
export interface RefactorRequest {
  /** Source code to refactor. */
  code: string
  /** Refactoring objective, e.g. "reduce complexity", "extract pure helpers". */
  goal: string
  /** Programming language (default: "typescript"). */
  language?: string
}

/** Options for test generation. */
export interface TestGenRequest {
  /** Source code to test. */
  code: string
  /** Relative import path for the generated test file. */
  filePath: string
  /** Programming language (default: "typescript"). */
  language?: string
}

/** Options for documentation generation. */
export interface DocGenRequest {
  /** Source code to document. */
  code: string
  /** Programming language (default: "typescript"). */
  language?: string
}

// ---------------------------------------------------------------------------
// CodeAgent
// ---------------------------------------------------------------------------

/**
 * Autonomous code-intelligence agent powering EDITH's developer assistant features.
 * All methods are async and return Markdown-formatted strings ready to surface in
 * the VS Code sidebar, CLI, or any channel.
 */
export class CodeAgent {
  /**
   * Attempts to fix a bug described in `request.issue`.
   * Reads optional context files from disk (path list in `request.contextFiles`).
   * @param request - Bug fix options
   * @returns Markdown response with root cause analysis and proposed patch
   */
  async bugFix(request: BugFixRequest): Promise<string> {
    log.info("code agent: bug fix requested", { issue: request.issue.slice(0, 80) })

    const codebase: Record<string, string> = { ...(request.inlineContext ?? {}) }

    if (request.contextFiles?.length) {
      await Promise.all(
        request.contextFiles.map(async filePath => {
          try {
            codebase[filePath] = await readFile(filePath, "utf8")
          } catch (err) {
            log.warn("could not read context file", { filePath, err })
          }
        }),
      )
    }

    const prompt = buildBugFixPrompt(request.issue, codebase)
    return orchestrator.generate("code", { prompt, systemPrompt: BUG_FIX_SYSTEM_PROMPT })
  }

  /**
   * Explains a code snippet in plain English.
   * @param request - Explanation options
   * @returns Markdown explanation
   */
  async explain(request: ExplainRequest): Promise<string> {
    log.debug("code agent: explain requested")
    const prompt = buildExplainPrompt(request.code, request.language ?? "typescript")
    return orchestrator.generate("code", { prompt, systemPrompt: EXPLAIN_SYSTEM_PROMPT })
  }

  /**
   * Refactors code toward a stated goal without altering external behaviour.
   * @param request - Refactor options
   * @returns Markdown with refactored code + change summary
   */
  async refactor(request: RefactorRequest): Promise<string> {
    log.debug("code agent: refactor requested", { goal: request.goal })
    const prompt = buildRefactorPrompt(request.code, request.goal, request.language ?? "typescript")
    return orchestrator.generate("code", { prompt, systemPrompt: REFACTOR_SYSTEM_PROMPT })
  }

  /**
   * Generates Vitest unit tests for a given source module.
   * @param request - Test generation options
   * @returns Generated test file content as a Markdown code block
   */
  async generateTests(request: TestGenRequest): Promise<string> {
    log.debug("code agent: test generation requested", { filePath: request.filePath })
    const prompt = buildTestGenPrompt(
      request.code,
      request.filePath,
      request.language ?? "typescript",
    )
    return orchestrator.generate("code", { prompt, systemPrompt: TEST_GEN_SYSTEM_PROMPT })
  }

  /**
   * Adds JSDoc/TSDoc documentation to source code.
   * @param request - Doc generation options
   * @returns Source file with documentation added
   */
  async generateDocs(request: DocGenRequest): Promise<string> {
    log.debug("code agent: doc generation requested")
    const prompt = buildDocGenPrompt(request.code, request.language ?? "typescript")
    return orchestrator.generate("code", { prompt, systemPrompt: DOC_GEN_SYSTEM_PROMPT })
  }
}

/** Singleton CodeAgent instance. */
export const codeAgent = new CodeAgent()
