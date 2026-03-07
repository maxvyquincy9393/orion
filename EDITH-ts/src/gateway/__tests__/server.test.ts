import crypto from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { __gatewayTestUtils } from "../server.js"

describe("gateway/server helpers", () => {
  it("parseDaysParam clamps invalid and out-of-range values safely", () => {
    expect(__gatewayTestUtils.parseDaysParam(undefined)).toBe(7)
    expect(__gatewayTestUtils.parseDaysParam("abc")).toBe(7)
    expect(__gatewayTestUtils.parseDaysParam("0")).toBe(1)
    expect(__gatewayTestUtils.parseDaysParam("999")).toBe(30)
    expect(__gatewayTestUtils.parseDaysParam("14")).toBe(14)
  })

  it("does not authorize global admin endpoint when ADMIN_TOKEN is unset", () => {
    expect(__gatewayTestUtils.isAdminTokenAuthorized(undefined, undefined)).toBe(false)
    expect(__gatewayTestUtils.isAdminTokenAuthorized("x", undefined)).toBe(false)
  })

  it("uses timing-safe comparison for admin token checks", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual")

    expect(__gatewayTestUtils.isAdminTokenAuthorized("secret", "secret")).toBe(true)
    expect(__gatewayTestUtils.isAdminTokenAuthorized("wrong", "secret")).toBe(false)

    expect(spy).toHaveBeenCalled()
  })

  it("normalizes client messages and rejects non-object payloads", () => {
    expect(() => __gatewayTestUtils.normalizeIncomingClientMessage("hello")).toThrow()

    const msg = __gatewayTestUtils.normalizeIncomingClientMessage({
      type: "voice_start",
      mimeType: "audio/webm",
      language: "id",
      channelCount: 2,
      sampleRate: 48_000,
      requestId: "r1",
    })

    expect(msg.type).toBe("voice_start")
    expect(msg.mimeType).toBe("audio/webm")
    expect(msg.language).toBe("id")
    expect(msg.channelCount).toBe(2)
    expect(msg.sampleRate).toBe(48_000)
  })

  it("redacts nested voice provider secrets", () => {
    const redacted = __gatewayTestUtils.redactSecrets({
      voice: {
        stt: {
          providers: {
            deepgram: {
              apiKey: "dg-secret",
            },
          },
        },
        wake: {
          providers: {
            picovoice: {
              accessKey: "pv-secret",
            },
          },
        },
      },
    }) as Record<string, any>

    expect(redacted.voice.stt.providers.deepgram.apiKey).toBe("***")
    expect(redacted.voice.wake.providers.picovoice.accessKey).toBe("***")
  })

  it("exports CSP header policy", () => {
    expect(__gatewayTestUtils.CONTENT_SECURITY_POLICY).toContain("default-src 'self'")
  })
})
