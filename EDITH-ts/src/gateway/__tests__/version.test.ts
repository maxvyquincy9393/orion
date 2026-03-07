import { describe, expect, it } from "vitest"

import { __gatewayTestUtils } from "../server.js"

const { APP_VERSION } = __gatewayTestUtils

describe("gateway/version", () => {
  it("reads version from package.json dynamically", () => {
    expect(typeof APP_VERSION).toBe("string")
    // semver-ish: at minimum "x.y.z"
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("does not fall back to 0.0.0 placeholder", () => {
    expect(APP_VERSION).not.toBe("0.0.0")
  })
})
