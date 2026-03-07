import { createLogger } from "../logger.js"
import config from "../config.js"

const logger = createLogger("multiuser")

export interface UserProfile {
  userId: string
  displayName: string
  channel: string
  createdAt: Date
  lastSeen: Date
}

export class MultiUserManager {
  private users = new Map<string, UserProfile>()

  async registerUser(
    userId: string,
    displayName: string,
    channel: string
  ): Promise<UserProfile> {
    const profile: UserProfile = {
      userId,
      displayName,
      channel,
      createdAt: new Date(),
      lastSeen: new Date()
    }
    this.users.set(userId, profile)
    logger.info(`user registered: ${userId} via ${channel}`)
    return profile
  }

  async getOrCreate(
    userId: string,
    channel: string
  ): Promise<UserProfile> {
    if (this.users.has(userId)) {
      const user = this.users.get(userId)!
      user.lastSeen = new Date()
      return user
    }
    return this.registerUser(userId, userId, channel)
  }

  getUser(userId: string): UserProfile | undefined {
    return this.users.get(userId)
  }

  listUsers(): UserProfile[] {
    return Array.from(this.users.values())
  }

  isOwner(userId: string): boolean {
    return userId === config.DEFAULT_USER_ID
  }

  async removeUser(userId: string): Promise<void> {
    if (this.isOwner(userId)) {
      throw new Error("Cannot remove owner")
    }
    this.users.delete(userId)
    logger.info(`user removed: ${userId}`)
  }
}

export const multiUser = new MultiUserManager()
