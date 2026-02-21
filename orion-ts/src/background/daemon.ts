import { channelManager } from "../channels/manager.js"
import config from "../config.js"
import { logTrigger } from "../database/index.js"
import { createLogger } from "../logger.js"
import { triggerEngine } from "./triggers.js"

const logger = createLogger("daemon")
const TRIGGERS_FILE = "permissions/triggers.yaml"

const sandbox = {
  async isAllowed(): Promise<boolean> {
    return true
  },
}

export class OrionDaemon {
  private running = false
  private interval: NodeJS.Timeout | null = null
  private readonly LOOP_SECONDS = 60

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    logger.info("Daemon started")
    await this.runCycle()

    this.interval = setInterval(() => {
      void this.runCycle()
    }, this.LOOP_SECONDS * 1000)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
    }
    this.interval = null
    this.running = false
    logger.info("Daemon stopped")
  }

  isRunning(): boolean {
    return this.running
  }

  healthCheck(): { running: boolean; uptime: number; triggersLoaded: number } {
    return {
      running: this.running,
      uptime: process.uptime(),
      triggersLoaded: triggerEngine.getTriggers().length,
    }
  }

  private async runCycle(): Promise<void> {
    try {
      await triggerEngine.load(TRIGGERS_FILE)
      const userId = config.DEFAULT_USER_ID
      const triggers = await triggerEngine.evaluate(userId)

      for (const trigger of triggers) {
        let actedOn = false
        try {
          const allowed = await sandbox.isAllowed()
          if (allowed) {
            actedOn = await channelManager.send(trigger.userId, trigger.message)
          }
          await logTrigger(trigger.userId, trigger.name, actedOn)
        } catch (error) {
          logger.error(`Failed to handle trigger ${trigger.name}`, error)
        }
      }
    } catch (error) {
      logger.error("Daemon cycle failed", error)
    }
  }
}

export const daemon = new OrionDaemon()
