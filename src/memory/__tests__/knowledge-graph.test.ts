/**
 * @file knowledge-graph.test.ts
 * @description Unit tests for KnowledgeGraph entity extraction and BFS traversal.
 *
 * Phase 13 — HippoRAG-inspired knowledge graph.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// -------------------------------------------------------------------
// Mocks must be declared BEFORE dynamic imports of the module under test
// -------------------------------------------------------------------

vi.mock("../../database/index.js", () => ({
  prisma: {
    knowledgeEntity: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    knowledgeEdge: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    generate: vi.fn(),
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
import { KnowledgeGraph } from "../knowledge/knowledge-graph.js"

const mockPrisma = prisma as unknown as {
  knowledgeEntity: {
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
  knowledgeEdge: {
    upsert: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
}

const mockOrchestrator = orchestrator as unknown as {
  generate: ReturnType<typeof vi.fn>
}

describe("KnowledgeGraph", () => {
  let kg: KnowledgeGraph

  beforeEach(() => {
    vi.clearAllMocks()
    kg = new KnowledgeGraph()
  })

  // ------------------------------------------------------------------
  // extractFromChunk
  // ------------------------------------------------------------------
  describe("extractFromChunk", () => {
    it("saves extracted entities to DB", async () => {
      const chunkId = "chunk-1"
      const content = "TypeScript is used extensively in the project."
      const extraction = JSON.stringify({
        entities: [{ name: "TypeScript", type: "tool" }],
        edges: [],
      })
      mockOrchestrator.generate.mockResolvedValue(extraction)
      mockPrisma.knowledgeEntity.findUnique.mockResolvedValue(null)
      mockPrisma.knowledgeEntity.create.mockResolvedValue({ id: "ent-1" })

      await kg.extractFromChunk("user1", content, chunkId)

      expect(mockPrisma.knowledgeEntity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "TypeScript", type: "tool", userId: "user1" }),
        }),
      )
    })

    it("upserts edge between extracted entities", async () => {
      const chunkId = "chunk-2"
      const extraction = JSON.stringify({
        entities: [
          { name: "React", type: "tool" },
          { name: "TypeScript", type: "tool" },
        ],
        edges: [{ from: "React", to: "TypeScript", relation: "uses" }],
      })
      mockOrchestrator.generate.mockResolvedValue(extraction)
      mockPrisma.knowledgeEntity.findUnique.mockResolvedValue(null)
      mockPrisma.knowledgeEntity.create
        .mockResolvedValueOnce({ id: "ent-react" })
        .mockResolvedValueOnce({ id: "ent-ts" })
      mockPrisma.knowledgeEdge.upsert.mockResolvedValue({})

      await kg.extractFromChunk("user1", "React uses TypeScript.", chunkId)

      expect(mockPrisma.knowledgeEdge.upsert).toHaveBeenCalledOnce()
    })

    it("updates chunkIds on existing entity", async () => {
      const existing = { id: "ent-existing", chunkIds: ["old-chunk"] }
      mockOrchestrator.generate.mockResolvedValue(
        JSON.stringify({ entities: [{ name: "Node", type: "tool" }], edges: [] }),
      )
      mockPrisma.knowledgeEntity.findUnique.mockResolvedValue(existing)
      mockPrisma.knowledgeEntity.update.mockResolvedValue({})

      await kg.extractFromChunk("user1", "Node is a runtime.", "new-chunk")

      expect(mockPrisma.knowledgeEntity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { chunkIds: ["old-chunk", "new-chunk"] },
        }),
      )
    })

    it("is graceful when LLM returns no JSON", async () => {
      mockOrchestrator.generate.mockResolvedValue("I cannot do that.")
      await expect(kg.extractFromChunk("user1", "text", "chunk-x")).resolves.toBeUndefined()
    })

    it("is graceful when LLM throws", async () => {
      mockOrchestrator.generate.mockRejectedValue(new Error("LLM down"))
      await expect(kg.extractFromChunk("user1", "text", "chunk-x")).resolves.toBeUndefined()
    })

    it("does not create entity with empty name", async () => {
      mockOrchestrator.generate.mockResolvedValue(
        JSON.stringify({ entities: [{ name: "", type: "tool" }], edges: [] }),
      )
      await kg.extractFromChunk("user1", "text", "chunk-skip")
      expect(mockPrisma.knowledgeEntity.create).not.toHaveBeenCalled()
    })

    it("does not add duplicate chunkId to existing entity", async () => {
      const existing = { id: "ent-x", chunkIds: ["chunk-dup"] }
      mockOrchestrator.generate.mockResolvedValue(
        JSON.stringify({ entities: [{ name: "Vue", type: "tool" }], edges: [] }),
      )
      mockPrisma.knowledgeEntity.findUnique.mockResolvedValue(existing)

      await kg.extractFromChunk("user1", "Vue is a framework.", "chunk-dup")
      expect(mockPrisma.knowledgeEntity.update).not.toHaveBeenCalled()
    })
  })

  // ------------------------------------------------------------------
  // graphRetrieval
  // ------------------------------------------------------------------
  describe("graphRetrieval", () => {
    it("returns chunk IDs reachable from seed entities (2 hops)", async () => {
      // The query entity extraction returns ["TypeScript"]
      mockOrchestrator.generate.mockResolvedValue('["TypeScript"]')

      // Seed entity found in DB
      mockPrisma.knowledgeEntity.findMany
        .mockResolvedValueOnce([{ id: "ent-ts" }]) // seed lookup
        .mockResolvedValueOnce([{ chunkIds: ["chunk-1"] }]) // seed chunk IDs
        .mockResolvedValueOnce([{ id: "ent-react" }]) // hop-1 neighbors
        .mockResolvedValueOnce([{ chunkIds: ["chunk-2"] }]) // hop-1 entity chunks
        .mockResolvedValueOnce([]) // hop-2 neighbors (empty)

      mockPrisma.knowledgeEdge.findMany.mockResolvedValue([
        { fromId: "ent-ts", toId: "ent-react" },
      ])

      const result = await kg.graphRetrieval("user1", "TypeScript projects", 2)
      expect(result).toContain("chunk-1")
    })

    it("returns empty array when no seed entities found", async () => {
      mockOrchestrator.generate.mockResolvedValue('["UnknownEntity"]')
      mockPrisma.knowledgeEntity.findMany.mockResolvedValue([])

      const result = await kg.graphRetrieval("user1", "unknown query", 2)
      expect(result).toEqual([])
    })

    it("returns empty array when LLM fails to extract entities", async () => {
      mockOrchestrator.generate.mockRejectedValue(new Error("timeout"))

      const result = await kg.graphRetrieval("user1", "some query", 2)
      expect(result).toEqual([])
    })

    it("handles no edges gracefully (no traversal beyond seeds)", async () => {
      mockOrchestrator.generate.mockResolvedValue('["TypeScript"]')
      mockPrisma.knowledgeEntity.findMany
        .mockResolvedValueOnce([{ id: "ent-ts" }])
        .mockResolvedValueOnce([{ chunkIds: ["chunk-only"] }])
        .mockResolvedValue([])
      mockPrisma.knowledgeEdge.findMany.mockResolvedValue([])

      const result = await kg.graphRetrieval("user1", "TypeScript", 2)
      expect(result).toContain("chunk-only")
    })
  })
})
