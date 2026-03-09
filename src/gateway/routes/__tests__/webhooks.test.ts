import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { registerWebhooks } from "../webhooks.js"

vi.mock("../../../channels/whatsapp.js", () => ({
  whatsAppChannel: {
    verifyCloudWebhook: vi.fn().mockReturnValue({ ok: true, challenge: "test_challenge" }),
    isCloudWebhookEnabled: vi.fn().mockReturnValue(false),
    handleCloudWebhookPayload: vi.fn().mockResolvedValue({ processed: 0, ignored: 1 }),
  },
}))
vi.mock("../../webhook-verifier.js", () => ({
  verifyWebhook: vi.fn().mockReturnValue(true),
}))

describe("registerWebhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("GET /webhooks/whatsapp responds to challenge", async () => {
    const app = Fastify()
    registerWebhooks(app)
    await app.ready()
    const res = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test&hub.challenge=test_challenge",
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it("POST /webhooks/whatsapp returns 503 when cloud not enabled", async () => {
    const app = Fastify()
    registerWebhooks(app)
    await app.ready()
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json" },
      payload: { entry: [] },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})
