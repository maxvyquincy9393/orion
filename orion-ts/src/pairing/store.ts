import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"

const log = createLogger("pairing.store")

export interface PairingCodeData {
  id: string
  code: string
  channel: string
  senderId: string
  expiresAt: Date
  approved: boolean
  createdAt: Date
}

export async function createPairingCode(
  code: string,
  channel: string,
  senderId: string,
  expiresAt: Date
): Promise<PairingCodeData | null> {
  try {
    const result = await prisma.pairingCode.create({
      data: {
        code,
        channel,
        senderId,
        expiresAt,
        approved: false,
      },
    })
    return result
  } catch (error) {
    log.error("createPairingCode failed", error)
    return null
  }
}

export async function getPairingCode(code: string): Promise<PairingCodeData | null> {
  try {
    const result = await prisma.pairingCode.findUnique({
      where: { code },
    })
    return result
  } catch (error) {
    log.error("getPairingCode failed", error)
    return null
  }
}

export async function approvePairingCode(code: string): Promise<boolean> {
  try {
    const existing = await prisma.pairingCode.findUnique({
      where: { code },
    })

    if (!existing) {
      return false
    }

    if (existing.expiresAt < new Date()) {
      return false
    }

    await prisma.pairingCode.update({
      where: { code },
      data: {
        approved: true,
      },
    })

    return true
  } catch (error) {
    log.error("approvePairingCode failed", error)
    return false
  }
}

export async function isUserApproved(userId: string, channel: string): Promise<boolean> {
  try {
    const result = await prisma.approvedUser.findUnique({
      where: {
        userId_channel: { userId, channel },
      },
    })
    return result !== null && result.revokedAt === null
  } catch (error) {
    log.error("isUserApproved failed", error)
    return false
  }
}

export async function approveUser(userId: string, channel: string): Promise<boolean> {
  try {
    await prisma.approvedUser.upsert({
      where: {
        userId_channel: { userId, channel },
      },
      update: {
        revokedAt: null,
      },
      create: {
        userId,
        channel,
      },
    })
    return true
  } catch (error) {
    log.error("approveUser failed", error)
    return false
  }
}

export async function revokeUser(userId: string, channel: string): Promise<boolean> {
  try {
    await prisma.approvedUser.update({
      where: {
        userId_channel: { userId, channel },
      },
      data: {
        revokedAt: new Date(),
      },
    })
    return true
  } catch (error) {
    log.error("revokeUser failed", error)
    return false
  }
}

export async function cleanupExpiredCodes(): Promise<number> {
  try {
    const result = await prisma.pairingCode.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        approved: false,
      },
    })
    return result.count
  } catch (error) {
    log.error("cleanupExpiredCodes failed", error)
    return 0
  }
}
