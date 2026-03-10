/**
 * @file tool.ts
 * @description GitHub integration tool for EDITH — exposes issue/PR/repo
 *   operations as agent-callable skills.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Loaded by the skills system. Calls the GitHub REST API using Octokit.
 *   Requires GITHUB_TOKEN in config.
 */

import config from "../../src/config.js"
import { createLogger } from "../../src/logger.js"

const log = createLogger("ext.github")

const GITHUB_API_BASE = "https://api.github.com"

interface GitHubIssue {
  number: number
  title: string
  state: string
  html_url: string
}

interface GitHubRepo {
  full_name: string
  description: string | null
  html_url: string
  stargazers_count: number
}

async function githubFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = config.GITHUB_TOKEN
  if (!token?.trim()) {
    throw new Error("GITHUB_TOKEN is not configured")
  }

  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "EDITH-AI",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 200)}`)
  }

  return response.json() as Promise<T>
}

/** List open issues for a repository. */
export async function listIssues(owner: string, repo: string, limit = 10): Promise<GitHubIssue[]> {
  log.debug("listing issues", { owner, repo, limit })
  return githubFetch<GitHubIssue[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=${limit}`,
  )
}

/** Create a new issue. */
export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
): Promise<GitHubIssue> {
  log.debug("creating issue", { owner, repo, title })
  return githubFetch<GitHubIssue>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    },
  )
}

/** Get basic repository info. */
export async function getRepo(owner: string, repo: string): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  )
}

/** Tool metadata for the skills loader. */
export const toolMeta = {
  name: "github",
  description: "GitHub integration — list issues, create issues, get repo info",
  functions: { listIssues, createIssue, getRepo },
}
