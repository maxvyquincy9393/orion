import crypto from "node:crypto"

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("pairing.device-store")

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000
const PAIRING_CODE_LENGTH = 6
const DEVICE_TOKEN_LENGTH = 64
const MAX_AUTH_FAILURES = 5
const THROTTLE_WINDOW_MS = 15 * 60 * 1000

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

type DeviceRecord = {
  id: string
  token: string
  userId: string
  channel: string
  lastUsed: Date
  deviceName: string
}

type AuthFailureState = {
  count: number
  firstFailAt: number
}

export class DeviceStore {
  private pendingCodes = new Map<string, PairingCode>()
  private authFailures = new Map<string, AuthFailureState>()

  generatePairingCode(userId: string, channel: string): string {
    this.cleanupExpiredPendingCodes()

    let code = this.generateCode()
    while (this.pendingCodes.has(code)) {
      code = this.generateCode()
    }

    this.pendingCodes.set(code, {
      code,
      expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
      userId,
      channel,
    })

    log.info("pairing code generated", {
      userId,
      channel,
      expiresInMs: PAIRING_CODE_TTL_MS,
    })

    return code
  }

  async confirmPairing(code: string, deviceName?: string): Promise<string | null> {
    this.cleanupExpiredPendingCodes()

    const pending = this.pendingCodes.get(code)
    if (!pending) {
      log.warn("invalid pairing code", { code: this.maskCode(code) })
      return null
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingCodes.delete(code)
      log.warn("expired pairing code", { code: this.maskCode(code) })
      return null
    }

    this.pendingCodes.delete(code)

    const token = crypto.randomBytes(DEVICE_TOKEN_LENGTH).toString("hex")
    const tokenHash = this.hashToken(token)

    try {
      const deviceTokenModel = this.getDeviceTokenModel()
      await deviceTokenModel.create({
        data: {
          token: tokenHash,
          userId: pending.userId,
          channel: pending.channel,
          deviceName: deviceName ?? "unknown",
          lastUsed: new Date(),
        },
      })

      log.info("device paired", {
        userId: pending.userId,
        channel: pending.channel,
        deviceName: deviceName ?? "unknown",
      })

      return token
    } catch (error) {
      log.error("failed to create device token", error)
      return null
    }
  }

  async validateToken(token: string): Promise<{ userId: string; channel: string } | null> {
    const normalizedToken = token.trim()
    const clientId = this.getClientId(normalizedToken)
    const throttle = this.getThrottleStatus(normalizedToken)

    if (throttle.throttled) {
      log.warn("auth request throttled", {
        clientId,
        retryAfterSeconds: throttle.retryAfterSeconds,
      })
      return null
    }

    const tokenHash = this.hashToken(normalizedToken)

    try {
      const deviceTokenModel = this.getDeviceTokenModel()
      const devices = (await deviceTokenModel.findMany({
        where: {
          token: tokenHash,
        },
        take: 1,
      })) as DeviceRecord[]

      const device = devices[0]

      if (!device || !this.timingSafeEqual(device.token, tokenHash)) {
        this.recordFailure(clientId)
        if (device && !this.timingSafeEqual(device.token, tokenHash)) {
          await deviceTokenModel.deleteMany({ where: { id: device.id } })
          log.warn("token mismatch detected; stale token cleared", { clientId })
        }
        log.warn("invalid device token", { clientId })
        return null
      }

      await deviceTokenModel.update({
        where: { id: device.id },
        data: {
          lastUsed: new Date(),
        },
      })

      this.authFailures.delete(clientId)

      return {
        userId: device.userId,
        channel: device.channel,
      }
    } catch (error) {
      log.error("token validation failed", error)
      return null
    }
  }

  async revokeToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token)
    const deviceTokenModel = this.getDeviceTokenModel()
    await deviceTokenModel.deleteMany({
      where: {
        token: tokenHash,
      },
    })
  }

  async listDevices(userId: string): Promise<Array<{ channel: string; deviceName: string; lastUsed: Date }>> {
    const deviceTokenModel = this.getDeviceTokenModel()
    const devices = (await deviceTokenModel.findMany({
      where: { userId },
      select: {
        channel: true,
        deviceName: true,
        lastUsed: true,
      },
    })) as Array<{ channel: string; deviceName: string; lastUsed: Date }>

    return devices
  }

  getThrottleStatus(token: string): { throttled: boolean; retryAfterSeconds: number } {
    const clientId = this.getClientId(token)
    const failures = this.authFailures.get(clientId)

    if (!failures) {
      return { throttled: false, retryAfterSeconds: 0 }
    }

    const elapsedMs = Date.now() - failures.firstFailAt
    if (elapsedMs > THROTTLE_WINDOW_MS) {
      this.authFailures.delete(clientId)
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

  cleanupExpiredCodes(): number {
    return this.cleanupExpiredPendingCodes()
  }

  private generateCode(): string {
    const max = 10 ** PAIRING_CODE_LENGTH
    return crypto.randomInt(0, max).toString().padStart(PAIRING_CODE_LENGTH, "0")
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex")
  }

  private getClientId(token: string): string {
    const trimmed = token.trim()
    if (trimmed.length >= 8) {
      return trimmed.slice(0, 8)
    }
    return this.hashToken(trimmed).slice(0, 8)
  }

  private recordFailure(clientId: string): void {
    const current = this.authFailures.get(clientId)
    if (!current) {
      this.authFailures.set(clientId, {
        count: 1,
        firstFailAt: Date.now(),
      })
      return
    }

    if (Date.now() - current.firstFailAt > THROTTLE_WINDOW_MS) {
      this.authFailures.set(clientId, {
        count: 1,
        firstFailAt: Date.now(),
      })
      return
    }

    this.authFailures.set(clientId, {
      ...current,
      count: current.count + 1,
    })
  }

  private timingSafeEqual(left: string, right: string): boolean {
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

  private cleanupExpiredPendingCodes(): number {
    const now = Date.now()
    let removed = 0

    for (const [code, pending] of this.pendingCodes) {
      if (pending.expiresAt <= now) {
        this.pendingCodes.delete(code)
        removed += 1
      }
    }

    return removed
  }

  private maskCode(code: string): string {
    const trimmed = code.trim()
    if (trimmed.length <= 3) {
      return "***"
    }
    return `${trimmed.slice(0, 3)}***`
  }

  private getDeviceTokenModel(): any {
    return (prisma as any).deviceToken
  }
}

export const deviceStore = new DeviceStore()
