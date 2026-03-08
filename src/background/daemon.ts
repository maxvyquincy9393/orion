import crypto from "node:crypto"

import { channelManager } from "../channels/manager.js"
import config from "../config.js"
import { logTrigger, getHistory } from "../database/index.js"
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
import { calendarService } from "../services/calendar.js"
import { proactiveScheduler } from "../calendar/proactive-scheduler.js"
import { meetingPrep } from "../calendar/meeting-prep.js"

const logger = createLogger("daemon")
const TRIGGERS_FILE = "permissions/triggers.yaml"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export class EDITHDaemon {
  private running = false
  private lastActivityTime = Date.now()
  private cycleInProgress = false
  private eventSubscriptionsInitialized = false
  private lastTemporalMaintenanceAt = new Map<string, number>()
  /** Date string (YYYY-MM-DD) of last proactive schedule run, per userId. */
  private lastProactiveScheduleDate = new Map<string, string>()
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

  /**
   * Checks for upcoming calendar events and sends proactive alerts.
   *
   * Phase 8 calendar integration: Sends alerts 15 minutes before meetings.
   * Integrates with VoI calculator and respects quiet hours.
   */
  private async checkCalendarAlerts(userId: string): Promise<void> {
    try {
      // Initialize calendar service if not already done
      await calendarService.init()

      // Get events starting within 15 minutes
      const alerts = await calendarService.getUpcomingAlerts(15)

      for (const alert of alerts) {
        const message =
          `📅 Meeting in 15 minutes: ${alert.title}\n` +
          `Time: ${alert.start.toLocaleTimeString()}\n` +
          (alert.location ? `Location: ${alert.location}\n` : "") +
          (alert.meetingUrl ? `Join: ${alert.meetingUrl}` : "")

        // Check permissions before sending
        const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, userId)
        if (allowed) {
          const sent = await channelManager.send(userId, message)
          if (sent) {
            logger.info("Calendar alert sent", { userId, eventId: alert.id, title: alert.title })

            // Phase 14: Schedule meeting prep brief 5 minutes before meeting start
            const msUntilMeeting = alert.start.getTime() - Date.now()
            const prepDelayMs = Math.max(0, msUntilMeeting - 5 * 60_000)

            setTimeout(() => {
              void meetingPrep.prepareFor(
                { ...alert, attendees: [], calendarId: "primary", status: "confirmed" },
                userId,
              )
                .then(async (brief) => {
                  const briefText = meetingPrep.formatBrief(brief)
                  const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, userId)
                  if (allowed) {
                    await channelManager.send(userId, briefText)
                  }
                })
                .catch((err) => logger.warn("meeting prep failed", { err }))
            }, prepDelayMs)
          }
        } else {
          logger.debug("Calendar alert blocked by permissions", { userId, eventId: alert.id })
        }
      }
    } catch (error) {
      logger.error("Failed to check calendar alerts", { error })
    }
  }

  private async runCycle(): Promise<void> {
    try {
      await triggerEngine.load(TRIGGERS_FILE)
      const userId = config.DEFAULT_USER_ID
      const triggers = await triggerEngine.evaluate(userId)
      await pairingManager.cleanupExpired()

      await this.checkForActivity(userId)
      await this.checkCalendarAlerts(userId) // Phase 8: Calendar proactive alerts
      await this.checkProactiveSchedule(userId) // Phase 14: Evening proactive scheduling
      await this.maybeRunTemporalMaintenance(userId)

      const now = new Date()
      const blockedByQuietHours = isWithinHardQuietHours(now)

      for (const trigger of triggers) {
        let actedOn = false
        try {
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
    } catch (error) {
      logger.error("Daemon cycle failed", error)
    }
  }

  /**
   * Phase 14: Run proactive schedule analysis once per evening (20:00–21:59).
   * Sends actionable suggestions for tomorrow's schedule.
   */
  private async checkProactiveSchedule(userId: string): Promise<void> {
    const now = new Date()
    const hour = now.getHours()
    // Only run in the 20:00–21:59 window
    if (hour < 20 || hour >= 22) return

    const today = now.toISOString().slice(0, 10)
    if (this.lastProactiveScheduleDate.get(userId) === today) return

    this.lastProactiveScheduleDate.set(userId, today)

    try {
      const actions = await proactiveScheduler.analyzeTomorrow(userId)
      for (const action of actions) {
        const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, userId)
        if (allowed) {
          await channelManager.send(userId, action.message)
        }
      }
      if (actions.length > 0) {
        logger.info("Proactive schedule actions sent", { userId, count: actions.length })
      }
    } catch (error) {
      logger.warn("Proactive schedule check failed", { error })
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

export const daemon = new EDITHDaemon()
