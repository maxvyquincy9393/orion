import { channelManager } from "../channels/manager.js"
import config from "../config.js"
import { logTrigger, getHistory } from "../database/index.js"
import { createLogger } from "../logger.js"
import { triggerEngine } from "./triggers.js"
import { sandbox, PermissionAction } from "../permissions/sandbox.js"

const logger = createLogger("daemon")
const TRIGGERS_FILE = "permissions/triggers.yaml"

const INTERVAL_URGENT_MS = 10 * 1000
const INTERVAL_NORMAL_MS = 60 * 1000
const INTERVAL_LOW_MS = 5 * 60 * 1000
const INACTIVITY_THRESHOLD_MS = 60 * 60 * 1000

export class OrionDaemon {
  private running = false
  private interval: NodeJS.Timeout | null = null
  private currentIntervalMs = INTERVAL_NORMAL_MS
  private lastActivityTime = Date.now()

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    this.lastActivityTime = Date.now()
    logger.info("Daemon started")
    await this.runCycle()
    this.scheduleNextCycle()
  }

  private scheduleNextCycle(): void {
    if (this.interval) {
      clearTimeout(this.interval)
    }

    this.interval = setTimeout(() => {
      void this.runCycle().then(() => this.scheduleNextCycle())
    }, this.currentIntervalMs)
  }

  stop(): void {
    if (this.interval) {
      clearTimeout(this.interval)
    }
    this.interval = null
    this.running = false
    logger.info("Daemon stopped")
  }

  isRunning(): boolean {
    return this.running
  }

  healthCheck(): { running: boolean; uptime: number; triggersLoaded: number; intervalMs: number } {
    return {
      running: this.running,
      uptime: process.uptime(),
      triggersLoaded: triggerEngine.getTriggers().length,
      intervalMs: this.currentIntervalMs,
    }
  }

  private calculateInterval(hasUrgentTrigger: boolean): number {
    if (hasUrgentTrigger) {
      return INTERVAL_URGENT_MS
    }

    const timeSinceActivity = Date.now() - this.lastActivityTime
    if (timeSinceActivity > INACTIVITY_THRESHOLD_MS) {
      return INTERVAL_LOW_MS
    }

    return INTERVAL_NORMAL_MS
  }

  private async checkForActivity(userId: string): Promise<void> {
    try {
      const history = await getHistory(userId, 1)
      if (history.length > 0) {
        const lastMsgTime = history[0].createdAt.getTime()
        if (lastMsgTime > this.lastActivityTime) {
          this.lastActivityTime = lastMsgTime
        }
      }
    } catch (error) {
      logger.error("Failed to check activity", error)
    }
  }

  private async runCycle(): Promise<void> {
    try {
      await triggerEngine.load(TRIGGERS_FILE)
      const userId = config.DEFAULT_USER_ID
      const triggers = await triggerEngine.evaluate(userId)

      await this.checkForActivity(userId)

      let hasUrgentTrigger = false

      for (const trigger of triggers) {
        let actedOn = false
        try {
          const isUrgent = trigger.priority === "urgent" || (trigger as any).confidence > 0.9
          if (isUrgent) {
            hasUrgentTrigger = true
          }

          const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, trigger.userId)
          if (allowed) {
            actedOn = await channelManager.send(trigger.userId, trigger.message)
            if (actedOn) {
              this.lastActivityTime = Date.now()
            }
          }
          await logTrigger(trigger.userId, trigger.name, actedOn)
        } catch (error) {
          logger.error(`Failed to handle trigger ${trigger.name}`, error)
        }
      }

      const newInterval = this.calculateInterval(hasUrgentTrigger)
      if (newInterval !== this.currentIntervalMs) {
        const oldInterval = this.currentIntervalMs
        this.currentIntervalMs = newInterval
        logger.info("Daemon interval adjusted", {
          fromMs: oldInterval,
          toMs: newInterval,
          reason: hasUrgentTrigger ? "urgent trigger" : newInterval === INTERVAL_LOW_MS ? "inactivity" : "normal",
        })
      }
    } catch (error) {
      logger.error("Daemon cycle failed", error)
    }
  }
}

export const daemon = new OrionDaemon()
