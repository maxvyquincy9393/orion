import fs from "node:fs/promises"
import path from "node:path"

import { channelManager } from "../channels/manager.js"
import config from "../config.js"
import { contextPredictor } from "../core/context-predictor.js"
import { eventBus } from "../core/event-bus.js"
import { voiCalculator } from "../core/voi.js"
import { getHistory } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { sandbox, PermissionAction } from "../permissions/sandbox.js"

const log = createLogger("background.heartbeat")

const HEARTBEAT_MD = path.resolve(process.cwd(), "workspace", "HEARTBEAT.md")
const HEARTBEAT_PASS_MARKER = "HEARTBEAT_PASS"
const LEGACY_HEARTBEAT_OK_MARKER = "HEARTBEAT_OK"

const INTERVAL_AFTER_RECENT_ACTIVITY = 2 * 60 * 1000
const INTERVAL_NORMAL = 10 * 60 * 1000
const INTERVAL_INACTIVE = 30 * 60 * 1000
const INACTIVITY_THRESHOLD = 60 * 60 * 1000
const RECENT_ACTIVITY_WINDOW = 5 * 60 * 1000
const MAX_SKIP_INTERVAL = 60 * 60 * 1000

function truncateContent(text: string, maxLength = 120): string {
  if (text.length <= maxLength) {
    return text.replace(/\s+/g, " ").trim()
  }

  return `${text.slice(0, maxLength).replace(/\s+/g, " ").trim()}...`
}

function cleanHeartbeatResponse(response: string): string {
  const withoutMarker = response
    .replace(new RegExp(`\\b${HEARTBEAT_PASS_MARKER}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${LEGACY_HEARTBEAT_OK_MARKER}\\b`, "gi"), "")
    .trim()
  if (!withoutMarker) {
    return ""
  }

  const strippedPunctuation = withoutMarker.replace(/[\s`"']/g, "")
  if (!strippedPunctuation) {
    return ""
  }

  return withoutMarker
}

export class HeartbeatEngine {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private lastActivityTime = Date.now()
  private lastHeartbeatTime = 0
  private consecutiveSkips = 0
  private nextIntervalMs = INTERVAL_NORMAL

  start(): void {
    if (this.running) {
      return
    }

    this.running = true
    log.info("heartbeat engine started")
    this.scheduleNext()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.running = false
    log.info("heartbeat engine stopped")
  }

  recordActivity(at = Date.now()): void {
    if (at > this.lastActivityTime) {
      this.lastActivityTime = at
      this.consecutiveSkips = 0
    }
  }

  isRunning(): boolean {
    return this.running
  }

  getCurrentIntervalMs(): number {
    return this.nextIntervalMs
  }

  private scheduleNext(): void {
    if (!this.running) {
      return
    }

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const interval = this.calculateInterval()
    this.nextIntervalMs = interval

    this.timer = setTimeout(async () => {
      await this.runHeartbeat()
      if (this.running) {
        this.scheduleNext()
      }
    }, interval)
  }

  private calculateInterval(): number {
    const timeSinceActivity = Date.now() - this.lastActivityTime
    const baseInterval = timeSinceActivity < RECENT_ACTIVITY_WINDOW
      ? INTERVAL_AFTER_RECENT_ACTIVITY
      : timeSinceActivity > INACTIVITY_THRESHOLD
        ? INTERVAL_INACTIVE
        : INTERVAL_NORMAL

    if (this.consecutiveSkips === 0) {
      return baseInterval
    }

    const skipMultiplier = Math.min(1 + this.consecutiveSkips * 0.25, 2.5)
    return Math.min(Math.round(baseInterval * skipMultiplier), MAX_SKIP_INTERVAL)
  }

  private noteSkip(reason: string, meta: Record<string, unknown> = {}): void {
    this.consecutiveSkips += 1
    log.debug("heartbeat: no action needed", {
      reason,
      consecutiveSkips: this.consecutiveSkips,
      ...meta,
    })
  }

  private async syncActivityFromHistory(userId: string): Promise<void> {
    const history = await getHistory(userId, 1)
    if (history.length === 0) {
      return
    }

    const latestActivity = history[0].createdAt.getTime()
    this.recordActivity(latestActivity)
  }

  private async runHeartbeat(): Promise<void> {
    const userId = config.DEFAULT_USER_ID
    const startedAt = Date.now()
    this.lastHeartbeatTime = startedAt

    eventBus.dispatch("system.heartbeat", { timestamp: startedAt })

    try {
      await this.syncActivityFromHistory(userId)

      let heartbeatInstructions = ""
      try {
        heartbeatInstructions = await fs.readFile(HEARTBEAT_MD, "utf-8")
      } catch {
        this.noteSkip("HEARTBEAT.md not found")
        return
      }

      const recentHistory = await getHistory(userId, 20)
      const recentSummary = recentHistory
        .slice(0, 10)
        .reverse()
        .map((message, index) => {
          const role = typeof message.role === "string" ? message.role : "unknown"
          return `${index + 1}. ${role}: ${truncateContent(message.content)}`
        })
        .join("\n")

      const currentTime = new Date(startedAt).toLocaleString()
      const minutesSinceLastInteraction = Math.max(
        0,
        Math.round((startedAt - this.lastActivityTime) / 60000),
      )

      const response = await orchestrator.generate("fast", {
        systemPrompt: `You are Orion running a heartbeat reflection cycle.\n\n${heartbeatInstructions}\n\nIf nothing needs attention, reply with exactly ${HEARTBEAT_PASS_MARKER}.\nIf something needs attention, respond only with the message to send.`,
        prompt: `Current time: ${currentTime}\nTime since last user interaction: ${minutesSinceLastInteraction} minutes\n\nRecent conversation summary:\n${recentSummary || "(no recent conversations)"}`,
      })

      const proactiveMessage = cleanHeartbeatResponse(response)
      if (!proactiveMessage) {
        this.noteSkip("model returned HEARTBEAT_PASS")
        return
      }

      const channel = "webchat"
      const context = await contextPredictor.predict(userId, channel)
      const voi = voiCalculator.calculate({
        userId,
        messageContent: proactiveMessage,
        triggerType: "heartbeat",
        triggerPriority: "normal",
        currentHour: new Date(startedAt).getHours(),
        context,
      })

      if (!voi.shouldSend) {
        this.noteSkip("VoI blocked message", {
          score: voi.score,
          reasoning: voi.reasoning,
        })
        return
      }

      const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, userId)
      if (!allowed) {
        this.noteSkip("sandbox blocked proactive message")
        return
      }

      const sent = await channelManager.send(userId, proactiveMessage)
      if (!sent) {
        this.noteSkip("no connected channel available")
        return
      }

      this.consecutiveSkips = 0
      this.recordActivity()
      log.info("heartbeat: proactive message sent", { length: proactiveMessage.length })
    } catch (error) {
      log.error("heartbeat run failed", error)
    }
  }
}

export const heartbeat = new HeartbeatEngine()
