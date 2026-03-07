import crypto from "node:crypto"

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("pairing.device-store")

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000
const DEVICE_TOKEN_LENGTH_BYTES = 64
const MAX_AUTH_FAILURES = 5
const THROTTLE_WINDOW_MS = 15 * 60 * 1000

const authFailures = new Map<string, { count: number; firstFailAt: number }>()

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function deriveClientId(token: string): string {
  const trimmed = token.trim()
  if (trimmed.length >= 8) {
    return trimmed.slice(0, 8)
  }
  return hashToken(trimmed).slice(0, 8)
}

function timingSafeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8")
  const rightBuffer = Buffer.from(right, "utf8")

  if (leftBuffer.length !== rightBuffer.length) {
    const maxLength = Math.max(leftBuffer.length, rightBuffer.length)
    const leftPadded = Buffer.alloc(maxLength)
    const rightPadded = Buffer.alloc(maxLength)
    leftBuffer.copy(leftPadded)
    rightBuffer.copy(rightPadded)
    crypto.timingSafeEqual(leftPadded, rightPadded)
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function getThrottleStatusByClientId(clientId: string): { throttled: boolean; retryAfterSeconds: number } {
  const failures = authFailures.get(clientId)
  if (!failures) {
    return { throttled: false, retryAfterSeconds: 0 }
  }

  const elapsedMs = Date.now() - failures.firstFailAt
  if (elapsedMs > THROTTLE_WINDOW_MS) {
    authFailures.delete(clientId)
    return { throttled: false, retryAfterSeconds: 0 }
  }

  if (failures.count < MAX_AUTH_FAILURES) {
    return { throttled: false, retryAfterSeconds: 0 }
  }

  return {
    throttled: true,
    retryAfterSeconds: Math.max(1, Math.ceil((THROTTLE_WINDOW_MS - elapsedMs) / 1000)),
  }
}

function recordFailure(clientId: string): void {
  const current = authFailures.get(clientId)
  if (!current || Date.now() - current.firstFailAt > THROTTLE_WINDOW_MS) {
    authFailures.set(clientId, { count: 1, firstFailAt: Date.now() })
    return
  }

  authFailures.set(clientId, {
    ...current,
    count: current.count + 1,
  })
}

export interface AuthResult {
  userId: string
  channel: string
}

async function generatePairingCode(userId: string, channel: string): Promise<string> {
  const now = new Date()

  await prisma.pairingSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { used: true },
      ],
    },
  })

  const code = crypto.randomInt(100000, 1000000).toString()
  await prisma.pairingSession.create({
    data: {
      code,
      userId,
      channel,
      expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
      used: false,
    },
  })

  log.info("pairing code generated", {
    userId,
    channel,
    expiresInMs: PAIRING_CODE_TTL_MS,
  })

  return code
}

async function confirmPairing(code: string, deviceName?: string): Promise<string | null> {
  const session = await prisma.pairingSession.findUnique({ where: { code } })
  if (!session) {
    log.warn("invalid pairing code", { code: `${code.slice(0, 3)}***` })
    return null
  }

  if (session.used || session.expiresAt < new Date()) {
    await prisma.pairingSession.update({
      where: { code },
      data: { used: true },
    })
    log.warn("expired or used pairing code", { code: `${code.slice(0, 3)}***` })
    return null
  }

  await prisma.pairingSession.update({
    where: { code },
    data: { used: true },
  })

  const rawToken = crypto.randomBytes(DEVICE_TOKEN_LENGTH_BYTES).toString("hex")
  const tokenHash = hashToken(rawToken)

  await prisma.deviceToken.create({
    data: {
      tokenHash,
      userId: session.userId,
      channel: session.channel,
      deviceName: deviceName ?? "unknown",
      lastUsed: new Date(),
    },
  })

  log.info("device paired", {
    userId: session.userId,
    channel: session.channel,
    deviceName: deviceName ?? "unknown",
  })

  return rawToken
}

async function validateToken(rawToken: string): Promise<AuthResult | null> {
  const normalized = rawToken.trim()
  const clientId = deriveClientId(normalized)
  const throttleStatus = getThrottleStatusByClientId(clientId)

  if (throttleStatus.throttled) {
    log.warn("auth request throttled", {
      clientId,
      retryAfterSeconds: throttleStatus.retryAfterSeconds,
    })
    return null
  }

  const tokenHash = hashToken(normalized)
  const device = await prisma.deviceToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
    },
    select: {
      id: true,
      tokenHash: true,
      userId: true,
      channel: true,
    },
  })

  if (!device) {
    recordFailure(clientId)
    log.warn("invalid device token", { clientId })
    return null
  }

  if (!timingSafeHashEqual(device.tokenHash, tokenHash)) {
    recordFailure(clientId)
    await prisma.deviceToken.updateMany({
      where: { id: device.id },
      data: { revokedAt: new Date() },
    })
    log.warn("device token mismatch; revoked stale token", { clientId })
    return null
  }

  authFailures.delete(clientId)

  await prisma.deviceToken.update({
    where: { id: device.id },
    data: { lastUsed: new Date() },
  })

  return {
    userId: device.userId,
    channel: device.channel,
  }
}

async function revokeToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken)
  await prisma.deviceToken.updateMany({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  })
}

async function listDevices(userId: string): Promise<Array<{
  id: string
  channel: string
  deviceName: string
  lastUsed: Date
}>> {
  return prisma.deviceToken.findMany({
    where: {
      userId,
      revokedAt: null,
    },
    select: {
      id: true,
      channel: true,
      deviceName: true,
      lastUsed: true,
    },
  })
}

export const deviceStore = {
  generatePairingCode,
  generateCode: generatePairingCode,
  confirmPairing,
  validateToken,
  validate: validateToken,
  revokeToken,
  revoke: revokeToken,
  listDevices,
  getThrottleStatus(rawToken: string): { throttled: boolean; retryAfterSeconds: number } {
    return getThrottleStatusByClientId(deriveClientId(rawToken))
  },
}
