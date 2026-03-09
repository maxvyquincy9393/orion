/**
 * @file tool.ts
 * @description GitHub integration — repos, issues, PRs, commits.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses GitHub REST API v3 (2022-11-28) via native fetch.
 *   Requires a Personal Access Token with appropriate scopes.
 */

import { createLogger } from "../../../src/logger.js"

const log = createLogger("ext.github")
const API = "https://api.github.com"

export class GitHubTool {
  constructor(private readonly token: string) {}

  private get h(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }
  }

  async getRepo(
    owner: string,
    repo: string,
  ): Promise<{
    name: string
    description: string
    stars: number
    openIssues: number
    url: string
  }> {
    const r = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: this.h,
    })
    if (!r.ok) throw new Error(`GitHub getRepo failed: ${r.status}`)
    const d = (await r.json()) as {
      name: string
      description: string
      stargazers_count: number
      open_issues_count: number
      html_url: string
    }
    return {
      name: d.name,
      description: d.description,
      stars: d.stargazers_count,
      openIssues: d.open_issues_count,
      url: d.html_url,
    }
  }

  async listOpenIssues(
    owner: string,
    repo: string,
    limit = 10,
  ): Promise<
    Array<{ number: number; title: string; url: string; labels: string[] }>
  > {
    const r = await fetch(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=${limit}`,
      { headers: this.h },
    )
    if (!r.ok) throw new Error(`GitHub listIssues failed: ${r.status}`)
    const d = (await r.json()) as Array<{
      number: number
      title: string
      html_url: string
      labels: Array<{ name: string }>
    }>
    return d.map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      labels: i.labels.map((l) => l.name),
    }))
  }

  async listOpenPRs(
    owner: string,
    repo: string,
    limit = 10,
  ): Promise<
    Array<{
      number: number
      title: string
      author: string
      url: string
      draft: boolean
    }>
  > {
    const r = await fetch(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&per_page=${limit}`,
      { headers: this.h },
    )
    if (!r.ok) throw new Error(`GitHub listPRs failed: ${r.status}`)
    const d = (await r.json()) as Array<{
      number: number
      title: string
      user: { login: string }
      html_url: string
      draft: boolean
    }>
    return d.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user.login,
      url: p.html_url,
      draft: p.draft,
    }))
  }

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels: string[] = [],
  ): Promise<number> {
    const r = await fetch(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        method: "POST",
        headers: this.h,
        body: JSON.stringify({ title, body, labels }),
      },
    )
    if (!r.ok) throw new Error(`GitHub createIssue failed: ${r.status}`)
    const d = (await r.json()) as { number: number }
    log.info("issue created", { owner, repo, number: d.number })
    return d.number
  }

  async getLatestCommits(
    owner: string,
    repo: string,
    limit = 5,
  ): Promise<
    Array<{ sha: string; message: string; author: string; date: string }>
  > {
    const r = await fetch(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${limit}`,
      { headers: this.h },
    )
    if (!r.ok) throw new Error(`GitHub getCommits failed: ${r.status}`)
    const d = (await r.json()) as Array<{
      sha: string
      commit: { message: string; author: { name: string; date: string } }
    }>
    return d.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0] ?? "",
      author: c.commit.author.name,
      date: c.commit.author.date,
    }))
  }

  async getMyRepos(
    limit = 20,
  ): Promise<
    Array<{
      name: string
      fullName: string
      private: boolean
      stars: number
      url: string
    }>
  > {
    const r = await fetch(
      `${API}/user/repos?sort=pushed&per_page=${limit}`,
      { headers: this.h },
    )
    if (!r.ok) throw new Error(`GitHub getMyRepos failed: ${r.status}`)
    const d = (await r.json()) as Array<{
      name: string
      full_name: string
      private: boolean
      stargazers_count: number
      html_url: string
    }>
    return d.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      stars: repo.stargazers_count,
      url: repo.html_url,
    }))
  }
}
