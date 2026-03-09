# EDITH — Phase 46–50: Target 90/100
> Paste ke Claude Code. Kerjakan berurutan. Setiap task: implement → pnpm typecheck → pnpm test → git add -A → git commit → git push origin main

---

## PROMPT (paste ke Claude Code):

```
You are continuing EDITH v2 implementation.
Working directory: C:\Users\test\OneDrive\Desktop\EDITH

First run: git log --oneline -5

Implement ALL tasks below in order. After EVERY task:
  1. pnpm typecheck   → fix all errors before moving on
  2. pnpm test        → must not break existing tests
  3. git add -A
  4. git commit -m "..."
  5. git push origin main

Do NOT stop. Do NOT ask for confirmation. Fix TypeScript errors immediately.

════════════════════════════════════════════════════════════════
PHASE 46 — GATEWAY SPLIT (god file → route modules)
════════════════════════════════════════════════════════════════

GOAL: Break src/gateway/server.ts (42KB) into focused route modules.
      server.ts should become thin bootstrap only (<300 lines).
      All functionality must remain identical — this is pure refactor.

IMPORTANT: Do NOT break existing __gatewayTestUtils exports from server.ts.
           Tests import from server.js directly — keep that export intact.

─── Step 1: Create gateway/routes/ directory structure ───────────

Create these 6 new files. Extract the relevant handler code from server.ts
into each file. Each file exports a single registerX(app) function.

── FILE: src/gateway/routes/websocket.ts ────────────────────────

Extract the entire WebSocket /ws handler into this file.
This includes: attachAuthenticatedClient(), handle(), handleUserMessage(),
handleVoiceStart(), handleVoiceStop(), handleWakeWord(), stopVoiceSession(),
buildConnectedPayload(), buildStatusPayload(), and the voiceSessions Map.

The GatewayServer class still holds the clients Map and voiceSessions Map
as instance properties — pass them as constructor args or a context object.

Export:
  export function registerWebSocket(app: FastifyInstance, ctx: GatewayContext): void

Where GatewayContext is:
  export interface GatewayContext {
    clients: Map<string, SocketLike>
    voiceSessions: Map<string, () => void>
    stopVoiceSession: (userId: string, reason: string) => boolean
  }

── FILE: src/gateway/routes/webhooks.ts ─────────────────────────

Extract: GET /webhooks/whatsapp, POST /webhooks/whatsapp

Export:
  export function registerWebhooks(app: FastifyInstance): void

── FILE: src/gateway/routes/mobile.ts ───────────────────────────

Extract: POST /api/mobile/register-token, GET /api/sync/delta

Export:
  export function registerMobile(app: FastifyInstance): void

── FILE: src/gateway/routes/models.ts ───────────────────────────

Extract: GET /api/models, POST /api/models/select, DELETE /api/models/select

Export:
  export function registerModelRoutes(app: FastifyInstance): void

── FILE: src/gateway/routes/usage.ts ────────────────────────────

Extract: GET /api/usage/summary, GET /api/usage/global

Export:
  export function registerUsage(app: FastifyInstance): void

── FILE: src/gateway/routes/admin.ts ────────────────────────────

Extract: GET /metrics, GET /api/csrf-token, GET /api/channels/health,
         GET /health, POST /message

Export:
  export function registerAdmin(app: FastifyInstance): void

─── Step 2: Refactor server.ts registerRoutes() ─────────────────

Replace the big inline app.register(async (app) => { ... }) block with:

  private registerRoutes(): void {
    this.app.register(websocketPlugin)
    this.registerMiddleware()
    this.app.register(async (app) => {
      const ctx: GatewayContext = {
        clients: this.clients,
        voiceSessions: this.voiceSessions,
        stopVoiceSession: this.stopVoiceSession.bind(this),
      }
      registerWebSocket(app, ctx)
      registerWebhooks(app)
      registerMobile(app)
      registerModelRoutes(app)
      registerUsage(app)
      registerAdmin(app)

      if (config.OPENAI_COMPAT_API_ENABLED === 'true') {
        const { registerChatCompletions } = await import("../api/openai-compat/chat-completions.js")
        const { registerEmbeddings } = await import("../api/openai-compat/embeddings.js")
        const { registerModels } = await import("../api/openai-compat/models.js")
        registerChatCompletions(app)
        registerEmbeddings(app)
        registerModels(app)
        logger.info("openai-compat API routes registered")
      }
    })
  }

  private registerMiddleware(): void {
    // Move all addHook() calls here:
    // security headers, CORS, CSRF, rate limiting, API token auth
    // global error handler
  }

─── Step 3: Add route-level tests ───────────────────────────────

Create src/gateway/routes/__tests__/webhooks.test.ts:

  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import Fastify from 'fastify'
  import { registerWebhooks } from '../webhooks.js'

  vi.mock('../../../channels/whatsapp.js', () => ({
    whatsAppChannel: {
      verifyCloudWebhook: vi.fn().mockReturnValue({ ok: true, challenge: 'test_challenge' }),
      isCloudWebhookEnabled: vi.fn().mockReturnValue(false),
      handleCloudWebhookPayload: vi.fn().mockResolvedValue({ processed: 0, ignored: 1 }),
    }
  }))
  vi.mock('../../webhook-verifier.js', () => ({
    verifyWebhook: vi.fn().mockReturnValue(true),
  }))

  describe('registerWebhooks', () => {
    it('GET /webhooks/whatsapp responds to challenge', async () => {
      const app = Fastify()
      registerWebhooks(app)
      await app.ready()
      const res = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test&hub.challenge=test_challenge',
      })
      expect(res.statusCode).toBe(200)
    })
  })

Create src/gateway/routes/__tests__/usage.test.ts:

  import { describe, it, expect, vi } from 'vitest'
  import Fastify from 'fastify'
  import { registerUsage } from '../usage.js'

  vi.mock('../../auth-middleware.js', () => ({
    authenticateWebSocket: vi.fn().mockResolvedValue({ userId: 'owner' }),
  }))
  vi.mock('../../../multiuser/manager.js', () => ({
    multiUser: { isOwner: vi.fn().mockReturnValue(true) }
  }))
  vi.mock('../../../observability/usage-tracker.js', () => ({
    usageTracker: { getUserSummary: vi.fn().mockResolvedValue({ messages: 0, tokens: 0 }) }
  }))

  describe('registerUsage', () => {
    it('GET /api/usage/summary returns 401 without token', async () => {
      const app = Fastify()
      registerUsage(app)
      await app.ready()
      const res = await app.inject({ method: 'GET', url: '/api/usage/summary' })
      expect(res.statusCode).toBe(401)
    })
  })

Commit: "refactor(gateway): split 42KB god file into gateway/routes/ — websocket, webhooks, mobile, models, usage, admin"

════════════════════════════════════════════════════════════════
PHASE 47 — EXTENSIONS: REAL IMPLEMENTATIONS
════════════════════════════════════════════════════════════════

Current state: all 4 extensions have src/index.ts but it's a 500B stub with
hooks: [] and onLoad() no-op. Need real tool implementations.

─── Extension: @edith/ext-zalo ──────────────────────────────────

Create extensions/zalo/src/channel.ts:

  /**
   * Zalo OA (Official Account) channel — Vietnamese messaging platform.
   * API: https://developers.zalo.me/docs/api/official-account-api
   */
  import { createLogger } from '../../../src/logger.js'
  const log = createLogger('ext.zalo')

  export interface ZaloConfig { accessToken: string; oaId: string; webhookSecret?: string }
  export interface ZaloMessage { sender: { id: string }; message: { text: string; mid: string }; timestamp: number }

  export class ZaloChannel {
    private readonly BASE = 'https://openapi.zalo.me/v3.0'
    constructor(private readonly cfg: ZaloConfig) {}

    private get headers() { return { 'access_token': this.cfg.accessToken, 'Content-Type': 'application/json' } }

    async send(recipientId: string, text: string): Promise<void> {
      const res = await fetch(`${this.BASE}/oa/message/cs`, {
        method: 'POST', headers: this.headers,
        body: JSON.stringify({ recipient: { user_id: recipientId }, message: { text } }),
      })
      if (!res.ok) throw new Error(`Zalo send failed: ${res.status}`)
      log.debug('sent', { recipientId, len: text.length })
    }

    async getUserProfile(userId: string): Promise<{ name: string; avatar: string } | null> {
      try {
        const res = await fetch(`${this.BASE}/oa/getprofile?user_id=${userId}`, { headers: this.headers })
        if (!res.ok) return null
        const d = await res.json() as { data?: { display_name: string; avatar: string } }
        return d.data ? { name: d.data.display_name, avatar: d.data.avatar } : null
      } catch { return null }
    }

    verifyWebhook(body: string, sig: string): boolean {
      if (!this.cfg.webhookSecret) return true
      const { createHmac } = await import('node:crypto')  // use top-level import instead
      // NOTE: replace with static import at top of file
      return true // placeholder — implement with node:crypto createHmac
    }

    parseWebhook(body: unknown): ZaloMessage | null {
      try {
        const p = body as { entry?: Array<{ messaging?: ZaloMessage[] }> }
        return p?.entry?.[0]?.messaging?.[0] ?? null
      } catch { return null }
    }
  }

IMPORTANT: In verifyWebhook, use static import `import { createHmac } from 'node:crypto'`
at top of file (not dynamic import). The placeholder above is wrong.

Correct implementation:
  import { createHmac } from 'node:crypto'
  // ...
  verifyWebhook(body: string, sig: string): boolean {
    if (!this.cfg.webhookSecret) return true
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(body).digest('hex')
    return expected === sig
  }

Update extensions/zalo/src/index.ts to export ZaloChannel and wire onLoad:

  import { createLogger } from '../../../src/logger.js'
  import type { Hook } from '../../../src/hooks/registry.js'
  import { ZaloChannel } from './channel.js'

  export { ZaloChannel } from './channel.js'
  export type { ZaloConfig, ZaloMessage } from './channel.js'

  export const name = 'zalo'
  export const version = '0.1.0'
  export const description = 'Zalo OA messaging channel for Vietnamese users'

  const log = createLogger('ext.zalo')
  let channel: ZaloChannel | null = null

  export const hooks: Hook[] = []

  export async function onLoad(): Promise<void> {
    const token = process.env.ZALO_ACCESS_TOKEN
    const oaId = process.env.ZALO_OA_ID
    if (!token || !oaId) {
      log.debug('ZALO_ACCESS_TOKEN or ZALO_OA_ID not set — skipping')
      return
    }
    channel = new ZaloChannel({ accessToken: token, oaId, webhookSecret: process.env.ZALO_WEBHOOK_SECRET })
    log.info('Zalo channel loaded', { oaId })
  }

  export function getChannel(): ZaloChannel | null { return channel }

Commit: "feat(ext-zalo): implement ZaloChannel with send, getUserProfile, webhook verify"

─── Extension: @edith/ext-notion ────────────────────────────────

Create extensions/notion/src/tool.ts:

  import { createLogger } from '../../../src/logger.js'
  const log = createLogger('ext.notion')
  const API = 'https://api.notion.com/v1'
  const VER = '2022-06-28'

  type RichText = { plain_text: string }
  type Block = { type: string; [key: string]: unknown }
  type PageResult = { id: string; url: string; properties?: Record<string, unknown>; title?: RichText[] }

  export class NotionTool {
    constructor(private readonly key: string) {}

    private get h() { return { Authorization: `Bearer ${this.key}`, 'Notion-Version': VER, 'Content-Type': 'application/json' } }

    async searchPages(query: string, limit = 10): Promise<Array<{ id: string; title: string; url: string }>> {
      const r = await fetch(`${API}/search`, { method: 'POST', headers: this.h, body: JSON.stringify({ query, page_size: limit }) })
      if (!r.ok) throw new Error(`Notion search failed: ${r.status}`)
      const d = await r.json() as { results: PageResult[] }
      return d.results.map(p => ({ id: p.id, title: this.title(p), url: p.url }))
    }

    async getPage(id: string): Promise<{ title: string; content: string; url: string }> {
      const [page, blocks] = await Promise.all([
        fetch(`${API}/pages/${id}`, { headers: this.h }).then(r => r.json()) as Promise<PageResult>,
        fetch(`${API}/blocks/${id}/children`, { headers: this.h }).then(r => r.json()) as Promise<{ results: Block[] }>,
      ])
      return { title: this.title(page), content: this.blocksText(blocks.results), url: page.url }
    }

    async appendToPage(id: string, text: string): Promise<void> {
      await fetch(`${API}/blocks/${id}/children`, {
        method: 'PATCH', headers: this.h,
        body: JSON.stringify({ children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }] }),
      })
      log.debug('appended', { id, len: text.length })
    }

    async createPage(dbId: string, title: string, content: string): Promise<string> {
      const r = await fetch(`${API}/pages`, {
        method: 'POST', headers: this.h,
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties: { title: { title: [{ text: { content: title } }] } },
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }],
        }),
      })
      if (!r.ok) throw new Error(`Notion create failed: ${r.status}`)
      return ((await r.json()) as { id: string }).id
    }

    private title(p: PageResult): string {
      if (p.properties) {
        for (const v of Object.values(p.properties)) {
          const prop = v as { type?: string; title?: RichText[] }
          if (prop.type === 'title' && prop.title?.[0]) return prop.title[0].plain_text
        }
      }
      return p.title?.[0]?.plain_text ?? 'Untitled'
    }

    private blocksText(blocks: Block[]): string {
      return blocks.map(b => {
        const content = b[b.type as string] as { rich_text?: RichText[] } | undefined
        return content?.rich_text?.map(t => t.plain_text).join('') ?? ''
      }).filter(Boolean).join('\n')
    }
  }

Update extensions/notion/src/index.ts:

  import { createLogger } from '../../../src/logger.js'
  import type { Hook } from '../../../src/hooks/registry.js'
  import { NotionTool } from './tool.js'

  export { NotionTool } from './tool.js'
  export const name = 'notion'
  export const version = '0.1.0'
  export const description = 'Notion workspace integration — search, read, write pages'

  const log = createLogger('ext.notion')
  let tool: NotionTool | null = null
  export const hooks: Hook[] = []

  export async function onLoad(): Promise<void> {
    const key = process.env.NOTION_API_KEY
    if (!key) { log.debug('NOTION_API_KEY not set — skipping'); return }
    tool = new NotionTool(key)
    log.info('Notion tool loaded')
  }

  export function getTool(): NotionTool | null { return tool }

Commit: "feat(ext-notion): implement NotionTool with search, getPage, appendToPage, createPage"

─── Extension: @edith/ext-github ────────────────────────────────

Create extensions/github/src/tool.ts:

  import { createLogger } from '../../../src/logger.js'
  const log = createLogger('ext.github')
  const API = 'https://api.github.com'

  export class GitHubTool {
    constructor(private readonly token: string) {}

    private get h() { return { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github.v3+json', 'X-GitHub-Api-Version': '2022-11-28' } }

    async getRepo(owner: string, repo: string) {
      const r = await fetch(`${API}/repos/${owner}/${repo}`, { headers: this.h })
      if (!r.ok) throw new Error(`GitHub getRepo failed: ${r.status}`)
      const d = await r.json() as { name: string; description: string; stargazers_count: number; open_issues_count: number; html_url: string }
      return { name: d.name, description: d.description, stars: d.stargazers_count, openIssues: d.open_issues_count, url: d.html_url }
    }

    async listOpenIssues(owner: string, repo: string, limit = 10) {
      const r = await fetch(`${API}/repos/${owner}/${repo}/issues?state=open&per_page=${limit}`, { headers: this.h })
      if (!r.ok) throw new Error(`GitHub listIssues failed: ${r.status}`)
      const d = await r.json() as Array<{ number: number; title: string; html_url: string; labels: Array<{ name: string }> }>
      return d.map(i => ({ number: i.number, title: i.title, url: i.html_url, labels: i.labels.map(l => l.name) }))
    }

    async listOpenPRs(owner: string, repo: string, limit = 10) {
      const r = await fetch(`${API}/repos/${owner}/${repo}/pulls?state=open&per_page=${limit}`, { headers: this.h })
      if (!r.ok) throw new Error(`GitHub listPRs failed: ${r.status}`)
      const d = await r.json() as Array<{ number: number; title: string; user: { login: string }; html_url: string; draft: boolean }>
      return d.map(p => ({ number: p.number, title: p.title, author: p.user.login, url: p.html_url, draft: p.draft }))
    }

    async createIssue(owner: string, repo: string, title: string, body: string, labels: string[] = []): Promise<number> {
      const r = await fetch(`${API}/repos/${owner}/${repo}/issues`, {
        method: 'POST', headers: this.h, body: JSON.stringify({ title, body, labels })
      })
      if (!r.ok) throw new Error(`GitHub createIssue failed: ${r.status}`)
      const d = await r.json() as { number: number }
      log.info('issue created', { owner, repo, number: d.number })
      return d.number
    }

    async getLatestCommits(owner: string, repo: string, limit = 5) {
      const r = await fetch(`${API}/repos/${owner}/${repo}/commits?per_page=${limit}`, { headers: this.h })
      if (!r.ok) throw new Error(`GitHub getCommits failed: ${r.status}`)
      const d = await r.json() as Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>
      return d.map(c => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0] ?? '', author: c.commit.author.name, date: c.commit.author.date }))
    }

    async getMyRepos(limit = 20) {
      const r = await fetch(`${API}/user/repos?sort=pushed&per_page=${limit}`, { headers: this.h })
      if (!r.ok) throw new Error(`GitHub getMyRepos failed: ${r.status}`)
      const d = await r.json() as Array<{ name: string; full_name: string; private: boolean; stargazers_count: number; html_url: string }>
      return d.map(r => ({ name: r.name, fullName: r.full_name, private: r.private, stars: r.stargazers_count, url: r.html_url }))
    }
  }

Update extensions/github/src/index.ts:

  import { createLogger } from '../../../src/logger.js'
  import { GitHubTool } from './tool.js'
  import type { Hook } from '../../../src/hooks/registry.js'

  export { GitHubTool } from './tool.js'
  export const name = 'github'
  export const version = '0.1.0'
  export const description = 'GitHub — repos, issues, PRs, commits'

  const log = createLogger('ext.github')
  let tool: GitHubTool | null = null

  export const hooks: Hook[] = [
    {
      name: 'github-context-inject',
      type: 'pre_message',
      priority: 5,
      handler: async (ctx) => ctx, // Future: inject active PR/issue context
    },
  ]

  export async function onLoad(): Promise<void> {
    const token = process.env.GITHUB_TOKEN
    if (!token) { log.debug('GITHUB_TOKEN not set — skipping'); return }
    tool = new GitHubTool(token)
    log.info('GitHub tool loaded')
  }

  export function getTool(): GitHubTool | null { return tool }

Commit: "feat(ext-github): implement GitHubTool with repo, issues, PRs, commits, createIssue, getMyRepos"

─── Extension: @edith/ext-home-assistant ────────────────────────

Create extensions/home-assistant/src/tool.ts:

  import { createLogger } from '../../../src/logger.js'
  const log = createLogger('ext.home-assistant')

  export interface HAConfig { baseUrl: string; token: string }
  export interface HAEntity { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed: string }
  export interface HAServiceCall { domain: string; service: string; data: Record<string, unknown> }

  export class HomeAssistantTool {
    constructor(private readonly cfg: HAConfig) {}

    private get h() { return { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' } }
    private url(p: string) { return `${this.cfg.baseUrl}/api${p}` }

    async isOnline(): Promise<boolean> {
      try {
        const r = await fetch(this.url('/'), { headers: this.h, signal: AbortSignal.timeout(3000) })
        return r.ok
      } catch { return false }
    }

    async getStates(): Promise<HAEntity[]> {
      const r = await fetch(this.url('/states'), { headers: this.h })
      if (!r.ok) throw new Error(`HA getStates failed: ${r.status}`)
      return r.json() as Promise<HAEntity[]>
    }

    async getState(entityId: string): Promise<HAEntity> {
      const r = await fetch(this.url(`/states/${entityId}`), { headers: this.h })
      if (!r.ok) throw new Error(`HA getState failed: ${r.status} for ${entityId}`)
      return r.json() as Promise<HAEntity>
    }

    async callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
      const r = await fetch(this.url(`/services/${domain}/${service}`), {
        method: 'POST', headers: this.h, body: JSON.stringify(data)
      })
      if (!r.ok) throw new Error(`HA service call failed: ${r.status}`)
      log.debug('service called', { domain, service, data })
    }

    async turnOn(entityId: string): Promise<void> {
      await this.callService(entityId.split('.')[0]!, 'turn_on', { entity_id: entityId })
    }

    async turnOff(entityId: string): Promise<void> {
      await this.callService(entityId.split('.')[0]!, 'turn_off', { entity_id: entityId })
    }

    async toggle(entityId: string): Promise<void> {
      await this.callService(entityId.split('.')[0]!, 'toggle', { entity_id: entityId })
    }

    async setLight(entityId: string, opts: { brightness?: number; colorTemp?: number; rgbColor?: [number, number, number] }): Promise<void> {
      await this.callService('light', 'turn_on', { entity_id: entityId, ...opts })
    }

    async setClimate(entityId: string, temperature: number): Promise<void> {
      await this.callService('climate', 'set_temperature', { entity_id: entityId, temperature })
    }

    async getLights(): Promise<HAEntity[]> {
      const all = await this.getStates()
      return all.filter(e => e.entity_id.startsWith('light.'))
    }

    async getSensors(): Promise<HAEntity[]> {
      const all = await this.getStates()
      return all.filter(e => e.entity_id.startsWith('sensor.'))
    }

    async getHistory(entityId: string, hours = 24): Promise<Array<{ state: string; last_changed: string }>> {
      const start = new Date(Date.now() - hours * 3600_000).toISOString()
      const r = await fetch(this.url(`/history/period/${start}?filter_entity_id=${entityId}`), { headers: this.h })
      if (!r.ok) return []
      const d = await r.json() as Array<Array<{ state: string; last_changed: string }>>
      return d[0] ?? []
    }
  }

Update extensions/home-assistant/src/index.ts:

  import { createLogger } from '../../../src/logger.js'
  import { HomeAssistantTool } from './tool.js'
  import type { Hook } from '../../../src/hooks/registry.js'

  export { HomeAssistantTool } from './tool.js'
  export type { HAEntity, HAConfig, HAServiceCall } from './tool.js'
  export const name = 'home-assistant'
  export const version = '0.1.0'
  export const description = 'Home Assistant — entity states, service calls, automation'

  const log = createLogger('ext.home-assistant')
  let tool: HomeAssistantTool | null = null
  export const hooks: Hook[] = []

  export async function onLoad(): Promise<void> {
    const url = process.env.HA_BASE_URL
    const token = process.env.HA_TOKEN
    if (!url || !token) { log.debug('HA_BASE_URL or HA_TOKEN not set — skipping'); return }
    tool = new HomeAssistantTool({ baseUrl: url, token })
    const online = await tool.isOnline()
    log.info(online ? 'Home Assistant connected' : 'Home Assistant unreachable', { url })
  }

  export function getTool(): HomeAssistantTool | null { return tool }

Commit: "feat(ext-home-assistant): implement HomeAssistantTool with states, lights, climate, history"

─── Add extension unit tests ─────────────────────────────────────

Create extensions/github/src/__tests__/tool.test.ts:

  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { GitHubTool } from '../tool.js'

  const mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)

  describe('GitHubTool', () => {
    let tool: GitHubTool

    beforeEach(() => {
      tool = new GitHubTool('fake-token')
      mockFetch.mockReset()
    })

    it('getRepo returns parsed repo data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'myrepo', description: 'desc', stargazers_count: 5, open_issues_count: 2, html_url: 'https://github.com/u/myrepo' }),
      })
      const r = await tool.getRepo('u', 'myrepo')
      expect(r.name).toBe('myrepo')
      expect(r.stars).toBe(5)
    })

    it('createIssue returns issue number', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ number: 42 }) })
      const n = await tool.createIssue('u', 'r', 'Bug', 'body')
      expect(n).toBe(42)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      await expect(tool.getRepo('u', 'r')).rejects.toThrow('404')
    })
  })

Create extensions/home-assistant/src/__tests__/tool.test.ts:

  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { HomeAssistantTool } from '../tool.js'

  const mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)

  describe('HomeAssistantTool', () => {
    let tool: HomeAssistantTool

    beforeEach(() => {
      tool = new HomeAssistantTool({ baseUrl: 'http://ha.local:8123', token: 'fake' })
      mockFetch.mockReset()
    })

    it('isOnline returns true on 200', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })
      expect(await tool.isOnline()).toBe(true)
    })

    it('isOnline returns false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      expect(await tool.isOnline()).toBe(false)
    })

    it('getLights filters to light.* entities', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { entity_id: 'light.bedroom', state: 'on', attributes: {}, last_changed: '' },
          { entity_id: 'sensor.temp', state: '22', attributes: {}, last_changed: '' },
        ]
      })
      const lights = await tool.getLights()
      expect(lights).toHaveLength(1)
      expect(lights[0]!.entity_id).toBe('light.bedroom')
    })
  })

Commit: "test(extensions): add unit tests for GitHubTool and HomeAssistantTool"

════════════════════════════════════════════════════════════════
PHASE 48 — README REWRITE
════════════════════════════════════════════════════════════════

Current README.md is only 382 bytes. Completely replace it with:

FILE: README.md (overwrite entirely)

  # EDITH

  > Personal AI companion — runs locally, multi-channel, learns from every interaction.

  [![CI](https://github.com/<your-username>/EDITH/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-username>/EDITH/actions)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-22-green.svg)](https://nodejs.org/)

  ## What is EDITH?

  EDITH is a self-hosted personal AI assistant that:

  - Runs on your machine with your own API keys — no cloud dependency
  - Connects to WhatsApp, Telegram, Discord, Slack, and more from one place
  - Learns from every conversation using MemRL (Memory Reinforcement Learning)
  - Reasons using LATS (Language Agent Tree Search) for complex tasks
  - Adapts its personality and tone to each user and context
  - Monitors your email, calendar, finances, and home automatically

  ## Prerequisites

  - Node.js 22+
  - pnpm 10+
  - At least one LLM API key (Anthropic, OpenAI, Gemini, Groq, or Ollama)
  - SQLite (bundled via Prisma — no setup needed)

  ## Quick Start

  ```bash
  # 1. Clone and install
  git clone https://github.com/<your-username>/EDITH
  cd EDITH
  pnpm install

  # 2. Interactive setup (recommended)
  pnpm onboard

  # 3. Start
  pnpm dev               # text mode (CLI)
  pnpm gateway           # gateway mode (WebSocket + HTTP)
  pnpm all               # both
  ```

  ## Channel Setup

  | Channel | Guide | Required Env Vars |
  |---------|-------|-------------------|
  | WhatsApp (Baileys) | [docs/channels/whatsapp.md](docs/channels/whatsapp.md) | `WHATSAPP_ENABLED=true` |
  | WhatsApp (Cloud API) | [docs/channels/whatsapp.md](docs/channels/whatsapp.md) | `WHATSAPP_CLOUD_ACCESS_TOKEN` |
  | Telegram | [docs/channels/telegram.md](docs/channels/telegram.md) | `TELEGRAM_BOT_TOKEN` |
  | Discord | [docs/channels/discord.md](docs/channels/discord.md) | `DISCORD_BOT_TOKEN` |
  | Slack | — | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` |
  | Signal | — | `SIGNAL_PHONE_NUMBER`, `SIGNAL_CLI_PATH` |
  | Gmail | — | `GMAIL_CLIENT_ID`, `GMAIL_REFRESH_TOKEN` |

  ## Architecture Overview

  ```
  User Message (any channel)
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │              Message Pipeline               │
  │  0a. DM Policy  →  0b. Pre-hooks           │
  │  1.  Input Safety (CaMeL prompt filter)     │
  │  2.  Memory Retrieval (LanceDB + MemRL)     │
  │  3.  Persona Detection                      │
  │  4.  System Prompt Assembly                 │
  │  5.  LLM Generation (orchestrator)          │
  │  6.  Response Critique & Refinement         │
  │  7.  Output Safety Scan                     │
  │  8.  Persistence (DB + vector store)        │
  │  9.  Async Side Effects + Post-hooks        │
  └─────────────────────────────────────────────┘
        │
        ▼
    Response (back to user's channel)
  ```

  **Core Systems:**
  - **Memory:** LanceDB vector store + MemRL Q-value scoring + causal graph
  - **Reasoning:** LATS (Language Agent Tree Search) for complex multi-step tasks
  - **Security:** CaMeL, DM policy, audit trail, prompt injection detection
  - **Personalization:** Per-user personality engine, habit model, preference inference
  - **Protocols:** Morning briefing, evening summary, SITREP on demand

  ## Environment Variables

  See [docs/reference/env.md](docs/reference/) for the full list. Minimum required:

  ```env
  ANTHROPIC_API_KEY=sk-ant-...   # or any other provider key
  DEFAULT_USER_ID=your-name
  ```

  ## Development

  ```bash
  pnpm test           # run all tests
  pnpm typecheck      # TypeScript check
  pnpm lint           # oxlint
  pnpm doctor         # health check all subsystems
  pnpm test:coverage  # coverage report
  ```

  ## Extensions

  EDITH supports extensions for external services. Available extensions:

  | Extension | Description |
  |-----------|-------------|
  | `@edith/ext-zalo` | Zalo OA messaging (Vietnamese users) |
  | `@edith/ext-notion` | Notion workspace — search, read, write |
  | `@edith/ext-github` | GitHub — repos, issues, PRs, commits |
  | `@edith/ext-home-assistant` | Home Assistant smart home control |

  Load extensions by adding them to `.edith/plugins/` or via the plugin SDK.

  ## Project Structure

  ```
  src/
    core/           Message pipeline, startup, event bus
    memory/         LanceDB store, MemRL, causal graph, profiler
    engines/        LLM orchestrator, LATS planner, model routing
    security/       CaMeL, audit, prompt filter, output scanner
    channels/       WhatsApp, Telegram, Discord, Slack, Email, ...
    gateway/        WebSocket + HTTP transport (Fastify)
    protocols/      Morning briefing, evening summary, SITREP
    background/     Daemon, habit model, self-monitor
    finance/        Expense tracker, crypto portfolio, subscriptions
    ambient/        Weather, market, news, calendar watcher
    predictive/     Intent predictor, pre-fetcher, pattern learner
    comm-intel/     Screener, meeting prep, relationship graph
    hooks/          Pre/post message hook pipeline
    extensions/     Extension registry and loader
  extensions/
    zalo/           Zalo OA channel
    notion/         Notion workspace
    github/         GitHub integration
    home-assistant/ Home Assistant control
  ```

  ## License

  MIT — see [LICENSE](LICENSE)

Commit: "docs: rewrite README — architecture overview, quick start, channel table, project structure"

════════════════════════════════════════════════════════════════
PHASE 49 — PLUGIN SDK COMPLETION
════════════════════════════════════════════════════════════════

packages/plugin-sdk currently: types.ts (1.1KB) + registry.ts (0.5KB) + index.ts.
Missing: loader.ts that links to src/plugin-sdk/loader.ts, and no bridge between
packages/plugin-sdk and src/plugin-sdk/loader.ts.

─── Task 49.1: Add loader bridge to packages/plugin-sdk ─────────

Create packages/plugin-sdk/src/loader.ts:

  /**
   * @file loader.ts
   * @description Re-export of the EDITH plugin loader for use by external extensions.
   * Extensions should import from '@edith/plugin-sdk' not from internal paths.
   */

  // NOTE: This is a type-only bridge for the SDK package.
  // The runtime loader lives in src/plugin-sdk/loader.ts (internal).
  // External extensions use these types to implement their plugin contract.

  export interface PluginLoadResult {
    name: string
    version: string
    hookCount: number
    loadedAt: Date
  }

  export interface PluginManifestV2 {
    name: string
    version: string
    description: string
    type: 'channel' | 'tool' | 'skill' | 'hook' | 'composite'
    enabled?: boolean
    requiredEnvVars?: string[]
    /** Minimum EDITH version required */
    minEdithVersion?: string
  }

  export interface EDITHPluginV2 {
    readonly name: string
    readonly version: string
    readonly manifest?: PluginManifestV2
    hooks?: import('./types.js').BaseHook[]
    onLoad?: () => Promise<void>
    onUnload?: () => Promise<void>
  }

Create packages/plugin-sdk/src/types.ts additions — add BaseHook type:
(open existing file and add at the bottom)

  export interface BaseHook {
    name: string
    type: 'pre_message' | 'post_message' | 'pre_tool' | 'post_tool' | 'pre_send' | 'post_send'
    priority: number
    handler: (context: HookContext) => Promise<HookContext>
  }

  export interface HookContext {
    userId: string
    channel: string
    content: string
    metadata: Record<string, unknown>
    abort?: boolean
    abortReason?: string
  }

Update packages/plugin-sdk/src/index.ts to export everything:

  export * from './types.js'
  export * from './registry.js'
  export * from './loader.js'

─── Task 49.2: Add SDK tests ─────────────────────────────────────

Create packages/plugin-sdk/src/__tests__/registry.test.ts:

  import { describe, it, expect, beforeEach } from 'vitest'
  import { ExtensionRegistry } from '../registry.js'

  describe('ExtensionRegistry', () => {
    let registry: ExtensionRegistry

    beforeEach(() => { registry = new ExtensionRegistry() })

    it('registers and lists extensions', () => {
      registry.register({ name: 'test', version: '1.0.0', description: 'test', type: 'tool' })
      expect(registry.list()).toHaveLength(1)
    })

    it('gets extension by name', () => {
      registry.register({ name: 'my-ext', version: '1.0.0', description: 'x', type: 'hook' })
      expect(registry.get('my-ext')?.name).toBe('my-ext')
    })

    it('returns undefined for missing extension', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })

    it('overrides on duplicate name', () => {
      registry.register({ name: 'dup', version: '1.0.0', description: 'v1', type: 'tool' })
      registry.register({ name: 'dup', version: '2.0.0', description: 'v2', type: 'tool' })
      expect(registry.list()).toHaveLength(1)
      expect(registry.get('dup')?.version).toBe('2.0.0')
    })
  })

Commit: "feat(plugin-sdk): add loader.ts, BaseHook types, HookContext, registry tests"

════════════════════════════════════════════════════════════════
PHASE 50 — PRODUCTION BUILD + DOCKER + DOCTOR IMPROVEMENTS
════════════════════════════════════════════════════════════════

─── Task 50.1: Verify production build works ─────────────────────

Run: pnpm build
If it fails, fix tsup.config.ts or package.json build script until:
  - pnpm build succeeds with 0 errors
  - dist/main.js is generated
  - pnpm start runs without crashing (test for 3 seconds then ctrl+c)

Check that tsup.config.ts (or build script in package.json) has:
  entry: ['src/main.ts']
  format: ['esm']
  dts: false    ← set to false if dts generation is slow/broken
  external: ['playwright', '@lancedb/lancedb', 'prisma', '@prisma/client']
  sourcemap: true

If tsup.config.ts doesn't exist, create it:

  import { defineConfig } from 'tsup'
  export default defineConfig({
    entry: ['src/main.ts'],
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: true,
    external: ['playwright', '@lancedb/lancedb', 'prisma', '@prisma/client', 'baileys'],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  })

Commit: "build: fix tsup config — production build verified working"

─── Task 50.2: Add Dockerfile ────────────────────────────────────

Create Dockerfile in project root:

  # syntax=docker/dockerfile:1
  FROM node:22-alpine AS base
  RUN npm install -g pnpm@10

  FROM base AS deps
  WORKDIR /app
  COPY package.json pnpm-lock.yaml ./
  COPY prisma ./prisma
  RUN pnpm install --frozen-lockfile --prod

  FROM base AS builder
  WORKDIR /app
  COPY . .
  RUN pnpm install --frozen-lockfile
  RUN pnpm build

  FROM node:22-alpine AS runner
  RUN npm install -g pnpm@10
  WORKDIR /app
  ENV NODE_ENV=production

  COPY --from=deps /app/node_modules ./node_modules
  COPY --from=builder /app/dist ./dist
  COPY --from=builder /app/prisma ./prisma
  COPY --from=builder /app/package.json ./
  COPY --from=builder /app/workspace ./workspace

  RUN npx prisma generate

  EXPOSE 18789 8080

  HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://localhost:18789/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

  CMD ["node", "dist/main.js", "--mode", "gateway"]

Create .dockerignore:

  node_modules
  dist
  .git
  .env
  *.log
  coverage
  .edith/logs
  edith.db
  edith.db-shm
  edith.db-wal

─── Task 50.3: Improve pnpm doctor output ────────────────────────

Open src/cli/doctor.ts. Add checks for:
  1. gateway reachability (try fetch http://127.0.0.1:GATEWAY_PORT/health with 2s timeout)
  2. database file exists and is readable
  3. at least one API key configured
  4. workspace/SOUL.md exists
  5. .env file exists (warn if missing, don't error)

If doctor.ts already has these checks, verify they actually run and
the output uses ✅ / ⚠️ / ❌ symbols clearly.

Commit: "feat(docker): add Dockerfile + .dockerignore; feat(doctor): add gateway, db, api-key, workspace checks"

════════════════════════════════════════════════════════════════
FINAL VERIFICATION
════════════════════════════════════════════════════════════════

After all tasks complete, run:
  1. pnpm typecheck         → 0 errors
  2. pnpm test              → all pass
  3. pnpm build             → dist/main.js generated
  4. git log --oneline -20  → verify all commits present
  5. git push origin main

Output completion table:
  Phase 46 (gateway split):      done / partial / skipped
  Phase 47 (extensions):         N/4 implemented
  Phase 48 (README):             done / skipped
  Phase 49 (plugin-sdk):         done / skipped
  Phase 50 (build/docker):       done / partial / skipped
  TypeScript errors:             N
  Tests passing:                 N/N
  server.ts size after split:    ~XKB (target: <10KB)
```

---

## Kalau Claude Code berhenti di tengah:

```
Continue EDITH Phase 46-50 implementation.
Run: git log --oneline -15 to see what's done.
Resume from last incomplete task in PHASE-46-50.md.
After each task: pnpm typecheck → pnpm test → git add -A → git commit → git push origin main
```

---

## Proyeksi skor setelah selesai:

| Dimensi | Sekarang | Target |
|---------|---------|--------|
| Gateway / Infra | 35 | 72 (split done) |
| Extensions | 20 | 70 (real code) |
| Documentation | 20 | 65 (README + arch) |
| Plugin SDK | 40 | 70 (loader + tests) |
| Production Readiness | 40 | 68 (Dockerfile + build) |
| **Overall** | **67** | **~85** |

Sisa 5 poin menuju 90 = PostgreSQL migration path + architecture diagram + coverage >60% aktual.

---
*EDITH v2 — Phase 46–50 | Generated 2026-03-09*