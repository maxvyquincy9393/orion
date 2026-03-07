import { createLogger } from "../logger.js"

const log = createLogger("sessions.send-policy")

const MAX_MESSAGES_PER_MINUTE = 30
const MAX_MESSAGE_LENGTH = 4000

interface RateLimitEntry {
  count: number
  resetAt: number
}

export class SendPolicyManager {
  private rateLimits = new Map<string, RateLimitEntry>()

  private makeKey(userId: string, channel: string): string {
    return `${userId}:${channel}`
  }

  private cleanupExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.rateLimits) {
      if (entry.resetAt < now) {
        this.rateLimits.delete(key)
      }
    }
  }

  async check(
    userId: string,
    channel: string,
    content: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      this.cleanupExpired()

      if (content.length > MAX_MESSAGE_LENGTH) {
        log.warn("Message too long", {
          userId,
          channel,
          length: content.length,
          max: MAX_MESSAGE_LENGTH,
        })
        return {
          allowed: false,
          reason: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
        }
      }

      const key = this.makeKey(userId, channel)
      const now = Date.now()
      const windowMs = 60_000

      let entry = this.rateLimits.get(key)

      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + windowMs }
        this.rateLimits.set(key, entry)
      }

      if (entry.count >= MAX_MESSAGES_PER_MINUTE) {
        const waitSeconds = Math.ceil((entry.resetAt - now) / 1000)
        log.warn("Rate limit exceeded", {
          userId,
          channel,
          count: entry.count,
          max: MAX_MESSAGES_PER_MINUTE,
        })
        return {
          allowed: false,
          reason: `Rate limit exceeded. Please wait ${waitSeconds} seconds.`,
        }
      }

      entry.count += 1

      return { allowed: true }
    } catch (error) {
      log.error("sendPolicy.check error", error)
      return { allowed: true }
    }
  }
}

export const sendPolicy = new SendPolicyManager()
