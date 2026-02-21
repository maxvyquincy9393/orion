import { createLogger } from "../logger.js"
import { getHistory } from "../database/index.js"

const log = createLogger("sessions.store")

export interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

export interface Session {
  key: string
  userId: string
  channel: string
  createdAt: number
  lastActivityAt: number
}

function makeSessionKey(userId: string, channel: string): string {
  return `${userId}:${channel}`
}

class SessionStore {
  private sessions = new Map<string, Session>()
  private histories = new Map<string, Message[]>()

  getOrCreateSession(userId: string, channel: string): Session {
    const key = makeSessionKey(userId, channel)
    const now = Date.now()

    let session = this.sessions.get(key)
    if (!session) {
      session = {
        key,
        userId,
        channel,
        createdAt: now,
        lastActivityAt: now,
      }
      this.sessions.set(key, session)
      log.debug("Session created", { key })
    } else {
      session.lastActivityAt = now
    }

    return session
  }

  getSession(userId: string, channel: string): Session | undefined {
    return this.sessions.get(makeSessionKey(userId, channel))
  }

  async getSessionHistory(
    userId: string,
    channel: string,
    limit = 50
  ): Promise<Message[]> {
    const key = makeSessionKey(userId, channel)

    let history = this.histories.get(key)
    if (!history) {
      const dbMessages = await getHistory(userId, limit)
      history = dbMessages
        .filter((msg) => !channel || msg.channel === channel)
        .reverse()
        .map((msg) => ({
          role: msg.role === "assistant" ? "assistant" : "user" as const,
          content: msg.content,
          timestamp: msg.createdAt.getTime(),
        }))
      this.histories.set(key, history)
    }

    return history.slice(-limit)
  }

  addMessage(userId: string, channel: string, message: Message): void {
    const key = makeSessionKey(userId, channel)
    const session = this.getOrCreateSession(userId, channel)
    session.lastActivityAt = Date.now()

    let history = this.histories.get(key)
    if (!history) {
      history = []
      this.histories.set(key, history)
    }

    history.push(message)
  }

  clearSession(userId: string, channel: string): void {
    const key = makeSessionKey(userId, channel)
    this.sessions.delete(key)
    this.histories.delete(key)
    log.debug("Session cleared", { key })
  }

  clearAllSessions(): void {
    this.sessions.clear()
    this.histories.clear()
    log.info("All sessions cleared")
  }

  getActiveSessions(): Session[] {
    return [...this.sessions.values()]
  }

  getSessionCount(): number {
    return this.sessions.size
  }

  cleanupInactiveSessions(maxInactiveMs: number): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, session] of this.sessions) {
      if (now - session.lastActivityAt > maxInactiveMs) {
        this.sessions.delete(key)
        this.histories.delete(key)
        cleaned += 1
      }
    }

    if (cleaned > 0) {
      log.info("Cleaned up inactive sessions", { count: cleaned })
    }

    return cleaned
  }
}

export const sessionStore = new SessionStore()
