import { describe, expect, it } from "vitest"

import { __skillLoaderTestUtils } from "../loader.js"

describe("skills/loader helpers", () => {
  it("preserves # inside quoted scalars", () => {
    expect(__skillLoaderTestUtils.sanitizeScalar('"value # keep"')).toBe("value # keep")
    expect(__skillLoaderTestUtils.sanitizeScalar("plain # comment")).toBe("plain")
  })

  it("parses inline lists with quoted commas", () => {
    const values = __skillLoaderTestUtils.splitInlineList('"a,b", c, \'d,e\'')
    expect(values).toEqual(["a,b", "c", "d,e"])
  })

  it("parses frontmatter requires block and boolean aliases", () => {
    const parsed = __skillLoaderTestUtils.parseFrontmatter(`---
name: Test Skill
alwaysActive: yes
os: [windows, linux]
requires:
  env: [OPENAI_API_KEY]
  bins:
    - "python"
---
# body`)

    expect(parsed).not.toBeNull()
    expect(parsed?.name).toBe("Test Skill")
    expect(parsed?.alwaysActive).toBe(true)
    expect(parsed?.os).toEqual(["windows", "linux"])
    expect(parsed?.requiresEnv).toEqual(["OPENAI_API_KEY"])
    expect(parsed?.requiresBins).toEqual(["python"])
  })
})
