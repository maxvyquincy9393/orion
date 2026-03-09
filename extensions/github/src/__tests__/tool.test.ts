import { describe, it, expect, vi, beforeEach } from "vitest"
import { GitHubTool } from "../tool.js"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("GitHubTool", () => {
  let tool: GitHubTool

  beforeEach(() => {
    tool = new GitHubTool("fake-token")
    mockFetch.mockReset()
  })

  it("getRepo returns parsed repo data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "myrepo",
        description: "desc",
        stargazers_count: 5,
        open_issues_count: 2,
        html_url: "https://github.com/u/myrepo",
      }),
    })
    const r = await tool.getRepo("u", "myrepo")
    expect(r.name).toBe("myrepo")
    expect(r.stars).toBe(5)
  })

  it("createIssue returns issue number", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ number: 42 }),
    })
    const n = await tool.createIssue("u", "r", "Bug", "body")
    expect(n).toBe(42)
  })

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(tool.getRepo("u", "r")).rejects.toThrow("404")
  })

  it("listOpenIssues returns formatted array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          number: 1,
          title: "Fix bug",
          html_url: "https://github.com/u/r/issues/1",
          labels: [{ name: "bug" }],
        },
      ],
    })
    const issues = await tool.listOpenIssues("u", "r")
    expect(issues).toHaveLength(1)
    expect(issues[0]!.labels).toEqual(["bug"])
  })

  it("getLatestCommits returns shortened sha", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          sha: "abc1234567890",
          commit: {
            message: "feat: add thing\n\ndetails",
            author: { name: "Dev", date: "2025-01-01T00:00:00Z" },
          },
        },
      ],
    })
    const commits = await tool.getLatestCommits("u", "r")
    expect(commits[0]!.sha).toBe("abc1234")
    expect(commits[0]!.message).toBe("feat: add thing")
  })
})
