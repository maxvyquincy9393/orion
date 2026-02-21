import { PrismaClient, Prisma, type Message, type Thread, type TriggerLog } from "@prisma/client"

import { createLogger } from "../logger.js"

const log = createLogger("database")

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  })

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma
}

function asJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === undefined) {
    return Prisma.JsonNull
  }
  if (value === null) {
    return Prisma.JsonNull
  }
  return value as Prisma.InputJsonValue
}

function fallbackMessage(
  userId: string,
  role: string,
  content: string,
  channel?: string,
  metadata?: unknown,
): Message {
  return {
    id: `fallback-${Date.now()}`,
    userId,
    role,
    content,
    channel: channel ?? null,
    metadata: metadata === undefined ? null : (metadata as Prisma.JsonValue),
    createdAt: new Date(),
  }
}

function fallbackThread(userId: string, state = "open", context?: unknown): Thread {
  return {
    id: `fallback-${Date.now()}`,
    userId,
    state,
    context: context === undefined ? null : (context as Prisma.JsonValue),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function fallbackTriggerLog(
  userId: string,
  triggerName: string,
  actedOn: boolean,
): TriggerLog {
  return {
    id: `fallback-${Date.now()}`,
    userId,
    triggerName,
    actedOn,
    firedAt: new Date(),
  }
}

export async function saveMessage(
  userId: string,
  role: string,
  content: string,
  channel?: string,
  metadata?: unknown,
): Promise<Message> {
  try {
    return await prisma.message.create({
      data: {
        userId,
        role,
        content,
        channel,
        metadata: asJson(metadata),
      },
    })
  } catch (error) {
    log.error("saveMessage failed", error)
    return fallbackMessage(userId, role, content, channel, metadata)
  }
}

export async function getHistory(userId: string, limit = 50): Promise<Message[]> {
  try {
    return await prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    })
  } catch (error) {
    log.error("getHistory failed", error)
    return []
  }
}

export async function searchMessages(
  userId: string,
  query: string,
  days = 14,
): Promise<Message[]> {
  try {
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return await prisma.message.findMany({
      where: {
        userId,
        createdAt: { gte: threshold },
        content: { contains: query },
      },
      orderBy: { createdAt: "desc" },
    })
  } catch (error) {
    log.error("searchMessages failed", error)
    return []
  }
}

export async function createThread(userId: string, context: unknown): Promise<Thread> {
  try {
    return await prisma.thread.create({
      data: {
        userId,
        state: "open",
        context: asJson(context),
      },
    })
  } catch (error) {
    log.error("createThread failed", error)
    return fallbackThread(userId, "open", context)
  }
}

export async function updateThread(
  id: string,
  state: string,
  context?: unknown,
): Promise<Thread> {
  try {
    return await prisma.thread.update({
      where: { id },
      data: {
        state,
        ...(context !== undefined ? { context: asJson(context) } : {}),
      },
    })
  } catch (error) {
    log.error("updateThread failed", error)
    return fallbackThread("unknown", state, context)
  }
}

export async function getOpenThreads(userId: string): Promise<Thread[]> {
  try {
    return await prisma.thread.findMany({
      where: {
        userId,
        state: { in: ["open", "waiting"] },
      },
      orderBy: { updatedAt: "desc" },
    })
  } catch (error) {
    log.error("getOpenThreads failed", error)
    return []
  }
}

export async function logTrigger(
  userId: string,
  triggerName: string,
  actedOn: boolean,
): Promise<TriggerLog> {
  try {
    return await prisma.triggerLog.create({
      data: {
        userId,
        triggerName,
        actedOn,
      },
    })
  } catch (error) {
    log.error("logTrigger failed", error)
    return fallbackTriggerLog(userId, triggerName, actedOn)
  }
}

export async function getTriggerLogs(
  userId: string,
  days = 30,
): Promise<TriggerLog[]> {
  try {
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return await prisma.triggerLog.findMany({
      where: {
        userId,
        firedAt: { gte: threshold },
      },
      orderBy: { firedAt: "desc" },
    })
  } catch (error) {
    log.error("getTriggerLogs failed", error)
    return []
  }
}
