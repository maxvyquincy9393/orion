/**
 * @file code-agent.test.ts
 * @description Unit tests for CodeAgent — mock orchestrator and fs/promises
 *              so no disk I/O or LLM calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
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

import { readFile } from "node:fs/promises"
import { orchestrator } from "../../engines/orchestrator.js"
import { CodeAgent } from "../code-agent.js"

const mockReadFile = readFile as ReturnType<typeof vi.fn>
const mockGenerate = orchestrator.generate as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodeAgent.explain", () => {
  let agent: CodeAgent

  beforeEach(() => {
    agent = new CodeAgent()
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("This function sorts an array using bubble sort.")
  })

  it("calls orchestrator.generate with code task type", async () => {
    const result = await agent.explain({ code: "function foo() {}", language: "typescript" })
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("function foo()") }),
    )
    expect(result).toBe("This function sorts an array using bubble sort.")
  })

  it("defaults language to typescript if not provided", async () => {
    await agent.explain({ code: "const x = 1" })
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("typescript") }),
    )
  })
})

describe("CodeAgent.refactor", () => {
  let agent: CodeAgent

  beforeEach(() => {
    agent = new CodeAgent()
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("```typescript\nconst extracted = () => {...}\n```\n## Changes\n- extracted helper")
  })

  it("includes goal in the prompt", async () => {
    await agent.refactor({ code: "const x = 1+1; const y = 1+1;", goal: "extract repeated logic" })
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("extract repeated logic") }),
    )
  })
})

describe("CodeAgent.generateTests", () => {
  let agent: CodeAgent

  beforeEach(() => {
    agent = new CodeAgent()
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("import { describe, it } from 'vitest'\ndescribe('foo', () => {})")
  })

  it("includes filePath in prompt", async () => {
    await agent.generateTests({ code: "export function add(a,b){return a+b}", filePath: "../math.js" })
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("../math.js") }),
    )
  })
})

describe("CodeAgent.generateDocs", () => {
  let agent: CodeAgent

  beforeEach(() => {
    agent = new CodeAgent()
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("/** documented */\nfunction foo() {}")
  })

  it("returns documented code from orchestrator", async () => {
    const result = await agent.generateDocs({ code: "function foo() {}" })
    expect(result).toContain("documented")
  })
})

describe("CodeAgent.bugFix", () => {
  let agent: CodeAgent

  beforeEach(() => {
    agent = new CodeAgent()
    vi.clearAllMocks()
    mockGenerate.mockResolvedValue("## Root cause\nOff-by-one error.\n\n## Patch\n```diff\n-i < n\n+i <= n\n```")
  })

  it("includes issue text in prompt", async () => {
    await agent.bugFix({ issue: "Array out of bounds when input is empty" })
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("Array out of bounds") }),
    )
  })

  it("reads context files from disk", async () => {
    mockReadFile.mockResolvedValue("export function process(arr: number[]) { return arr[0] }")
    await agent.bugFix({
      issue: "crashes on empty array",
      contextFiles: ["src/utils/process.ts"],
    })
    expect(mockReadFile).toHaveBeenCalledWith("src/utils/process.ts", "utf8")
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("src/utils/process.ts") }),
    )
  })

  it("gracefully skips unreadable context files", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"))
    const result = await agent.bugFix({
      issue: "some bug",
      contextFiles: ["nonexistent.ts"],
    })
    // Should still produce a response (file read failure is non-fatal)
    expect(mockGenerate).toHaveBeenCalled()
    expect(result).toBeTruthy()
  })

  it("uses inlineContext without reading disk", async () => {
    await agent.bugFix({
      issue: "bug in helper",
      inlineContext: { "src/helper.ts": "export function helper() { throw new Error() }" },
    })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockGenerate).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ prompt: expect.stringContaining("src/helper.ts") }),
    )
  })
})
