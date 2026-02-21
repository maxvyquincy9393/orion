import { randomInt } from "node:crypto"

import config from "../config.js"
import { createLogger } from "../logger.js"
import * as store from "./store.js"

const log = createLogger("pairing.manager")

const CODE_LENGTH = 6
const CODE_EXPIRY_MS = 10 * 60 * 1000

function generateCodeString(): string {
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += randomInt(0, 10).toString()
  }
  return code
}

export class PairingManager {
  async generateCode(channel: string, senderId: string): Promise<string> {
    try {
      const code = generateCodeString()
      const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS)

      const result = await store.createPairingCode(code, channel, senderId, expiresAt)

      if (result) {
        log.info("Pairing code generated", { channel, senderId, code })
        return code
      }

      return ""
    } catch (error) {
      log.error("generateCode failed", error)
      return ""
    }
  }

  async approveCode(code: string): Promise<boolean> {
    try {
      const pairingCode = await store.getPairingCode(code)
      if (!pairingCode) {
        log.warn("Pairing code not found", { code })
        return false
      }

      const codeApproved = await store.approvePairingCode(code)
      if (!codeApproved) {
        return false
      }

      const userApproved = await store.approveUser(pairingCode.senderId, pairingCode.channel)
      if (userApproved) {
        log.info("Pairing code approved", { code, senderId: pairingCode.senderId, channel: pairingCode.channel })
      }

      return userApproved
    } catch (error) {
      log.error("approveCode failed", error)
      return false
    }
  }

  async isApproved(userId: string, channel: string): Promise<boolean> {
    if (userId === config.DEFAULT_USER_ID) {
      return true
    }
    return store.isUserApproved(userId, channel)
  }

  async revokeUser(userId: string, channel: string): Promise<void> {
    try {
      const success = await store.revokeUser(userId, channel)

      if (success) {
        log.info("User revoked", { userId, channel })
      }
    } catch (error) {
      log.error("revokeUser failed", error)
    }
  }

  async cleanupExpired(): Promise<void> {
    try {
      const count = await store.cleanupExpiredCodes()
      if (count > 0) {
        log.info("Cleaned up expired pairing codes", { count })
      }
    } catch (error) {
      log.error("cleanupExpired failed", error)
    }
  }
}

export const pairingManager = new PairingManager()
