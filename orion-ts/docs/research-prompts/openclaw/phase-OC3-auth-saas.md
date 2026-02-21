# Phase OC-3 — Auth Hardening + SaaS Foundation

## OpenClaw Auth (dari docs.openclaw.ai/channels + source)

### DM Pairing Flow (per-channel default)
```
Unknown sender kirim pesan ke channel
    ↓
Gateway check: sender known? (device token / allowlist)
    ↓ NO
Kirim pairing code response, DROP pesan (tidak diproses agent)
    ↓
User kirim /pair [code] dari authorized interface (CLI/WebUI)
    ↓
Gateway validate code (TTL 5 menit)
    ↓
Sender approved → added ke session trusted senders
    ↓
Subsequent messages dari sender ini diproses normal
```

### Config per-channel (dari openclaw.json schema):
```json
{
  "channels": {
    "whatsapp": {
      "dmPolicy": "pairing",     // pairing | allowlist | open
      "allowFrom": ["+1555..."], // untuk allowlist mode
      "groupPolicy": "allowlist",
      "groups": {
        "GROUP_ID@g.us": {
          "requireMention": true
        }
      },
      "ackReaction": {
        "emoji": "👀",
        "direct": true,
        "group": "mentions"
      }
    },
    "telegram": {
      "dmPolicy": "pairing"
    }
  }
}
```

### Tool Policy + Sandboxing
- Default: tools run on HOST untuk main session
- Non-main sessions (groups): `agents.defaults.sandbox.mode: "non-main"` → Docker
- Elevated tools: require explicit enable
- Tool policy per-agent, per-session

### SaaS Multi-Tenant Architecture

OpenClaw per-design adalah single-user.
Untuk SaaS/multi-tenant, pakai lifecycle hooks + workspace isolation:

```
Per-user workspace:
  /data/users/{userId}/workspace/
    SOUL.md         ← per-user customizable
    AGENTS.md       ← per-tenant configurable
    USER.md         ← per-user auto-updated
    MEMORY.md       ← per-user memory
    skills/         ← per-user skills
```

Hook `agent:bootstrap` → swap workspace path per request/session.
Ini yang bikin satu Orion instance serve banyak users.

## Paper Backing

**AURA: Affordance-Understanding and Risk-aware Alignment** (arXiv 2508.06124, Aug 2025)
"Model last" philosophy — don't rely on LLM for security enforcement.
Auth hardening adalah architectural layer, BUKAN prompt layer.

**OpenClaw Security Audit** (vallettasoftware.com, Feb 2026)
CVE-2026-25253 (CVSS 8.8): WebSocket gateway token leak via malicious page.
Lesson: Token JANGAN exposed ke browser, validation HARUS server-side.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Implement auth hardening dan SaaS foundation.
Reference: docs.openclaw.ai/concepts/security, vallettasoftware.com/blog/post/openclaw-2026-guide
Paper: arXiv 2508.06124

### TASK: Phase OC-3 — Auth Hardening + SaaS Foundation

Target files:
- src/pairing/device-store.ts (buat baru — production auth)
- src/pairing/manager.ts (upgrade existing)
- src/config/orion-config.ts (buat baru — schema-validated config)
- prisma/schema.prisma (tambah DeviceToken model)
- src/core/workspace-resolver.ts (buat baru — untuk SaaS multi-tenant)

#### Step 1: Update Prisma Schema

Di `prisma/schema.prisma`, tambahkan:
```prisma
model DeviceToken {
  id         String   @id @default(cuid())
  tokenHash  String   @unique  // SHA-256 hashed — NEVER store raw
  userId     String
  channel    String
  deviceName String   @default("unknown")
  createdAt  DateTime @default(now())
  lastUsed   DateTime @updatedAt
  revokedAt  DateTime?

  @@index([userId])
}

model PairingSession {
  id        String   @id @default(cuid())
  code      String   @unique  // 6-digit, plain (short-lived)
  userId    String
  channel   String
  expiresAt DateTime
  used      Boolean  @default(false)
}
```

Jalankan: `npx prisma migrate dev --name add-auth-tables`

#### Step 2: Buat src/pairing/device-store.ts

```typescript
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import crypto from "node:crypto"

const log = createLogger("pairing.device-store")

const PAIRING_CODE_EXPIRE_MS = 5 * 60 * 1000  // 5 menit (matches OpenClaw)
const TOKEN_BYTES = 32                          // 64 hex chars
const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 15 * 60 * 1000       // 15 menit throttle window

// In-memory throttle map (reset on restart — acceptable for persona use)
const failureMap = new Map<string, { count: number; windowStart: number }>()

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function clientId(tokenPrefix: string): string {
  return tokenPrefix.slice(0, 8)  // first 8 chars for throttle key
}

function isThrottled(id: string): boolean {
  const entry = failureMap.get(id)
  if (!entry) return false
  if (Date.now() - entry.windowStart > FAILURE_WINDOW_MS) {
    failureMap.delete(id)
    return false
  }
  return entry.count >= MAX_FAILURES
}

function recordFailure(id: string): void {
  const entry = failureMap.get(id)
  if (!entry || Date.now() - entry.windowStart > FAILURE_WINDOW_MS) {
    failureMap.set(id, { count: 1, windowStart: Date.now() })
  } else {
    entry.count++
  }
}

export interface AuthResult {
  userId: string
  channel: string
}

export const deviceStore = {
  /** Generate 6-digit pairing code, stored in DB */
  async generateCode(userId: string, channel: string): Promise<string> {
    // Clean up expired codes for this user
    await prisma.pairingSession.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    })

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    await prisma.pairingSession.create({
      data: {
        code,
        userId,
        channel,
        expiresAt: new Date(Date.now() + PAIRING_CODE_EXPIRE_MS),
      },
    })
    log.info("pairing code generated", { userId, channel })
    return code
  },

  /** Validate code and issue device token. Returns token or null. */
  async confirmPairing(code: string, deviceName?: string): Promise<string | null> {
    const session = await prisma.pairingSession.findUnique({ where: { code } })

    if (!session || session.used || session.expiresAt < new Date()) {
      log.warn("invalid or expired pairing code")
      // Mark as used if found (prevent replay)
      if (session) {
        await prisma.pairingSession.update({ where: { code }, data: { used: true } })
      }
      return null
    }

    // Mark as used immediately (prevent double-use)
    await prisma.pairingSession.update({ where: { code }, data: { used: true } })

    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex")
    const tokenHash = hashToken(rawToken)

    await prisma.deviceToken.create({
      data: {
        tokenHash,
        userId: session.userId,
        channel: session.channel,
        deviceName: deviceName ?? "unknown",
      },
    })

    log.info("device paired successfully", {
      userId: session.userId,
      channel: session.channel,
      deviceName,
    })

    return rawToken  // Return raw token ONCE — never stored raw
  },

  /** Validate device token. Returns auth result or null. */
  async validate(rawToken: string): Promise<AuthResult | null> {
    const id = clientId(rawToken)

    if (isThrottled(id)) {
      log.warn("auth throttled", { clientId: id })
      return null
    }

    const hash = hashToken(rawToken)
    const device = await prisma.deviceToken.findFirst({
      where: { tokenHash: hash, revokedAt: null },
    })

    if (!device) {
      recordFailure(id)
      log.warn("invalid device token", { clientId: id })
      return null
    }

    // Clear failure count on success
    failureMap.delete(id)

    // Update lastUsed async (non-blocking)
    prisma.deviceToken.update({
      where: { id: device.id },
      data: { lastUsed: new Date() },
    }).catch(err => log.error("lastUsed update failed", err))

    return { userId: device.userId, channel: device.channel }
  },

  /** Revoke a specific token */
  async revoke(rawToken: string): Promise<void> {
    const hash = hashToken(rawToken)
    await prisma.deviceToken.updateMany({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    })
  },

  /** List all active devices for a user */
  async listDevices(userId: string): Promise<Array<{
    id: string
    channel: string
    deviceName: string
    lastUsed: Date
  }>> {
    return prisma.deviceToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, channel: true, deviceName: true, lastUsed: true },
    })
  },
}
```

#### Step 3: Buat src/config/orion-config.ts

Config schema-validated, mirip OpenClaw's openclaw.json:

```typescript
import { z } from "zod"
import fs from "node:fs/promises"
import path from "node:path"
import { createLogger } from "../logger.js"

const log = createLogger("config.orion-config")

const ChannelPolicySchema = z.enum(["pairing", "allowlist", "open"])

const ChannelConfigSchema = z.object({
  dmPolicy: ChannelPolicySchema.default("pairing"),
  allowFrom: z.array(z.string()).default([]),
  groupPolicy: ChannelPolicySchema.default("allowlist"),
  ackReaction: z.string().default("👀"),
}).partial()

const AgentIdentitySchema = z.object({
  name: z.string().default("Orion"),
  emoji: z.string().default("✦"),
  theme: z.string().default("dark minimal"),
})

const SkillConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  env: z.record(z.string()).default({}),
}).partial()

const OrionConfigSchema = z.object({
  identity: AgentIdentitySchema.default({}),

  agents: z.object({
    defaults: z.object({
      model: z.object({
        primary: z.string().default("groq/llama-3.3-70b-versatile"),
        fallbacks: z.array(z.string()).default([]),
      }).default({}),
      workspace: z.string().default("./workspace"),
      bootstrapMaxChars: z.number().default(65536),
      bootstrapTotalMaxChars: z.number().default(100000),
    }).default({}),
  }).default({}),

  channels: z.object({
    whatsapp: ChannelConfigSchema.default({}),
    telegram: ChannelConfigSchema.default({}),
    discord: ChannelConfigSchema.default({}),
    signal: ChannelConfigSchema.default({}),
    slack: ChannelConfigSchema.default({}),
  }).default({}),

  skills: z.object({
    allowBundled: z.array(z.string()).default([]),   // empty = all
    load: z.object({
      extraDirs: z.array(z.string()).default([]),
      watch: z.boolean().default(false),
    }).default({}),
    entries: z.record(SkillConfigSchema).default({}),
  }).default({}),
})

export type OrionConfig = z.infer<typeof OrionConfigSchema>

let _config: OrionConfig | null = null

export async function loadOrionConfig(): Promise<OrionConfig> {
  if (_config) return _config

  const configPath = path.resolve(process.cwd(), "orion.json")

  try {
    const raw = await fs.readFile(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    _config = OrionConfigSchema.parse(parsed)
    log.info("orion.json loaded", { workspace: _config.agents.defaults.workspace })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      log.info("orion.json not found, using defaults")
    } else {
      log.warn("orion.json parse error, using defaults", error)
    }
    _config = OrionConfigSchema.parse({})
  }

  return _config
}

export function getOrionConfig(): OrionConfig {
  if (!_config) throw new Error("Config not loaded — call loadOrionConfig() first")
  return _config
}
```

#### Step 4: Buat src/core/workspace-resolver.ts (untuk SaaS)

```typescript
import path from "node:path"
import fs from "node:fs/promises"
import { getOrionConfig } from "../config/orion-config.js"

// Resolves workspace path per user/tenant
// Single-user mode: all users share default workspace
// SaaS mode: each user gets isolated workspace
export class WorkspaceResolver {
  private readonly saasMode: boolean
  private readonly saasDataDir: string

  constructor() {
    this.saasMode = process.env.ORION_SAAS_MODE === "true"
    this.saasDataDir = process.env.ORION_SAAS_DATA_DIR ?? path.resolve(process.cwd(), "data/users")
  }

  /** Get workspace path for a user */
  async resolve(userId: string): Promise<string> {
    if (this.saasMode) {
      // SaaS: per-user isolated workspace
      const userDir = path.join(this.saasDataDir, this.sanitizeUserId(userId), "workspace")
      await fs.mkdir(userDir, { recursive: true })
      await fs.mkdir(path.join(userDir, "skills"), { recursive: true })
      await fs.mkdir(path.join(userDir, "memory"), { recursive: true })

      // If user's SOUL.md doesn't exist yet, copy from default template
      const soulPath = path.join(userDir, "SOUL.md")
      try {
        await fs.access(soulPath)
      } catch {
        const defaultSoul = path.resolve(process.cwd(), "workspace/SOUL.md")
        try {
          await fs.copyFile(defaultSoul, soulPath)
        } catch {
          // Default template also missing — ok, bootstrap will handle
        }
      }

      return userDir
    }

    // Single-user mode: use default workspace from config
    const config = getOrionConfig()
    const workspace = path.resolve(process.cwd(), config.agents.defaults.workspace)
    await fs.mkdir(workspace, { recursive: true })
    return workspace
  }

  /** Sanitize userId for use in filesystem path */
  private sanitizeUserId(userId: string): string {
    // Remove any chars that could cause path traversal
    return userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
  }

  isSaasMode(): boolean {
    return this.saasMode
  }
}

export const workspaceResolver = new WorkspaceResolver()
```

### Constraints
- Token JANGAN pernah di-log dalam raw form
- SHA-256 hashing HARUS dilakukan sebelum store ke DB
- Pairing code HARUS single-use (mark used setelah confirm)
- Throttling HARUS berdasarkan token prefix, bukan user ID
- workspace path HARUS disanitize (remove path traversal chars)
- Zero TypeScript errors
```

## Cara Test
```bash
pnpm dev --mode text
# Simulate pairing flow:
# Input: "/pair"
# Harusnya generate 6-digit code

# Simulate confirm (dari authorized interface):
# Check database untuk verify token hash tersimpan, bukan raw token
sqlite3 .orion/orion.db "SELECT tokenHash, userId, channel FROM DeviceToken LIMIT 5"
# tokenHash harusnya 64-char hex, bukan token asli

# SaaS test:
ORION_SAAS_MODE=true pnpm dev --mode text
# Harusnya buat per-user workspace di data/users/{userId}/workspace/
ls data/users/
```

## Expected Outcome
- Auth yang tidak bisa di-bypass via prompt injection (architectural, bukan prompt)
- Device tokens tersimpan hashed — breach database tidak expose raw tokens
- Pairing codes single-use + TTL 5 menit
- Config schema-validated dengan orion.json (mirip OpenClaw's openclaw.json)
- Foundation untuk SaaS: per-user workspace isolation siap
- Per-channel dmPolicy support (pairing/allowlist/open)
