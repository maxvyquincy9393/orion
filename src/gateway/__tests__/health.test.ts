/**
 * @file health.test.ts
 * @description Unit tests for the /health endpoint payload builder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockGetHealth, mockGetStatus, mockQueryRaw } = vi.hoisted(() => ({
  mockGetHealth: vi.fn(),
  mockGetStatus: vi.fn(),
  mockQueryRaw: vi.fn(),
}))

vi.mock("../../database/index.js", () => ({
  prisma: { $queryRaw: mockQueryRaw },
}))
vi.mock("../../gateway/channel-health-monitor.js", () => ({
  channelHealthMonitor: { getHealth: mockGetHealth },
}))
vi.mock("../../channels/outbox.js", () => ({
  outbox: { getStatus: mockGetStatus },
}))

import { buildHealthPayload } from "../health.js"

describe("buildHealthPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryRaw.mockResolvedValue([{ result: 1 }])
    mockGetHealth.mockReturnValue([
      { channelId: "telegram", connected: true },
      { channelId: "discord", connected: false },
    ])
    mockGetStatus.mockReturnValue({ pending: 2, deadLetters: 0 })
  })

  it("returns ok status when DB responds and at least one channel connected", async () => {
    const payload = await buildHealthPayload("1.0.0")
    expect(payload.status).toBe("ok")
    expect(payload.db).toBe("ok")
  })

  it("includes channel connection states", async () => {
    const payload = await buildHealthPayload("1.0.0")
    expect(payload.channels["telegram"]).toBe(true)
    expect(payload.channels["discord"]).toBe(false)
  })

  it("includes outbox stats", async () => {
    const payload = await buildHealthPayload("1.0.0")
    expect(payload.outbox.pending).toBe(2)
    expect(payload.outbox.deadLetters).toBe(0)
  })

  it("returns down when DB probe fails", async () => {
    mockQueryRaw.mockRejectedValue(new Error("DB unavailable"))
    const payload = await buildHealthPayload("1.0.0")
    expect(payload.status).toBe("down")
    expect(payload.db).toBe("error")
  })

  it("returns degraded when no channels connected", async () => {
    mockGetHealth.mockReturnValue([
      { channelId: "telegram", connected: false },
    ])
    const payload = await buildHealthPayload("1.0.0")
    expect(payload.status).toBe("degraded")
  })

  it("includes uptime and version", async () => {
    const payload = await buildHealthPayload("2.3.1")
    expect(payload.version).toBe("2.3.1")
    expect(typeof payload.uptime).toBe("number")
  })
})
