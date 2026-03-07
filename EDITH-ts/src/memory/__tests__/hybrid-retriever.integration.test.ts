import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../database/index.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { prisma } from "../../database/index.js"
import { HybridRetriever } from "../hybrid-retriever.js"

describe("HybridRetriever integration (mocked Prisma FTS)", () => {
  const prismaMock = prisma as unknown as {
    $queryRaw: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$queryRaw.mockResolvedValue([
      { id: "m1", content: "Go build cache issue", rank: 0.12 },
      { id: "m2", content: "TypeScript io parsing", rank: 0.3 },
    ])
  })

  it("passes raw userId to FTS query and keeps short technical tokens in MATCH query", async () => {
    const retriever = new HybridRetriever({ topK: 5 })

    const results = await (retriever as unknown as {
      searchFTS(userId: string, query: string): Promise<Array<{ id: string; rank: number }>>
    }).searchFTS("user/dev+1", "Go js ts io parsing")

    expect(results).toHaveLength(2)
    expect(results[0]?.id).toBe("m1")

    const callArgs = prismaMock.$queryRaw.mock.calls[0] ?? []
    expect(callArgs[1]).toBe("user/dev+1")
    expect(String(callArgs[2])).toContain("go*")
    expect(String(callArgs[2])).toContain("js*")
    expect(String(callArgs[2])).toContain("ts*")
    expect(String(callArgs[2])).toContain("io*")
  })
})
