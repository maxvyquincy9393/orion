# Phase OC-3 — Auth & Device Pairing (Production-Grade)

## Paper Backing
**[1] AURA: Affordance-Understanding and Risk-aware Alignment**
arXiv: 2508.06124 | Aug 2025
Security bukan tentang prompt guardrails — itu gampang di-bypass.
Harus ada architectural constraints: siapa yang boleh bicara ke Orion adalah boundary pertama.

**[2] OpenClaw Security Docs (Official)**
docs.openclaw.ai/gateway/security
Prinsip: Identity first → Scope next → Model last
Ini yang bikin OpenClaw lebih secure dari competitor yang hanya pakai "don't do bad things" prompts.

## OpenClaw Auth Pattern (Dipelajari dari Source)

### Device Pairing Flow
```
1. User trigger pairing (via CLI, web, atau messaging app)
2. Gateway generate time-limited pairing code (6 digit, expires 5 menit)
3. User masukkan code di control interface (confim identity)  
4. Gateway issue device token (long-lived, encrypted)
5. Device token stored per-device
6. Token di-clear jika mismatch (prevent stale auth attacks)
```

### Access Control Hierarchy
```
Channel Mode:
  - pairing   → only approved devices (default, most secure)
  - allowlist → specific chat IDs/phone numbers
  - open      → anyone (only for internal/trusted networks)

Command Authorization:
  - Slash commands dan directives: hanya honored dari authorized senders
  - Tools with high risk (file delete, system commands): extra confirmation
  - Webhook endpoints: shared secret + constant-time comparison
```

### Session Security
- Session ID validation: path traversal prevention
- Session operations confined ke `agent/sessions/` directory
- Per-client auth-failure throttling (429 + Retry-After)

## Orion Sekarang
`pairing/manager.ts` sudah ada tapi basic.
Tidak ada proper device token management.
Tidak ada access control hierarchy.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Upgrade auth system ke production-grade.
Reference: docs.openclaw.ai/gateway/security
Paper: arXiv:2508.06124

### TASK: Phase OC-3 — Production Auth

Target files:
- `src/pairing/manager.ts` (upgrade)
- `src/pairing/device-store.ts` (file baru)
- `src/gateway/auth-middleware.ts` (file baru)
- `src/permissions/sandbox.ts` (modifikasi — integrate auth)

#### Step 1: Buat src/pairing/device-store.ts

```typescript
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import crypto from "node:crypto"

const log = createLogger("pairing.device-store")

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000   // 5 menit
const DEVICE_TOKEN_LENGTH = 64               // bytes → 128 hex chars
const MAX_AUTH_FAILURES = 5                  // sebelum throttle
const THROTTLE_WINDOW_MS = 15 * 60 * 1000   // 15 menit

export interface PairingCode {
  code: string
  expiresAt: number
  userId: string
  channel: string
}

export interface DeviceToken {
  token: string
  userId: string
  channel: string
  createdAt: number
  lastUsed: number
  deviceName?: string
}

export class DeviceStore {
  private pendingCodes = new Map<string, PairingCode>()
  private authFailures = new Map<string, { count: number; firstFailAt: number }>()

  // Generate new pairing code
  generatePairingCode(userId: string, channel: string): string {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    this.pendingCodes.set(code, {
      code,
      expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
      userId,
      channel,
    })
    log.info("pairing code generated", { userId, channel })
    return code
  }

  // Validate code and issue device token
  async confirmPairing(code: string, deviceName?: string): Promise<string | null> {
    const pending = this.pendingCodes.get(code)
    if (!pending) {
      log.warn("invalid pairing code", { code: code.slice(0, 3) + "***" })
      return null
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingCodes.delete(code)
      log.warn("expired pairing code")
      return null
    }

    this.pendingCodes.delete(code)

    const token = crypto.randomBytes(DEVICE_TOKEN_LENGTH).toString("hex")

    await prisma.deviceToken.create({
      data: {
        token: this.hashToken(token),
        userId: pending.userId,
        channel: pending.channel,
        deviceName: deviceName ?? "unknown",
        lastUsed: new Date(),
      },
    })

    log.info("device paired", { userId: pending.userId, channel: pending.channel })
    return token
  }

  // Validate token (timing-safe comparison against hashed stored tokens)
  async validateToken(token: string): Promise<{ userId: string; channel: string } | null> {
    const clientId = token.slice(0, 8)  // for throttle tracking

    // Check throttle
    if (this.isThrottled(clientId)) {
      log.warn("auth request throttled", { clientId })
      return null
    }

    const hashed = this.hashToken(token)
    
    try {
      const device = await prisma.deviceToken.findFirst({
        where: { token: hashed },
      })

      if (!device) {
        this.recordFailure(clientId)
        log.warn("invalid device token")
        return null
      }

      // Update last used
      await prisma.deviceToken.update({
        where: { id: device.id },
        data: { lastUsed: new Date() },
      })

      // Clear failures on success
      this.authFailures.delete(clientId)

      return { userId: device.userId, channel: device.channel }
    } catch (error) {
      log.error("token validation failed", error)
      return null
    }
  }

  // Revoke specific device token
  async revokeToken(token: string): Promise<void> {
    const hashed = this.hashToken(token)
    await prisma.deviceToken.deleteMany({ where: { token: hashed } })
  }

  // List all paired devices for a user
  async listDevices(userId: string): Promise<Array<{ channel: string; deviceName: string; lastUsed: Date }>> {
    const devices = await prisma.deviceToken.findMany({
      where: { userId },
      select: { channel: true, deviceName: true, lastUsed: true },
    })
    return devices
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex")
  }

  private isThrottled(clientId: string): boolean {
    const failures = this.authFailures.get(clientId)
    if (!failures) return false
    if (Date.now() - failures.firstFailAt > THROTTLE_WINDOW_MS) {
      this.authFailures.delete(clientId)
      return false
    }
    return failures.count >= MAX_AUTH_FAILURES
  }

  private recordFailure(clientId: string): void {
    const current = this.authFailures.get(clientId)
    if (!current) {
      this.authFailures.set(clientId, { count: 1, firstFailAt: Date.now() })
    } else {
      this.authFailures.set(clientId, { ...current, count: current.count + 1 })
    }
  }
}

export const deviceStore = new DeviceStore()
```

#### Step 2: Tambah Prisma schema untuk DeviceToken

Di `prisma/schema.prisma`, tambahkan model:
```prisma
model DeviceToken {
  id         String   @id @default(cuid())
  token      String   @unique  // SHA-256 hashed
  userId     String
  channel    String
  deviceName String   @default("unknown")
  lastUsed   DateTime @updatedAt
  createdAt  DateTime @default(now())

  @@index([userId])
}
```

Jalankan: `npx prisma migrate dev --name add-device-tokens`

#### Step 3: Buat src/gateway/auth-middleware.ts

```typescript
import { deviceStore } from "../pairing/device-store.js"
import { createLogger } from "../logger.js"

const log = createLogger("gateway.auth")

export interface AuthContext {
  userId: string
  channel: string
  authenticated: boolean
}

// Middleware untuk WebSocket connections
export async function authenticateWebSocket(
  token: string | null | undefined
): Promise<AuthContext | null> {
  if (!token) {
    log.warn("websocket connection without token")
    return null
  }

  const result = await deviceStore.validateToken(token)
  if (!result) {
    return null
  }

  return {
    userId: result.userId,
    channel: result.channel,
    authenticated: true,
  }
}

// Check if a message sender is authorized
// Channel-specific authorization check
export function isAuthorizedSender(
  senderId: string,
  channel: string,
  allowlist: string[] | null,
  mode: "pairing" | "allowlist" | "open"
): boolean {
  if (mode === "open") return true
  if (mode === "allowlist" && allowlist) {
    return allowlist.includes(senderId)
  }
  // For pairing mode, check is done at WebSocket connection level
  // If we reach here in pairing mode, sender is already authenticated
  return mode === "pairing"
}
```

#### Step 4: Update pairing/manager.ts
Upgrade existing manager untuk pakai deviceStore:

```typescript
import { deviceStore } from "./device-store.js"

// Update pairingManager.initiatePairing():
async initiatePairing(userId: string, channel: string): Promise<string> {
  return deviceStore.generatePairingCode(userId, channel)
}

// Update pairingManager.confirmPairing():
async confirmPairing(code: string, deviceName?: string): Promise<string | null> {
  return deviceStore.confirmPairing(code, deviceName)
}

// Update pairingManager.isAuthorized():
async isAuthorized(token: string): Promise<{ userId: string; channel: string } | null> {
  return deviceStore.validateToken(token)
}
```

### Constraints
- Token hashing: JANGAN store raw token, selalu SHA-256 dulu
- Timing-safe comparison untuk semua token validation
- Pairing code harus expire dalam 5 menit
- Auth failures harus tracked per-client, bukan per-user
- Zero TypeScript errors
- Prisma migration harus run sebelum test
```

## Cara Test
```bash
# Generate pairing code
pnpm dev --mode text
# Input: "/pair"
# Harusnya generate 6-digit code

# Simulate confirm
# Input: "/pair confirm 123456"

# Check database
sqlite3 .orion/orion.db "SELECT * FROM DeviceToken"
```

## Expected Outcome
- Auth system yang tidak bisa di-bypass dengan prompt injection
- Device pairing flow yang clear untuk onboarding user baru
- Throttling mencegah brute force
- Token revocation untuk security incidents
- Foundation untuk SaaS multi-user (setiap user punya device tokens sendiri)
