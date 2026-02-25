import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../database/index.js", () => ({
  prisma: {
    causalNode: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    causalEdge: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    hyperEdge: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    hyperEdgeMembership: {
      createMany: vi.fn(),
    },
  },
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
  },
}))

vi.mock("../temporal-index.js", () => ({
  detectQueryComplexity: vi.fn(() => "simple"),
  temporalIndex: {
    retrieve: vi.fn(async () => []),
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
import { orchestrator } from "../../engines/orchestrator.js"
import { computeHyperEdgeMemberSetHash, normalizeCausalEventKey } from "../causal-graph-dedupe-utils.js"
import { CausalGraph } from "../causal-graph.js"

type MockFn<T extends (...args: any[]) => any> = ReturnType<typeof vi.fn<T>>

describe("CausalGraph integration (mocked)", () => {
  const prismaMock = prisma as unknown as {
    causalNode: {
      findMany: MockFn<any>
      create: MockFn<any>
    }
    hyperEdge: {
      findMany: MockFn<any>
      create: MockFn<any>
      update: MockFn<any>
    }
    hyperEdgeMembership: {
      createMany: MockFn<any>
    }
  }

  const orchestratorMock = orchestrator as unknown as {
    generate: MockFn<any>
  }

  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.causalNode.findMany.mockResolvedValue([])
    prismaMock.causalNode.create
      .mockResolvedValueOnce({ id: "node-a" })
      .mockResolvedValueOnce({ id: "node-b" })
      .mockResolvedValue({ id: "node-x" })

    prismaMock.hyperEdge.findMany.mockResolvedValue([])
    prismaMock.hyperEdge.create.mockResolvedValue({ id: "hyper-1", weight: 0.5 })
    prismaMock.hyperEdge.update.mockResolvedValue({ id: "hyper-1", weight: 0.9 })
    prismaMock.hyperEdgeMembership.createMany.mockResolvedValue({ count: 2 })
  })

  it("extractAndUpdate persists parsed hyperedge weight and dedupes repeated hyperedges in one response", async () => {
    const graph = new CausalGraph()
    prismaMock.causalNode.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "node-a", event: "Late sleep", eventKey: "late sleep", createdAt: new Date() },
        { id: "node-b", event: "Missed meeting", eventKey: "missed meeting", createdAt: new Date() },
      ])

    orchestratorMock.generate.mockResolvedValueOnce(`
\`\`\`json
{
  "events": [],
  "causes": [],
  "hyperEdges": [
    { "nodes": ["Late sleep", "Missed meeting"], "relation": "routine", "context": "weekday", "weight": 0.9 },
    { "nodes": ["Missed meeting", "Late sleep"], "relation": "routine", "context": "duplicate", "weight": 0.4 }
  ]
}
\`\`\`
`)

    await graph.extractAndUpdate("user-1", "I slept late and missed a meeting this morning.")

    expect(prismaMock.causalNode.create).toHaveBeenCalledTimes(2)
    const createdNodeCalls = prismaMock.causalNode.create.mock.calls.map((call) => call[0] as { data?: Record<string, unknown> })
    expect(createdNodeCalls[0]?.data).toMatchObject({
      event: "Late sleep",
      eventKey: normalizeCausalEventKey("Late sleep"),
    })
    expect(createdNodeCalls[1]?.data).toMatchObject({
      event: "Missed meeting",
      eventKey: normalizeCausalEventKey("Missed meeting"),
    })

    expect(prismaMock.hyperEdge.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.hyperEdge.create.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined
    expect(createCall?.data).toMatchObject({
      userId: "user-1",
      relation: "routine",
      weight: 0.9,
      memberSetHash: computeHyperEdgeMemberSetHash("routine", ["node-a", "node-b"]),
    })
    expect(prismaMock.hyperEdgeMembership.createMany).toHaveBeenCalledTimes(1)
  })

  it("addHyperEdge updates an existing matching hyperedge instead of creating duplicates", async () => {
    const graph = new CausalGraph()

    prismaMock.causalNode.findMany.mockResolvedValueOnce([
      { id: "node-a", event: "Late sleep", createdAt: new Date() },
      { id: "node-b", event: "Missed meeting", createdAt: new Date() },
    ])
    prismaMock.hyperEdge.findMany.mockResolvedValueOnce([
      {
        id: "hyper-existing",
        weight: 0.4,
        members: [{ nodeId: "node-b" }, { nodeId: "node-a" }],
      },
    ])

    await graph.addHyperEdge("user-1", ["Late sleep", "Missed meeting"], "routine", "weekday", 0.8)

    expect(prismaMock.hyperEdge.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.hyperEdge.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "hyper-existing" },
      data: {
        weight: 0.8,
        context: "weekday",
        memberSetHash: computeHyperEdgeMemberSetHash("routine", ["node-a", "node-b"]),
      },
    })
    expect(prismaMock.hyperEdge.create).not.toHaveBeenCalled()
  })
})
