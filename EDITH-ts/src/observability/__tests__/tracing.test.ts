import { describe, expect, it } from "vitest"

import { withSpan } from "../tracing.js"

describe("observability tracing", () => {
  it("executes wrapped function and returns result", async () => {
    const result = await withSpan("test.span", { test: true }, async () => "ok")
    expect(result).toBe("ok")
  })

  it("rethrows wrapped errors", async () => {
    await expect(withSpan("test.span.error", {}, async () => {
      throw new Error("boom")
    })).rejects.toThrow("boom")
  })
})

