/**
 * @file knowledge-format-handlers.test.ts
 * @description Unit tests for Phase 13 format-handlers.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}))

import fsAsync from "node:fs/promises"
import { parseFile, parseHtml } from "../knowledge/format-handlers.js"

const mockReadFile = vi.mocked(fsAsync.readFile)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("format-handlers", () => {
  describe("parseFile — .txt", () => {
    it("returns ParsedDocument with correct text and wordCount for plain text", async () => {
      mockReadFile.mockResolvedValueOnce("Hello world this is a test")
      const result = await parseFile("/tmp/test.txt")
      expect(result).not.toBeNull()
      expect(result!.text).toBe("Hello world this is a test")
      expect(result!.metadata.wordCount).toBe(6)
    })

    it("returns null for empty text file", async () => {
      mockReadFile.mockResolvedValueOnce("   ")
      const result = await parseFile("/tmp/empty.txt")
      expect(result).toBeNull()
    })

    it("returns null for read errors", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"))
      const result = await parseFile("/tmp/missing.txt")
      expect(result).toBeNull()
    })
  })

  describe("parseFile — .md", () => {
    it("parses markdown headings into sections", async () => {
      mockReadFile.mockResolvedValueOnce("# Section 1\nContent one\n## Section 2\nContent two")
      const result = await parseFile("/tmp/test.md")
      expect(result).not.toBeNull()
      expect(result!.structure.length).toBeGreaterThan(0)
      const headings = result!.structure.map((s) => s.heading).filter(Boolean)
      expect(headings).toContain("Section 1")
    })

    it("returns single section for markdown without headings", async () => {
      mockReadFile.mockResolvedValueOnce("Just some text without any headings here.")
      const result = await parseFile("/tmp/flat.md")
      expect(result).not.toBeNull()
      expect(result!.structure).toHaveLength(1)
    })
  })

  describe("parseHtml", () => {
    it("strips script tags from HTML", async () => {
      mockReadFile.mockResolvedValueOnce(
        "<html><head><script>alert(1)</script></head><body><p>Hello</p></body></html>",
      )
      const result = await parseHtml("/tmp/test.html")
      expect(result).not.toBeNull()
      expect(result!.text).not.toContain("alert")
      expect(result!.text).toContain("Hello")
    })

    it("extracts title from <title> tag", async () => {
      mockReadFile.mockResolvedValueOnce("<html><head><title>My Page</title></head><body>Content</body></html>")
      const result = await parseHtml("/tmp/page.html")
      expect(result!.title).toBe("My Page")
    })

    it("falls back to filename when no <title> tag", async () => {
      mockReadFile.mockResolvedValueOnce("<html><body>Content</body></html>")
      const result = await parseHtml("/tmp/fallback.html")
      expect(result!.title).toBe("fallback")
    })

    it("returns null on read error", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("EACCES"))
      const result = await parseHtml("/tmp/denied.html")
      expect(result).toBeNull()
    })
  })

  describe("parseFile — unsupported extension", () => {
    it("returns null for unsupported extension", async () => {
      const result = await parseFile("/tmp/file.xyz")
      expect(result).toBeNull()
    })

    it("returns null for .exe extension", async () => {
      const result = await parseFile("/tmp/program.exe")
      expect(result).toBeNull()
    })
  })
})
