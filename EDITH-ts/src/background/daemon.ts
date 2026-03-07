import crypto from "node:crypto"

import { channelManager } from "../channels/manager.js"
import config from "../config.js"
import { getHistory, getLatestTriggerLog, logTrigger } from "../database/index.js"
import { createLogger } from "../logger.js"
import { triggerEngine } from "./triggers.js"
import { sandbox, PermissionAction } from "../permissions/sandbox.js"
import { pairingManager } from "../pairing/manager.js"
import { temporalIndex } from "../memory/temporal-index.js"
import { contextPredictor } from "../core/context-predictor.js"
import { voiCalculator } from "../core/voi.js"
import { acpRouter } from "../acp/router.js"
import { signMessage, type ACPMessage, type AgentCredential } from "../acp/protocol.js"
import { eventBus } from "../core/event-bus.js"
import { heartbeat } from "./heartbeat.js"
import { isWithinHardQuietHours } from "./quiet-hours.js"
import { multiUser } from "../multiuser/manager.js"

const logger = createLogger("daemon")
const TRIGGERS_FILE = "permissions/triggers.yaml"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const TRIGGER_COOLDOWN_MS = Math.max(0, config.DAEMON_TRIGGER_COOLDOWN_MINUTES) * 60_000

function buildTriggerDedupKey(userId: string, triggerName: string): string {
  return `${userId}::${triggerName}`
}

function isTriggerWithinCooldown(lastFiredAtMs: number, nowMs: number, cooldownMs: number): boolean {
  if (cooldownMs <= 0) {
    return false
  }
  return nowMs - lastFiredAtMs < cooldownMs
}

function computeTargetUserIds(defaultUserId: string, users: Array<{ userId: string }>): string[] {
  const userIds = new Set<string>([defaultUserId])
  for (const user of users) {
    if (typeof user.userId === "string" && user.userId.trim().length > 0) {
      userIds.add(user.userId)
    }
  }
  return Array.from(userIds)
}

export class EdithDaemon {
  private running = false
  private lastActivityTime = Date.now()
  private cycleInProgress = false
  private eventSubscriptionsInitialized = false
  private lastTemporalMaintenanceAt = new Map<string, number>()
  private inCycleTriggerDedup = new Set<string>()
  private readonly credential: AgentCredential

  constructor() {
    this.credential = acpRouter.registerAgent(
      "daemon",
      ["daemon.health", "daemon.start", "daemon.stop"],
      async (message) => this.handleACPMessage(message),
    )
  }

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    this.lastActivityTime = Date.now()
    heartbeat.recordActivity(this.lastActivityTime)
    this.initializeEventSubscriptions()
    logger.info("Daemon started (heartbeat mode)")
    await this.runCycle()
    heartbeat.start()
  }

  private initializeEventSubscriptions(): void {
    if (this.eventSubscriptionsInitialized) {
      return
    }

    this.eventSubscriptionsInitialized = true

    eventBus.on("user.message.received", async (data) => {
      if (!this.running) {
        return
      }

      if (data.timestamp > this.lastActivityTime) {
        this.lastActivityTime = data.timestamp
        heartbeat.recordActivity(data.timestamp)
      }
    })

    eventBus.on("system.heartbeat", async () => {
      if (!this.running) {
        return
      }

      if (this.cycleInProgress) {
        logger.debug("Skipping heartbeat while previous cycle is running")
        return
      }

      this.cycleInProgress = true
      try {
        await this.runCycle()
      } finally {
        this.cycleInProgress = false
      }
    })
  }

  stop(): void {
    heartbeat.stop()
    this.cycleInProgress = false
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
      intervalMs: heartbeat.isRunning() ? heartbeat.getCurrentIntervalMs() : 0,
    }
  }

  private async checkForActivity(userId: string): Promise<void> {
    try {
      const history = await getHistory(userId, 1)
      if (history.length > 0) {
        const lastMsgTime = history[0].createdAt.getTime()
        if (lastMsgTime > this.lastActivityTime) {
          this.lastActivityTime = lastMsgTime
          heartbeat.recordActivity(lastMsgTime)
        }
      }
    } catch (error) {
      logger.error("Failed to check activity", error)
    }
  }

  private async runCycle(): Promise<void> {
    try {
      await triggerEngine.load(TRIGGERS_FILE)
      await pairingManager.cleanupExpired()
      const userIds = this.collectTargetUserIds()

      const now = new Date()
      const blockedByQuietHours = isWithinHardQuietHours(now)

      this.inCycleTriggerDedup.clear()

      for (const userId of userIds) {
        await this.checkForActivity(userId)
        await this.maybeRunTemporalMaintenance(userId)

        const triggers = await triggerEngine.evaluate(userId)
        for (const trigger of triggers) {
          let actedOn = false
          try {
            const dedupKey = buildTriggerDedupKey(trigger.userId, trigger.name)
            if (config.DAEMON_TRIGGER_DEDUP_ENABLED && this.inCycleTriggerDedup.has(dedupKey)) {
              logger.debug("Trigger deduped within cycle", { userId: trigger.userId, trigger: trigger.name })
              continue
            }
            this.inCycleTriggerDedup.add(dedupKey)

            if (await this.isTriggerOnCooldown(trigger.userId, trigger.name, Date.now())) {
              logger.info("Trigger skipped by cooldown", {
                userId: trigger.userId,
                trigger: trigger.name,
                cooldownMinutes: config.DAEMON_TRIGGER_COOLDOWN_MINUTES,
              })
              await logTrigger(trigger.userId, trigger.name, false)
              continue
            }

            if (blockedByQuietHours) {
              logger.info("Trigger blocked by hard quiet-hours gate", {
                trigger: trigger.name,
                userId: trigger.userId,
                hour: now.getHours(),
              })
              await logTrigger(trigger.userId, trigger.name, false)
              continue
            }

            const channel = "webchat"
            const context = await contextPredictor.predict(trigger.userId, channel)
            const voi = voiCalculator.calculate({
              userId: trigger.userId,
              messageContent: trigger.message,
              triggerType: trigger.type,
              triggerPriority: trigger.priority ?? "normal",
              currentHour: new Date().getHours(),
              context,
            })

            if (!voi.shouldSend) {
              logger.info("Trigger skipped by VoI", {
                trigger: trigger.name,
                userId: trigger.userId,
                score: voi.score,
                reasoning: voi.reasoning,
              })
              await logTrigger(trigger.userId, trigger.name, false)
              continue
            }

            const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, trigger.userId)
            if (allowed) {
              actedOn = await channelManager.send(trigger.userId, trigger.message)
              if (actedOn) {
                this.lastActivityTime = Date.now()
                heartbeat.recordActivity(this.lastActivityTime)
                eventBus.dispatch("trigger.fired", {
                  triggerName: trigger.name,
                  userId: trigger.userId,
                  message: trigger.message,
                  priority: trigger.priority ?? "normal",
                })
              }
            }
            await logTrigger(trigger.userId, trigger.name, actedOn)
          } catch (error) {
            logger.error(`Failed to handle trigger ${trigger.name}`, error)
          }
        }
      }
    } catch (error) {
      logger.error("Daemon cycle failed", error)
    }
  }

  private async maybeRunTemporalMaintenance(userId: string): Promise<void> {
    const now = Date.now()
    const previous = this.lastTemporalMaintenanceAt.get(userId) ?? 0
    if (now - previous < WEEK_MS) {
      return
    }

    await temporalIndex.runMaintenance(userId)
    this.lastTemporalMaintenanceAt.set(userId, now)
  }

  private collectTargetUserIds(): string[] {
    return computeTargetUserIds(config.DEFAULT_USER_ID, multiUser.listUsers())
  }

  private async isTriggerOnCooldown(userId: string, triggerName: string, nowMs: number): Promise<boolean> {
    if (TRIGGER_COOLDOWN_MS <= 0) {
      return false
    }

    const latest = await getLatestTriggerLog(userId, triggerName)
    if (!latest || !latest.actedOn) {
      return false
    }

    return isTriggerWithinCooldown(latest.firedAt.getTime(), nowMs, TRIGGER_COOLDOWN_MS)
  }

  private async handleACPMessage(message: ACPMessage): Promise<ACPMessage> {
    let payload: unknown

    if (message.action === "daemon.health") {
      payload = this.healthCheck()
    } else if (message.action === "daemon.start") {
      await this.start()
      payload = { running: this.running }
    } else if (message.action === "daemon.stop") {
      this.stop()
      payload = { running: this.running }
    } else {
      payload = { error: `unknown action: ${message.action}` }
    }

    const responseNoSignature = {
      id: crypto.randomUUID(),
      from: "daemon",
      to: message.from,
      type: "response" as const,
      action: message.action,
      payload,
      correlationId: message.id,
      timestamp: Date.now(),
      state: "done" as const,
    }

    return {
      ...responseNoSignature,
      signature: signMessage(responseNoSignature, this.credential.secret),
    }
  }
}

export const daemon = new EdithDaemon()

export const __daemonTestUtils = {
  buildTriggerDedupKey,
  isTriggerWithinCooldown,
  computeTargetUserIds,
}
