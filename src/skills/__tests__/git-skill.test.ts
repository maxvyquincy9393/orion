/**
 * @file git-skill.test.ts
 * @description Unit tests for git-skill.ts — mock execFileAsync and orchestrator
 *              so tests never touch disk or make LLM calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}))

vi.mock("node:util", () => ({
  promisify:
    (fn: unknown) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        // @ts-expect-error dynamic mock call
        fn(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err)
          else resolve(result)
        })
      }),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn().mockResolvedValue("mock LLM response"),
  },
}))

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process"
import { orchestrator } from "../../engines/orchestrator.js"
import {
  suggestCommitMessage,
  reviewStagedDiff,
  recentLog,
  gitSkill,
} from "../git-skill.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type the mock so we can call .mockImplementation */
const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>
const mockGenerate = orchestrator.generate as ReturnType<typeof vi.fn>

/**
 * Sets execFile to resolve with the given stdout for the following git invocation.
 * Multiple calls must be queued in order.
 */
function mockGitOutput(...outputs: (string | Error)[]): void {
  let callIdx = 0
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result?: { stdout: string }) => void) => {
      const output = outputs[callIdx++] ?? ""
      if (output instanceof Error) {
        cb(output)
      } else {
        cb(null, { stdout: output })
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("suggestCommitMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("feat(memory): add user preference engine")
  })

  it("returns LLM response for a non-empty staged diff", async () => {
    mockGitOutput(
      "diff --git a/src/foo.ts b/src/foo.ts\n+added line", // git diff --staged
      "feature/my-branch", // git rev-parse
    )

    const result = await suggestCommitMessage("/fake/repo")
    expect(result).toBe("feat(memory): add user preference engine")
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("feature/my-branch") }),
    )
  })

  it("returns early message when no staged diff", async () => {
    mockGitOutput(
      "", // empty diff
    )
    const result = await suggestCommitMessage("/fake/repo")
    expect(result).toBe("No staged changes to summarise.")
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})

describe("reviewStagedDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("APPROVE — clean change")
  })

  it("returns review for non-empty staged diff", async () => {
    mockGitOutput("diff --git a/src/a.ts b/src/a.ts\n+line")
    const result = await reviewStagedDiff("/fake/repo")
    expect(result).toBe("APPROVE — clean change")
  })

  it("returns early message when no staged diff", async () => {
    mockGitOutput("")
    const result = await reviewStagedDiff("/fake/repo")
    expect(result).toBe("No staged changes to review.")
  })
})

describe("recentLog", () => {
  it("returns git log output", async () => {
    mockGitOutput("abc123 feat: add thing\ndef456 fix: fix bug")
    const result = await recentLog("/fake/repo", 5)
    expect(result).toContain("feat: add thing")
  })
})

describe("gitSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("mock response")
  })

  it("has correct name and trigger", () => {
    expect(gitSkill.name).toBe("git")
    expect(gitSkill.trigger).toBeDefined()
    expect(gitSkill.trigger!.test("suggest commit message")).toBe(true)
    expect(gitSkill.trigger!.test("PR summary")).toBe(true)
    expect(gitSkill.trigger!.test("review staged diff")).toBe(true)
    expect(gitSkill.trigger!.test("recent commits")).toBe(true)
  })

  it("routes 'commit message' to suggestCommitMessage", async () => {
    mockGitOutput("diff --git a/src/x.ts b/src/x.ts\n+x", "main")
    const resp = await gitSkill.execute!("suggest commit message for my staged changes", "u1")
    expect(resp).toContain("Suggested commit message")
  })

  it("handles git error gracefully", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        cb(new Error("not a git repository"))
      },
    )
    const resp = await gitSkill.execute!("suggest commit message", "u1")
    expect(resp).toContain("Git error:")
    expect(resp).toContain("not a git repository")
  })
})
