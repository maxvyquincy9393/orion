/**
 * @file git-prompts.ts
 * @description LLM prompt templates for Git-related EDITH skills.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Imported by git-skill.ts. Prompts are parameterised with runtime values
 *   (diff text, log entries, branch names) and passed to orchestrator.generate().
 */

// ---------------------------------------------------------------------------
// Commit message
// ---------------------------------------------------------------------------

/** System instructions for generating conventional commit messages. */
export const COMMIT_SYSTEM_PROMPT = `You are an expert software engineer writing Git commit messages.
Follow the Conventional Commits specification (https://www.conventionalcommits.org/).
Format: <type>(<scope>): <short imperative description>

Types: feat | fix | docs | style | refactor | perf | test | chore | ci | build | revert
Rules:
- Subject line max 72 characters, no period at end
- Use imperative mood: "add" not "added", "fix" not "fixed"
- Scope is optional but helpful (e.g. memory, voice, channels)
- If the change is breaking, append "!" after type/scope
- If changes span multiple concerns, list them in the body (blank line after subject)
- Return ONLY the commit message, nothing else.`

/**
 * Builds the user-turn prompt for commit message generation.
 * @param diff - Output of `git diff --staged`
 * @param branch - Current branch name
 * @returns Formatted prompt string
 */
export function buildCommitPrompt(diff: string, branch: string): string {
  const truncatedDiff = diff.length > 8_000 ? diff.slice(0, 8_000) + "\n…[truncated]" : diff
  return `Branch: ${branch}

Staged diff:
\`\`\`diff
${truncatedDiff}
\`\`\`

Write a Conventional Commits message for this change.`
}

// ---------------------------------------------------------------------------
// PR summary / review
// ---------------------------------------------------------------------------

/** System instructions for generating a PR summary. */
export const PR_SUMMARY_SYSTEM_PROMPT = `You are an expert code reviewer preparing a pull request description.
Structure your response as:
## Summary
One paragraph describing the purpose of this PR.

## Changes
Bullet list of what was changed and why.

## Testing
Notes on how the change was tested or how reviewers should verify it.

Be concise. Do not pad. Return Markdown.`

/**
 * Builds the prompt for PR summary generation.
 * @param diff - Full git diff of the branch vs base
 * @param log - Commit log messages in the branch
 * @param branch - Feature branch name
 * @param base - Base branch name
 * @returns Formatted prompt string
 */
export function buildPrSummaryPrompt(
  diff: string,
  log: string,
  branch: string,
  base: string,
): string {
  const truncatedDiff = diff.length > 12_000 ? diff.slice(0, 12_000) + "\n…[truncated]" : diff
  return `Branch: ${branch} → ${base}

Commit log:
${log}

Diff:
\`\`\`diff
${truncatedDiff}
\`\`\`

Write a PR description for this branch.`
}

// ---------------------------------------------------------------------------
// Code review
// ---------------------------------------------------------------------------

/** System instructions for code review. */
export const CODE_REVIEW_SYSTEM_PROMPT = `You are a thorough senior engineer performing a code review.
Focus on:
1. Correctness (logic errors, off-by-one, null/undefined safety)
2. Security (injection, insecure deserialization, hardcoded secrets)
3. Performance (unnecessary allocations, missing indexes, N+1 queries)
4. Readability (naming, complexity, missing documentation)
5. Test coverage gaps

Format your response as Markdown with a section per concern.
For each finding, cite the relevant line or function.
End with an overall recommendation: APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION.`

/**
 * Builds a code review prompt for a diff.
 * @param diff - Git diff to review
 * @param context - Optionally the full file context for deeper review
 * @returns Formatted prompt string
 */
export function buildCodeReviewPrompt(diff: string, context?: string): string {
  const truncatedDiff = diff.length > 10_000 ? diff.slice(0, 10_000) + "\n…[truncated]" : diff
  const contextSection = context
    ? `\nFull file context (for reference):\n\`\`\`\n${context.slice(0, 4_000)}\n\`\`\`\n`
    : ""
  return `${contextSection}
Diff to review:
\`\`\`diff
${truncatedDiff}
\`\`\`

Perform a thorough code review.`
}
