import { describe, expect, it } from "vitest"

import { markdownProcessor } from "../processor.js"

describe("markdown processor", () => {
  it("escapes raw HTML for Telegram while preserving markdown formatting", () => {
    const rendered = markdownProcessor.process("**bold** <tag> & text", "telegram")

    expect(rendered).toBe("<b>bold</b> &lt;tag&gt; &amp; text")
  })

  it("does not apply italic formatting inside Telegram code spans", () => {
    const rendered = markdownProcessor.process("`*literal*` and *styled*", "telegram")

    expect(rendered).toContain("<code>*literal*</code>")
    expect(rendered).toContain("<i>styled</i>")
    expect(rendered).not.toContain("<code><i>literal</i></code>")
  })
})
