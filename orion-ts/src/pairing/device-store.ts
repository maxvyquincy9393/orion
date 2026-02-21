import crypto from "node:crypto"

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("pairing.device-store")

const PAIRING_CODE_EXPIRE_MS = 5 * 60 * 1000
const TOKEN_BYTES = 32
const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 15 * 60 * 1000

const failureMap = new Map<string, { count: number; windowStart: number }>()

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function clientId(tokenPrefix: string): string {
  return tokenPrefix.slice(0, 8)
}

function isThrottled(id: string): boolean {
  const entry = failureMap.get(id)
  if (!entry) {
    return false
  }

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
    return
  }

  entry.count += 1
}

export interface AuthResult {
  userId: string
  channel: string
}

export const deviceStore = {
  async generateCode(userId: string, channel: string): Promise<string> {
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

  async confirmPairing(code: string, deviceName?: string): Promise<string | null> {
    const session = await prisma.pairingSession.findUnique({ where: { code } })

    if (!session || session.used || session.expiresAt < new Date()) {
      log.warn("invalid or expired pairing code")
      if (session) {
        await prisma.pairingSession.update({
          where: { code },
          data: { used: true },
        })
      }
      return null
    }

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

    return rawToken
  },

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

    failureMap.delete(id)

    void prisma.deviceToken
      .update({
        where: { id: device.id },
        data: { lastUsed: new Date() },
      })
      .catch((error) => log.error("lastUsed update failed", error))

    return { userId: device.userId, channel: device.channel }
  },

  async revoke(rawToken: string): Promise<void> {
    const hash = hashToken(rawToken)
    await prisma.deviceToken.updateMany({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    })
  },

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
