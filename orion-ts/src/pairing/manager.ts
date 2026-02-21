import config from "../config.js"
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import { deviceStore, type AuthResult } from "./device-store.js"

const log = createLogger("pairing.manager")

export class PairingManager {
  async generateCode(channel: string, senderId: string): Promise<string> {
    try {
      return await deviceStore.generateCode(senderId, channel)
    } catch (error) {
      log.error("generateCode failed", error)
      return ""
    }
  }

  async approveCode(code: string): Promise<boolean> {
    const token = await this.confirmPairing(code)
    return token !== null
  }

  async confirmPairing(code: string, deviceName?: string): Promise<string | null> {
    try {
      return await deviceStore.confirmPairing(code, deviceName)
    } catch (error) {
      log.error("confirmPairing failed", error)
      return null
    }
  }

  async validateToken(rawToken: string): Promise<AuthResult | null> {
    try {
      return await deviceStore.validate(rawToken)
    } catch (error) {
      log.error("validateToken failed", error)
      return null
    }
  }

  async isApproved(userId: string, channel: string): Promise<boolean> {
    if (userId === config.DEFAULT_USER_ID) {
      return true
    }

    try {
      const devices = await deviceStore.listDevices(userId)
      return devices.some((device) => device.channel === channel)
    } catch (error) {
      log.error("isApproved failed", error)
      return false
    }
  }

  async revokeToken(rawToken: string): Promise<void> {
    try {
      await deviceStore.revoke(rawToken)
    } catch (error) {
      log.error("revokeToken failed", error)
    }
  }

  async revokeUser(userId: string, channel: string): Promise<void> {
    try {
      const result = await prisma.deviceToken.updateMany({
        where: { userId, channel, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      if (result.count > 0) {
        log.info("User revoked", { userId, channel, revokedTokens: result.count })
      }
    } catch (error) {
      log.error("revokeUser failed", error)
    }
  }

  async listDevices(userId: string): Promise<Array<{
    id: string
    channel: string
    deviceName: string
    lastUsed: Date
  }>> {
    return deviceStore.listDevices(userId)
  }

  async cleanupExpired(): Promise<void> {
    try {
      const result = await prisma.pairingSession.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { used: true },
          ],
        },
      })

      if (result.count > 0) {
        log.info("Cleaned up pairing sessions", { count: result.count })
      }
    } catch (error) {
      log.error("cleanupExpired failed", error)
    }
  }
}

export const pairingManager = new PairingManager()
