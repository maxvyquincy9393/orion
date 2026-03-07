import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../hooks/pipeline.js", () => ({
  hookPipeline: {
    run: vi.fn(async (_stage: string, payload: { content: string }) => ({
      ...payload,
      abort: false,
      metadata: {},
    })),
  },
}))

vi.mock("../../memory/store.js", () => ({
  memory: {
    consumePendingFeedback: vi.fn(() => null),
    provideFeedback: vi.fn(async () => undefined),
  },
}))

vi.mock("../../observability/usage-tracker.js", () => ({
  usageTracker: {
    recordUsage: vi.fn(async () => undefined),
  },
}))

vi.mock("../../engines/orchestrator.js", () => ({
  orchestrator: {
    getLastUsedEngine: vi.fn(() => ({ provider: "test", model: "mock" })),
  },
}))

vi.mock("../chat-commands.js", () => ({
  handleChatCommand: vi.fn(() => ({ handled: false })),
}))

vi.mock("../message-pipeline.js", () => ({
  processMessage: vi.fn(),
}))

import { processMessage } from "../message-pipeline.js"
import { handleIncomingUserMessage } from "../incoming-message-service.js"

describe("incoming-message-service cancellation", () => {
  const processMessageMock = processMessage as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("applies latest-wins cancellation for the same user/channel", async () => {
    processMessageMock
      .mockImplementationOnce(async (_userId: string, _text: string, options: { signal?: AbortSignal }) => {
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(options.signal?.reason ?? new Error("aborted"))
          }, { once: true })
        })
      })
      .mockResolvedValueOnce({
        response: "second-result",
        retrievedMemoryIds: [],
        provisionalReward: 0,
        taskType: "fast",
      })

    const first = handleIncomingUserMessage("user-1", "first", "webchat")
    await Promise.resolve()
    const second = handleIncomingUserMessage("user-1", "second", "webchat")

    await expect(second).resolves.toBe("second-result")
    await expect(first).rejects.toBeInstanceOf(Error)
  })
})

