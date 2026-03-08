/**
 * @file git-skill.ts
 * @description EDITH skill for Git operations: commit message generation,
 *              PR summaries, staged diff review, and branch log summaries.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Implements the Skill interface from src/skills/manager.ts.
 *   Executes git commands via node:child_process with a configurable cwd
 *   (defaults to process.cwd()). LLM calls are routed through orchestrator
 *   using the 'code' task type for code-aware models.
 *
 *   Register via skillManager.register(gitSkill) in src/core/startup.ts.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import type { Skill } from "./manager.js"
import {
  COMMIT_SYSTEM_PROMPT,
  PR_SUMMARY_SYSTEM_PROMPT,
  CODE_REVIEW_SYSTEM_PROMPT,
  buildCommitPrompt,
  buildPrSummaryPrompt,
  buildCodeReviewPrompt,
} from "./git-prompts.js"

const log = createLogger("skills.git")
const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Runs a git sub-command in the specified directory.
 * @param args - git arguments (e.g. ["diff", "--staged"])
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns stdout string
 */
async function git(args: string[], cwd: string = process.cwd()): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * Returns the current branch name, or "HEAD" on detached HEAD.
 * @param cwd - Repository root
 */
async function currentBranch(cwd: string): Promise<string> {
  try {
    return await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
  } catch {
    return "HEAD"
  }
}

/**
 * Resolves the default base branch (main → master → first remote branch).
 * @param cwd - Repository root
 */
async function baseBranch(cwd: string): Promise<string> {
  for (const name of ["main", "master", "develop"]) {
    try {
      await git(["rev-parse", "--verify", name], cwd)
      return name
    } catch {
      // not found, try next
    }
  }
  return "main"
}

// ---------------------------------------------------------------------------
// Core operations (exported for direct use + testing)
// ---------------------------------------------------------------------------

/**
 * Generates a Conventional Commits message for the current staged diff.
 * @param cwd - Repository root
 * @returns Commit message string
 */
export async function suggestCommitMessage(cwd: string = process.cwd()): Promise<string> {
  const diff = await git(["diff", "--staged"], cwd)
  if (!diff) return "No staged changes to summarise."
  const branch = await currentBranch(cwd)
  const prompt = buildCommitPrompt(diff, branch)
  return orchestrator.generate("code", { prompt, systemPrompt: COMMIT_SYSTEM_PROMPT })
}

/**
 * Summarises the current branch as a PR description.
 * @param cwd - Repository root
 * @param base - Base branch to diff against (auto-detected if omitted)
 * @returns PR description in Markdown
 */
export async function summarisePR(cwd: string = process.cwd(), base?: string): Promise<string> {
  const branch = await currentBranch(cwd)
  const resolvedBase = base ?? (await baseBranch(cwd))
  const [diff, log] = await Promise.all([
    git(["diff", `${resolvedBase}...${branch}`], cwd),
    git(["log", `${resolvedBase}...${branch}`, "--oneline"], cwd),
  ])
  if (!diff) return "No changes between this branch and base."
  const prompt = buildPrSummaryPrompt(diff, log, branch, resolvedBase)
  return orchestrator.generate("code", { prompt, systemPrompt: PR_SUMMARY_SYSTEM_PROMPT })
}

/**
 * Reviews the staged diff and returns a structured code review.
 * @param cwd - Repository root
 * @returns Markdown code review
 */
export async function reviewStagedDiff(cwd: string = process.cwd()): Promise<string> {
  const diff = await git(["diff", "--staged"], cwd)
  if (!diff) return "No staged changes to review."
  const prompt = buildCodeReviewPrompt(diff)
  return orchestrator.generate("code", { prompt, systemPrompt: CODE_REVIEW_SYSTEM_PROMPT })
}

/**
 * Returns the last N commits for a branch as a formatted log string.
 * @param cwd - Repository root
 * @param n - Number of commits to show (default 10)
 * @returns Formatted git log
 */
export async function recentLog(cwd: string = process.cwd(), n = 10): Promise<string> {
  return git(
    ["log", `--max-count=${n}`, "--oneline", "--decorate", "--color=never"],
    cwd,
  )
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

/** Intent patterns handled by this skill. */
const GIT_TRIGGER =
  /\b(?:git\s+)?(?:commit\s+message|pr\s+(?:summary|description|review)|pull.request|code\s+review|review\s+(?:staged|diff|changes)|staged\s+diff|recent\s+commits?|git\s+log|suggest\s+commit)\b/i

/**
 * Routes a natural-language git request to the appropriate git operation.
 * @param input - User message
 * @param _userId - Not used (git operations are repo-scoped, not user-scoped)
 * @returns Formatted markdown response
 */
async function executeGitSkill(input: string, _userId: string): Promise<string> {
  const lower = input.toLowerCase()
  const cwd = process.cwd()

  try {
    if (/commit\s*message|suggest.*commit/i.test(lower)) {
      const msg = await suggestCommitMessage(cwd)
      return `**Suggested commit message:**\n\n\`\`\`\n${msg}\n\`\`\``
    }

    if (/pr\s+(?:summary|description)|pull.request|summaris(e|e)\s+pr/i.test(lower)) {
      return summarisePR(cwd)
    }

    if (/code\s+review|review\s+(?:staged|diff|changes)|staged\s+diff/i.test(lower)) {
      return reviewStagedDiff(cwd)
    }

    if (/recent\s+commits?|git\s+log/i.test(lower)) {
      const logOutput = await recentLog(cwd)
      return `**Recent commits:**\n\n\`\`\`\n${logOutput || "No commits found."}\n\`\`\``
    }

    if (/pr\s+review/i.test(lower)) {
      return summarisePR(cwd)
    }

    return "Git skill: I can suggest commit messages, summarise PRs, review staged diffs, and show recent commit logs. What would you like?"
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn("git skill error", { input: input.slice(0, 80), err })
    return `Git error: ${msg}`
  }
}

/** EDITH skill for Git awareness and commit/PR assistance. */
export const gitSkill: Skill = {
  name: "git",
  description:
    "Git operations: suggest commit messages, create PR summaries, review staged diffs, show recent commit log.",
  trigger: GIT_TRIGGER,
  execute: executeGitSkill,
}
