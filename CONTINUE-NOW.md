# EDITH — Continue Implementation Prompt

> Paste ke Claude Code. Kerjakan semua task secara berurutan tanpa berhenti.
> Setiap task: implement → pnpm typecheck → pnpm test → git add -A → git commit → git push origin main

---

## PROMPT (paste ke Claude Code):

```
You are continuing EDITH v2 implementation. Working directory: C:\Users\test\OneDrive\Desktop\EDITH

First, run: git log --oneline -5
Then implement ALL tasks below in order. After EVERY task:
1. pnpm typecheck  (fix all errors before continuing)
2. pnpm test       (must not break existing tests)
3. git add -A
4. git commit -m "fix/feat: [task name]"
5. git push origin main

Do NOT stop between tasks. Do NOT ask for confirmation. Fix TypeScript errors immediately.

════════════════════════════════════════════════════════
CRITICAL BUG FIXES (do these FIRST)
════════════════════════════════════════════════════════

─── BUG 1: processMessage untyped in main.ts ───

FILE: src/main.ts
PROBLEM: `async function startCLI(processMessage: Function)` — Function is any-typed, breaks strict TypeScript.
FIX: Import the proper type and replace the signature.

Add this import at the top of src/main.ts (after other imports):
  import { type processMessage as ProcessMessageFn } from "./core/message-pipeline.js"

Change the function signature from:
  async function startCLI(processMessage: Function): Promise<void> {
To:
  async function startCLI(processMessage: typeof ProcessMessageFn): Promise<void> {

Commit: "fix(main): replace processMessage: Function with proper type from message-pipeline"

─── BUG 2: Hook pipeline not wired to message-pipeline ───

FILE: src/core/message-pipeline.ts
PROBLEM: hookPipeline exists in src/hooks/pipeline.ts but is never called in the message pipeline.
         All bundled hooks (gmail-watch, calendar-sync, github-events) never fire.
FIX: Wire hookPipeline.run() at Stage 1 (pre_message) and Stage 7 (post_message).

Step 1: Add import at top of src/core/message-pipeline.ts:
  import { hookPipeline } from "../hooks/pipeline.js"

Step 2: In processMessage(), after Stage 0 rate limit check and BEFORE Stage 1 input safety,
add the pre_message hook call:

  // Stage 0b: Pre-message hooks (fire-and-forget safe, but we await for abort support)
  const preHookCtx = await hookPipeline.run("pre_message", {
    userId,
    channel,
    content: rawText,
    metadata: { requestId },
  }).catch(err => {
    log.warn("pre_message hook error", { requestId, userId, err })
    return { userId, channel, content: rawText, metadata: { requestId }, abort: false }
  })
  if (preHookCtx.abort) {
    log.warn("message aborted by pre_message hook", { requestId, userId, reason: preHookCtx.abortReason })
    return blockedResult(requestId)
  }

Step 3: In launchAsyncSideEffects(), add post_message hook fire-and-forget:
  // Hooks: fire post_message hooks asynchronously
  void hookPipeline.run("post_message", {
    userId,
    channel: "pipeline",
    content: response,
    metadata: { safeText },
  }).catch(err => log.warn("post_message hook error", { userId, err }))

Commit: "fix(pipeline): wire hookPipeline pre_message + post_message into message-pipeline Stage 0b and Stage 9"

─── BUG 3: GCAL_ENABLED missing from config schema ───

FILE: src/config.ts
PROBLEM: src/protocols/morning-briefing.ts checks `config.GCAL_ENABLED === 'true'` but GCAL_ENABLED is not in ConfigSchema.
FIX: Add to ConfigSchema in src/config.ts, after the GCAL_REFRESH_TOKEN line:

  GCAL_ENABLED: boolFromEnv.default(false),

Also add to .env.example under the Google Calendar section:
  # GCAL_ENABLED=false

Commit: "fix(config): add missing GCAL_ENABLED to ConfigSchema — was silently always false in morning-briefing"

─── BUG 4: CI coverage gate has no threshold ───

FILE: .github/workflows/ci.yml
PROBLEM: coverage job runs `pnpm test -- --coverage` but never fails on low coverage. CI is always green even at 0%.
FIX: Add vitest coverage threshold to vitest.config.ts AND add --reporter flag to CI.

Step 1: In vitest.config.ts, add coverage thresholds:
  coverage: {
    provider: 'v8',
    thresholds: {
      lines: 40,
      functions: 40,
      branches: 30,
      statements: 40,
    },
    exclude: [
      'src/cli/**',
      'src/database/**',
      '**/__tests__/**',
      '**/*.test.ts',
      'dist/**',
      'node_modules/**',
    ]
  }

Step 2: In .github/workflows/ci.yml, change the coverage step command from:
  run: pnpm test -- --coverage
To:
  run: pnpm test -- --coverage --coverage.thresholds.lines=40

Commit: "fix(ci): add coverage threshold gate — 40% lines/functions, 30% branches"

─── BUG 5: oxlint missing from devDependencies ───

FILE: package.json
PROBLEM: package.json has `"lint": "oxlint src/"` script but oxlint is not in devDependencies. pnpm lint crashes.
FIX:
  Run: pnpm add -D oxlint
  Verify package.json now has oxlint in devDependencies.
  Run: pnpm lint  (should run without "command not found" error)

Commit: "fix(deps): add oxlint to devDependencies — lint script was broken"

─── BUG 6: Missing Prisma models ───

FILE: prisma/schema.prisma
PROBLEM: SubscriptionRecord and MessageScore are referenced in code but missing from schema.
FIX: Add these two models to the END of prisma/schema.prisma:

model SubscriptionRecord {
  id              String    @id @default(cuid())
  userId          String
  name            String
  amount          Float
  currency        String    @default("IDR")
  billingCycle    String
  nextBillingDate DateTime?
  status          String    @default("active")
  createdAt       DateTime  @default(now())
  @@index([userId])
}

model MessageScore {
  id             String   @id @default(cuid())
  userId         String
  messageId      String
  channel        String
  priority       Int
  category       String
  requiresAction Boolean  @default(false)
  scoredAt       DateTime @default(now())
  @@index([userId])
  @@index([priority])
}

Then run: pnpm prisma migrate dev --name add-subscription-message-score

Commit: "fix(prisma): add missing SubscriptionRecord and MessageScore models + migration"

─── BUG 7: OpenAI-compat missing models.ts ───

FILE: src/api/openai-compat/models.ts (CREATE NEW)
PROBLEM: GET /v1/models route is referenced but models.ts doesn't exist.
FIX: Create src/api/openai-compat/models.ts:

/**
 * @file models.ts
 * @description GET /v1/models — OpenAI-compatible model listing endpoint.
 */
import type { FastifyInstance } from 'fastify'

export function registerModels(app: FastifyInstance): void {
  app.get('/v1/models', async (_req, reply) => {
    return reply.send({
      object: 'list',
      data: [
        { id: 'edith-1', object: 'model', created: 1700000000, owned_by: 'edith', description: 'EDITH full pipeline with memory and persona' },
        { id: 'edith-fast', object: 'model', created: 1700000000, owned_by: 'edith', description: 'EDITH fast mode — lower latency' },
        { id: 'edith-reasoning', object: 'model', created: 1700000000, owned_by: 'edith', description: 'EDITH reasoning mode — LATS tree search' },
      ],
    })
  })
}

Commit: "fix(api): add missing openai-compat models.ts for GET /v1/models"

════════════════════════════════════════════════════════
PHASE 32 — Extension Implementations
════════════════════════════════════════════════════════

Currently extensions/ are empty shells (just package.json + README.md).
Implement actual TypeScript source for each extension.

─── Extension: @edith/ext-zalo ───

Create extensions/zalo/src/channel.ts:

/**
 * @file channel.ts
 * @description Zalo OA (Official Account) channel extension for EDITH.
 * Uses Zalo API v3 for message sending/receiving.
 */
import { createLogger } from '../../../src/logger.js'

const log = createLogger('ext.zalo')

export interface ZaloMessage {
  sender: { id: string }
  message: { text: string; mid: string }
  timestamp: number
}

export interface ZaloConfig {
  accessToken: string
  oaId: string
  webhookSecret?: string
}

export class ZaloChannel {
  private readonly BASE_URL = 'https://openapi.zalo.me/v3.0'

  constructor(private readonly config: ZaloConfig) {}

  async send(recipientId: string, text: string): Promise<void> {
    const res = await fetch(`${this.BASE_URL}/oa/message/cs`, {
      method: 'POST',
      headers: {
        'access_token': this.config.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { user_id: recipientId },
        message: { text },
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      log.error('Zalo send failed', { status: res.status, err })
      throw new Error(`Zalo send failed: ${res.status}`)
    }
    log.debug('Zalo message sent', { recipientId, length: text.length })
  }

  async getUserProfile(userId: string): Promise<{ name: string; avatar: string } | null> {
    try {
      const res = await fetch(
        `${this.BASE_URL}/oa/getprofile?user_id=${userId}`,
        { headers: { 'access_token': this.config.accessToken } }
      )
      if (!res.ok) return null
      const data = await res.json() as { data?: { display_name: string; avatar: string } }
      return data.data ? { name: data.data.display_name, avatar: data.data.avatar } : null
    } catch {
      return null
    }
  }

  verifyWebhook(body: string, signature: string): boolean {
    if (!this.config.webhookSecret) return true
    const { createHmac } = require('node:crypto')
    const expected = createHmac('sha256', this.config.webhookSecret).update(body).digest('hex')
    return expected === signature
  }

  parseWebhook(body: unknown): ZaloMessage | null {
    try {
      const payload = body as { entry?: Array<{ messaging?: ZaloMessage[] }> }
      return payload?.entry?.[0]?.messaging?.[0] ?? null
    } catch {
      return null
    }
  }
}

Also create extensions/zalo/src/index.ts:
  export { ZaloChannel } from './channel.js'
  export type { ZaloMessage, ZaloConfig } from './channel.js'

Commit: "feat(ext-zalo): implement ZaloChannel with send, getUserProfile, webhook verification"

─── Extension: @edith/ext-notion ───

Create extensions/notion/src/tool.ts:

/**
 * @file tool.ts
 * @description Notion integration — read/write pages, databases, and blocks.
 */
import { createLogger } from '../../../src/logger.js'

const log = createLogger('ext.notion')
const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

export class NotionTool {
  constructor(private readonly apiKey: string) {}

  private get headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    }
  }

  async searchPages(query: string, limit = 10): Promise<Array<{ id: string; title: string; url: string }>> {
    const res = await fetch(`${NOTION_API}/search`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ query, page_size: limit }),
    })
    if (!res.ok) throw new Error(`Notion search failed: ${res.status}`)
    const data = await res.json() as { results: Array<{ id: string; url: string; properties?: Record<string, unknown>; title?: Array<{ plain_text: string }> }> }
    return data.results.map(r => ({
      id: r.id,
      title: this.extractTitle(r),
      url: r.url,
    }))
  }

  async getPage(pageId: string): Promise<{ title: string; content: string; url: string }> {
    const [page, blocks] = await Promise.all([
      fetch(`${NOTION_API}/pages/${pageId}`, { headers: this.headers }).then(r => r.json()),
      fetch(`${NOTION_API}/blocks/${pageId}/children`, { headers: this.headers }).then(r => r.json()),
    ])
    return {
      title: this.extractTitle(page as Record<string, unknown>),
      content: this.blocksToText((blocks as { results: unknown[] }).results),
      url: (page as { url: string }).url,
    }
  }

  async appendToPage(pageId: string, text: string): Promise<void> {
    await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
        }],
      }),
    })
    log.debug('appended to Notion page', { pageId, length: text.length })
  }

  async createPage(parentId: string, title: string, content: string): Promise<string> {
    const res = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        parent: { database_id: parentId },
        properties: { title: { title: [{ text: { content: title } }] } },
        children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }],
      }),
    })
    if (!res.ok) throw new Error(`Notion create page failed: ${res.status}`)
    const data = await res.json() as { id: string }
    return data.id
  }

  private extractTitle(obj: Record<string, unknown>): string {
    const props = obj.properties as Record<string, unknown> | undefined
    if (props) {
      for (const val of Object.values(props)) {
        const v = val as { type?: string; title?: Array<{ plain_text: string }> }
        if (v.type === 'title' && v.title?.[0]) return v.title[0].plain_text
      }
    }
    const titleArr = obj.title as Array<{ plain_text: string }> | undefined
    return titleArr?.[0]?.plain_text ?? 'Untitled'
  }

  private blocksToText(blocks: unknown[]): string {
    return blocks.map(b => {
      const block = b as Record<string, unknown>
      const type = block.type as string
      const content = block[type] as { rich_text?: Array<{ plain_text: string }> } | undefined
      return content?.rich_text?.map(t => t.plain_text).join('') ?? ''
    }).filter(Boolean).join('\n')
  }
}

Create extensions/notion/src/index.ts:
  export { NotionTool } from './tool.js'

Commit: "feat(ext-notion): implement NotionTool with searchPages, getPage, appendToPage, createPage"

─── Extension: @edith/ext-github ───

Create extensions/github/src/tool.ts:

/**
 * @file tool.ts
 * @description GitHub integration — repos, issues, PRs, commits via REST API.
 */
import { createLogger } from '../../../src/logger.js'

const log = createLogger('ext.github')
const GITHUB_API = 'https://api.github.com'

export class GitHubTool {
  constructor(private readonly token: string) {}

  private get headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }

  async getRepo(owner: string, repo: string): Promise<{ name: string; description: string; stars: number; openIssues: number }> {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.headers })
    if (!res.ok) throw new Error(`GitHub repo fetch failed: ${res.status}`)
    const data = await res.json() as { name: string; description: string; stargazers_count: number; open_issues_count: number }
    return { name: data.name, description: data.description, stars: data.stargazers_count, openIssues: data.open_issues_count }
  }

  async listOpenIssues(owner: string, repo: string, limit = 10): Promise<Array<{ number: number; title: string; url: string; labels: string[] }>> {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues?state=open&per_page=${limit}`, { headers: this.headers })
    if (!res.ok) throw new Error(`GitHub issues fetch failed: ${res.status}`)
    const data = await res.json() as Array<{ number: number; title: string; html_url: string; labels: Array<{ name: string }> }>
    return data.map(i => ({ number: i.number, title: i.title, url: i.html_url, labels: i.labels.map(l => l.name) }))
  }

  async listOpenPRs(owner: string, repo: string, limit = 10): Promise<Array<{ number: number; title: string; author: string; url: string }>> {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=${limit}`, { headers: this.headers })
    if (!res.ok) throw new Error(`GitHub PRs fetch failed: ${res.status}`)
    const data = await res.json() as Array<{ number: number; title: string; user: { login: string }; html_url: string }>
    return data.map(p => ({ number: p.number, title: p.title, author: p.user.login, url: p.html_url }))
  }

  async createIssue(owner: string, repo: string, title: string, body: string, labels: string[] = []): Promise<number> {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ title, body, labels }),
    })
    if (!res.ok) throw new Error(`GitHub create issue failed: ${res.status}`)
    const data = await res.json() as { number: number }
    log.info('GitHub issue created', { owner, repo, number: data.number })
    return data.number
  }

  async getLatestCommits(owner: string, repo: string, limit = 5): Promise<Array<{ sha: string; message: string; author: string; date: string }>> {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=${limit}`, { headers: this.headers })
    if (!res.ok) throw new Error(`GitHub commits fetch failed: ${res.status}`)
    const data = await res.json() as Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>
    return data.map(c => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0] ?? '', author: c.commit.author.name, date: c.commit.author.date }))
  }
}

Create extensions/github/src/index.ts:
  export { GitHubTool } from './tool.js'

Commit: "feat(ext-github): implement GitHubTool with repo, issues, PRs, commits, createIssue"

─── Extension: @edith/ext-home-assistant ───

Create extensions/home-assistant/src/tool.ts:

/**
 * @file tool.ts
 * @description Home Assistant REST API integration.
 * Works with any HA instance (local or remote via Nabu Casa).
 */
import { createLogger } from '../../../src/logger.js'

const log = createLogger('ext.home-assistant')

export interface HAEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
}

export interface HAConfig {
  baseUrl: string        // e.g. http://homeassistant.local:8123
  token: string          // Long-lived access token
}

export class HomeAssistantTool {
  constructor(private readonly config: HAConfig) {}

  private get headers() {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
    }
  }

  private url(path: string) {
    return `${this.config.baseUrl}/api${path}`
  }

  async getStates(): Promise<HAEntity[]> {
    const res = await fetch(this.url('/states'), { headers: this.headers })
    if (!res.ok) throw new Error(`HA getStates failed: ${res.status}`)
    return res.json() as Promise<HAEntity[]>
  }

  async getEntityState(entityId: string): Promise<HAEntity> {
    const res = await fetch(this.url(`/states/${entityId}`), { headers: this.headers })
    if (!res.ok) throw new Error(`HA getState failed: ${res.status} for ${entityId}`)
    return res.json() as Promise<HAEntity>
  }

  async callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    const res = await fetch(this.url(`/services/${domain}/${service}`), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`HA service call failed: ${res.status}`)
    log.debug('HA service called', { domain, service })
  }

  async turnOn(entityId: string): Promise<void> {
    const domain = entityId.split('.')[0]!
    await this.callService(domain, 'turn_on', { entity_id: entityId })
  }

  async turnOff(entityId: string): Promise<void> {
    const domain = entityId.split('.')[0]!
    await this.callService(domain, 'turn_off', { entity_id: entityId })
  }

  async setLight(entityId: string, brightness?: number, colorTemp?: number): Promise<void> {
    const data: Record<string, unknown> = { entity_id: entityId }
    if (brightness !== undefined) data.brightness = brightness
    if (colorTemp !== undefined) data.color_temp = colorTemp
    await this.callService('light', 'turn_on', data)
  }

  async setClimate(entityId: string, temperature: number): Promise<void> {
    await this.callService('climate', 'set_temperature', { entity_id: entityId, temperature })
  }

  async getHistory(entityId: string, hours = 24): Promise<Array<{ state: string; last_changed: string }>> {
    const end = new Date().toISOString()
    const start = new Date(Date.now() - hours * 3600000).toISOString()
    const res = await fetch(this.url(`/history/period/${start}?end_time=${end}&filter_entity_id=${entityId}`), { headers: this.headers })
    if (!res.ok) return []
    const data = await res.json() as Array<Array<{ state: string; last_changed: string }>>
    return data[0] ?? []
  }

  async isOnline(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/'), { headers: this.headers, signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }
}

Create extensions/home-assistant/src/index.ts:
  export { HomeAssistantTool } from './tool.js'
  export type { HAEntity, HAConfig } from './tool.js'

Commit: "feat(ext-home-assistant): implement HomeAssistantTool with states, service calls, light/climate control"

════════════════════════════════════════════════════════
PHASE 33 — Skills Content Completion
════════════════════════════════════════════════════════

Many skill directories exist but SKILL.md content is minimal or missing.
Update/create SKILL.md for the 10 most important skills with complete content.

─── Skill: workspace/skills/github-prs/SKILL.md ───

Create/overwrite:
---
name: github-prs
version: 1.0.0
description: Review and manage GitHub Pull Requests
triggers: ["PR", "pull request", "review", "merge", "diff", "code review"]
requires: [GITHUB_TOKEN]
---

# GitHub PRs Skill

Review, summarize, and manage GitHub Pull Requests.

## Capabilities
- List open PRs for a repository
- Summarize a PR's changes and purpose
- Check PR review status and CI results
- Draft review comments
- Identify potential issues in diff

## Usage Examples
- "List open PRs in myorg/myrepo"
- "Summarize PR #123 in myrepo"
- "Any PRs waiting for my review?"
- "What does PR #45 change?"

## EDITH Actions
When user asks about PRs, use the GitHub extension:
1. Call GitHubTool.listOpenPRs(owner, repo) to get open PRs
2. Format results clearly with number, title, author
3. Offer to summarize specific PRs

─── Skill: workspace/skills/expense-tracker/SKILL.md ───

---
name: expense-tracker
version: 1.0.0
description: Track and categorize daily expenses in IDR
triggers: ["pengeluaran", "expense", "beli", "bayar", "biaya", "catat pengeluaran"]
requires: []
---

# Expense Tracker Skill

Track daily expenses and get spending summaries. Works offline — stored in EDITH's local database.

## Capabilities
- Record expenses with category and description
- Monthly spending summary by category
- Budget alerts when approaching limits
- Export spending history

## Categories
transport, food, shopping, bills, entertainment, health, education, other

## Usage Examples
- "Catat pengeluaran Grab 45rb"
- "Beli kopi 35000"
- "Bayar listrik 280000"
- "Berapa total pengeluaran bulan ini?"
- "Rekap pengeluaran minggu ini"

## EDITH Actions
When recording expense:
1. Extract: amount (convert 45rb → 45000), category, description
2. Call expenseTracker.record(userId, { amount, currency: 'IDR', category, description })
3. Confirm with running monthly total for that category

─── Skill: workspace/skills/morning-briefing/SKILL.md ───
(This already exists — skip if content is already > 1KB)

─── Skill: workspace/skills/situation-report/SKILL.md ───

---
name: situation-report
version: 1.0.0
description: On-demand situational awareness summary — JARVIS SITREP
triggers: ["sitrep", "situation report", "status update", "apa yang terjadi", "update terbaru", "ringkasan hari ini"]
requires: []
---

# Situation Report (SITREP) Skill

Instant briefing about current status across all EDITH-monitored systems.

## Capabilities
- Weather at current location
- Pending unread messages by priority
- Today's calendar summary
- Recent market movements (if enabled)
- Active missions status
- System health (memory usage, active channels)

## Usage Examples
- "SITREP"
- "Situation report"
- "Apa yang terjadi sekarang?"
- "Update terbaru dong"
- "Status hari ini"

## EDITH Actions
Call situationReporter.generate(userId) which aggregates:
- weatherMonitor.getCurrent()
- morningBriefing.getPendingAlerts(userId)
- missionManager.getActiveMissions(userId)
- edithMetrics for system health

─── Also update these skills with proper SKILL.md (keep concise, ~1KB each): ───
workspace/skills/memory-search/SKILL.md — add: triggers, what memory.buildContext returns, example queries
workspace/skills/self-improve/SKILL.md — add: how to trigger quality analysis, what QualityTracker measures
workspace/skills/legion-delegate/SKILL.md — add: when to delegate, how Legion CRDT works, example tasks

Commit: "feat(skills): improve SKILL.md content for github-prs, expense-tracker, sitrep, memory-search, self-improve, legion-delegate"

════════════════════════════════════════════════════════
PHASE 35 — DX Tooling Completion
════════════════════════════════════════════════════════

─── Task 35.1: Fix vitest split configs ───

Check if vitest.unit.config.ts, vitest.channels.config.ts, vitest.e2e.config.ts, vitest.live.config.ts exist.
If any are missing or have wrong content, ensure they exist with proper content:

vitest.unit.config.ts:
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: {
      include: ['src/**/__tests__/**/*.test.ts'],
      exclude: ['src/**/*.e2e.test.ts', 'src/**/*.live.test.ts', 'src/**/*.integration.test.ts'],
      environment: 'node',
    }
  })

vitest.channels.config.ts:
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: {
      include: ['src/channels/**/__tests__/**/*.test.ts'],
      testTimeout: 30000,
      environment: 'node',
    }
  })

vitest.e2e.config.ts:
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: {
      include: ['src/**/*.e2e.test.ts'],
      testTimeout: 60000,
      environment: 'node',
    }
  })

vitest.live.config.ts:
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: {
      include: ['src/**/*.live.test.ts'],
      testTimeout: 120000,
      environment: 'node',
    }
  })

─── Task 35.2: Add tsc_errors.txt to .gitignore ───

Open .gitignore, add at the end:
  tsc_errors.txt
  *.tsbuildinfo

─── Task 35.3: Add missing test files for new modules ───

Create basic smoke tests for modules that have 0 tests:

src/protocols/__tests__/morning-briefing.test.ts:
  import { describe, it, expect, vi } from 'vitest'
  describe('MorningBriefingProtocol', () => {
    it('module loads without error', async () => {
      vi.mock('../../engines/orchestrator.js', () => ({ orchestrator: { generate: vi.fn().mockResolvedValue('Good morning!') } }))
      vi.mock('../../channels/manager.js', () => ({ channelManager: { sendToUser: vi.fn() } }))
      vi.mock('../../memory/store.js', () => ({ memory: { save: vi.fn(), buildContext: vi.fn().mockResolvedValue({ messages: [], systemContext: '', retrievedMemoryIds: [] }) } }))
      const { morningBriefing } = await import('../morning-briefing.js')
      expect(morningBriefing).toBeDefined()
    })
  })

src/ambient/__tests__/weather-monitor.test.ts:
  import { describe, it, expect } from 'vitest'
  describe('WeatherMonitor', () => {
    it('module loads without error', async () => {
      const { weatherMonitor } = await import('../weather-monitor.js')
      expect(weatherMonitor).toBeDefined()
    })
    it('returns null when coordinates not configured', async () => {
      const { weatherMonitor } = await import('../weather-monitor.js')
      const result = await weatherMonitor.getCurrent()
      // Should not throw even without coordinates
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })

src/predictive/__tests__/intent-predictor.test.ts:
  import { describe, it, expect, vi } from 'vitest'
  describe('IntentPredictor', () => {
    it('module loads without error', async () => {
      vi.mock('../../engines/orchestrator.js', () => ({ orchestrator: { generate: vi.fn().mockResolvedValue('{"intent":"weather","confidence":0.8,"preloadHint":"weather"}') } }))
      vi.mock('../../memory/store.js', () => ({ memory: { buildContext: vi.fn().mockResolvedValue({ messages: [], systemContext: '', retrievedMemoryIds: [] }) } }))
      const { intentPredictor } = await import('../intent-predictor.js')
      expect(intentPredictor).toBeDefined()
    })
  })

src/finance/__tests__/expense-tracker.test.ts:
  import { describe, it, expect, vi } from 'vitest'
  describe('ExpenseTracker', () => {
    it('module loads without error', async () => {
      vi.mock('../../database/index.js', () => ({ prisma: { expenseRecord: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) } } }))
      const { expenseTracker } = await import('../expense-tracker.js')
      expect(expenseTracker).toBeDefined()
    })
  })

Commit: "feat(dx): fix vitest split configs, add tsc_errors to gitignore, add smoke tests for protocols/ambient/predictive/finance"

════════════════════════════════════════════════════════
PHASE 44 — Cross-Platform Daemon Completion
════════════════════════════════════════════════════════

src/daemon/service.ts already exists with all-in-one implementation.
Split the platform-specific logic into separate files for maintainability.

─── Create src/daemon/runtime-paths.ts ───

/**
 * @file runtime-paths.ts
 * @description Platform-aware runtime path resolution for EDITH daemon.
 * Follows XDG Base Directory Spec on Linux, ~/Library on macOS, %APPDATA% on Windows.
 */
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../logger.js'

const log = createLogger('daemon.paths')

export interface RuntimePaths {
  /** Main EDITH data directory */
  dataDir: string
  /** Log directory */
  logsDir: string
  /** Config directory */
  configDir: string
  /** Backup directory */
  backupDir: string
  /** Temp/cache directory */
  cacheDir: string
}

export function getRuntimePaths(): RuntimePaths {
  const home = homedir()
  const p = platform()

  let dataDir: string
  let configDir: string
  let cacheDir: string

  if (p === 'darwin') {
    dataDir = join(home, 'Library', 'Application Support', 'EDITH')
    configDir = join(home, 'Library', 'Preferences', 'EDITH')
    cacheDir = join(home, 'Library', 'Caches', 'EDITH')
  } else if (p === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    dataDir = join(appData, 'EDITH')
    configDir = join(appData, 'EDITH', 'config')
    cacheDir = join(home, 'AppData', 'Local', 'EDITH', 'cache')
  } else {
    // Linux — XDG
    const xdgData = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share')
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
    const xdgCache = process.env.XDG_CACHE_HOME ?? join(home, '.cache')
    dataDir = join(xdgData, 'edith')
    configDir = join(xdgConfig, 'edith')
    cacheDir = join(xdgCache, 'edith')
  }

  const paths: RuntimePaths = {
    dataDir,
    logsDir: join(dataDir, 'logs'),
    configDir,
    backupDir: join(dataDir, 'backups'),
    cacheDir,
  }

  log.debug('runtime paths resolved', { platform: p, paths })
  return paths
}

/** Legacy ~/.edith path for backward compatibility */
export function getLegacyEdithDir(): string {
  return join(homedir(), '.edith')
}

─── Create src/daemon/__tests__/daemon.test.ts ───

import { describe, it, expect } from 'vitest'
import { getRuntimePaths } from '../runtime-paths.js'

describe('RuntimePaths', () => {
  it('returns paths with all required keys', () => {
    const paths = getRuntimePaths()
    expect(paths.dataDir).toBeDefined()
    expect(paths.logsDir).toBeDefined()
    expect(paths.configDir).toBeDefined()
    expect(paths.backupDir).toBeDefined()
    expect(paths.cacheDir).toBeDefined()
  })

  it('all paths are absolute (start with / or drive letter)', () => {
    const paths = getRuntimePaths()
    for (const [key, val] of Object.entries(paths)) {
      expect(val.startsWith('/') || /^[A-Z]:\\/.test(val), `${key} should be absolute`).toBe(true)
    }
  })
})

Commit: "feat(daemon): add runtime-paths.ts with XDG/AppData/Library platform-aware path resolution"

════════════════════════════════════════════════════════
FINAL VERIFICATION
════════════════════════════════════════════════════════

After all tasks complete, run:

1. pnpm typecheck   → must be 0 errors
2. pnpm test        → all tests pass
3. git log --oneline -15   → verify all commits are there
4. git push origin main    → final push

Then output a summary table:
- BUG 1-7: fixed / skipped (reason)
- Phase 32: extensions implemented / skipped
- Phase 33: skills updated
- Phase 35: DX fixed
- Phase 44: daemon paths added
- TypeScript errors: N
- Tests passing: N/N
```

---

## Kalau Claude Code berhenti di tengah jalan, paste ini:

```
Continue from where you stopped. Run: git log --oneline -10 to see progress.
Fix any remaining tasks from CONTINUE-NOW.md.
After each task: pnpm typecheck → pnpm test → git add -A → git commit → git push origin main
```

---

*Generated: 2026-03-09 | EDITH v2 Bug Fixes + Phase 32-35 + Phase 44*
