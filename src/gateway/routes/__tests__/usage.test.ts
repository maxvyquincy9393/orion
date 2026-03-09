import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { registerUsage } from "../usage.js"

vi.mock("../../auth-middleware.js", () => ({
  authenticateWebSocket: vi.fn().mockResolvedValue({ userId: "owner" }),
}))
vi.mock("../../../multiuser/manager.js", () => ({
  multiUser: { isOwner: vi.fn().mockReturnValue(true) },
}))
vi.mock("../../../observability/usage-tracker.js", () => ({
  usageTracker: {
    getUserSummary: vi.fn().mockResolvedValue({ messages: 0, tokens: 0 }),
    getGlobalSummary: vi.fn().mockResolvedValue({ messages: 0, tokens: 0 }),
  },
}))

describe("registerUsage", () => {
  it("GET /api/usage/summary returns 401 without token", async () => {
    const app = Fastify()
    registerUsage(app)
    await app.ready()
    const res = await app.inject({ method: "GET", url: "/api/usage/summary" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
