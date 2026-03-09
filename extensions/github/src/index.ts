/**
 * @file index.ts
 * @description GitHub integration extension for EDITH.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Registered via plugin-sdk loader. Provides tools for listing repos,
 *   issues, and PRs via the GitHub REST API. Requires GITHUB_TOKEN.
 */

import { createLogger } from "../../../src/logger.js"
import type { Hook } from "../../../src/hooks/registry.js"
import { GitHubTool } from "./tool.js"

export { GitHubTool } from "./tool.js"

export const name = "github"
export const version = "0.1.0"
export const description = "GitHub — repos, issues, PRs, commits"

const log = createLogger("ext.github")
let tool: GitHubTool | null = null

export const hooks: Hook[] = [
  {
    name: "github-context-inject",
    type: "pre_message",
    priority: 5,
    handler: async (ctx) => ctx, // Future: inject active PR/issue context
  },
]

export async function onLoad(): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    log.debug("GITHUB_TOKEN not set — skipping")
    return
  }
  tool = new GitHubTool(token)
  log.info("GitHub tool loaded")
}

export function getTool(): GitHubTool | null {
  return tool
}
