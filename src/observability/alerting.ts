/**
 * @file alerting.ts
 * @description Lightweight self-monitoring alerting service.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by daemon.ts on every cycle (approximately every minute).
 *   Checks conditions:
 *     1. Outbox dead-letter accumulation (threshold: ALERT_DEAD_LETTER_THRESHOLD)
 *     2. Circuit breaker open on >= 2 channels simultaneously
 *     3. Error rate exceeding 5% of total messages
 *     4. LLM daily cost budget exceeded
 *     5. Memory pressure (heap > 80%)
 *   Sends self-alert messages to ALERT_USER_ID via channelManager when triggered.
 *   A 30-minute cooldown per alert type prevents alert storms.
 *   Alerts are silent when ALERT_USER_ID is empty (disabled by default).
 *
 * @module observability/alerting
 */

import { channelManager } from "../channels/manager.js"
import { outbox } from "../channels/outbox.js"
import { channelCircuitBreaker } from "../channels/circuit-breaker.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("observability.alerting")

/** Cooldown between repeated alerts of the same type (30 minutes). */
const ALERT_COOLDOWN_MS = 30 * 60 * 1_000

/** Error rate alert cooldown (15 minutes). */
const ERROR_RATE_COOLDOWN_MS = 15 * 60 * 1_000

/** Channels to check for circuit-breaker state. */
const MONITORED_CHANNELS = ["telegram", "discord", "whatsapp", "sms", "email", "webchat"]

/** Error rate threshold (5% of messages). */
const ERROR_RATE_THRESHOLD = 0.05

/** Memory pressure threshold (80% heap usage). */
const MEMORY_PRESSURE_THRESHOLD = 0.80

/**
 * Lightweight self-monitoring alerting service.
 * Instantiate fresh for each test; use the `alertingService` singleton in production.
 */
export class AlertingService {
  /** Last send time per alert type — used to enforce cooldown. */
  private readonly lastAlertAt = new Map<string, number>()

  /** Rolling error count for error rate calculation. */
  private errorCount = 0
  /** Rolling message count for error rate calculation. */
  private messageCount = 0
  /** Last error rate window reset. */
  private lastRateReset = Date.now()

  /** Record an error for rate tracking. */
  recordError(): void {
    this.errorCount++
  }

  /** Record a message for rate tracking. */
  recordMessage(): void {
    this.messageCount++
  }

  /**
   * Run all alert checks. Call once per daemon cycle.
   * No-op if ALERT_USER_ID is not configured.
   */
  async check(): Promise<void> {
    if (!config.ALERT_USER_ID) return
    await Promise.all([
      this.checkDeadLetters(),
      this.checkCircuitBreakers(),
      this.checkErrorRate(),
      this.checkMemoryPressure(),
      this.checkLLMCostBudget(),
    ])
  }

  /** Check outbox dead-letter accumulation. */
  private async checkDeadLetters(): Promise<void> {
    const { deadLetters } = outbox.getStatus()
    if (deadLetters >= config.ALERT_DEAD_LETTER_THRESHOLD) {
      await this.sendAlert(
        "dead-letter",
        `[EDITH Alert] Outbox dead-letter count reached ${deadLetters} — messages are being dropped after max retries.`,
      )
    }
  }

  /** Check if multiple circuit breakers are open simultaneously. */
  private async checkCircuitBreakers(): Promise<void> {
    const open = MONITORED_CHANNELS.filter(
      (ch) => channelCircuitBreaker.getState(ch) === "open",
    )
    if (open.length >= 2) {
      await this.sendAlert(
        "circuit-breaker",
        `[EDITH Alert] circuit breaker open on ${open.length} channels: ${open.join(", ")}.`,
      )
    }
  }

  /**
   * Check error rate over the rolling window.
   * Alerts when errors exceed 5% of total messages processed.
   * Window resets every 5 minutes.
   */
  private async checkErrorRate(): Promise<void> {
    const now = Date.now()
    const windowMs = 5 * 60 * 1_000

    // Reset window every 5 minutes
    if (now - this.lastRateReset > windowMs) {
      this.errorCount = 0
      this.messageCount = 0
      this.lastRateReset = now
      return
    }

    if (this.messageCount < 10) return // Not enough samples
    const rate = this.errorCount / this.messageCount
    if (rate > ERROR_RATE_THRESHOLD) {
      await this.sendAlert(
        "error-rate",
        `[EDITH Alert] Error rate ${(rate * 100).toFixed(1)}% (${this.errorCount}/${this.messageCount}) exceeds threshold of ${ERROR_RATE_THRESHOLD * 100}%.`,
        ERROR_RATE_COOLDOWN_MS,
      )
    }
  }

  /**
   * Check LLM daily cost budget.
   * Uses prisma.usageEvent if available, otherwise no-op.
   */
  private async checkLLMCostBudget(): Promise<void> {
    const budget = config.LLM_DAILY_BUDGET_USD
    if (!budget || budget <= 0) return

    try {
      const { prisma } = await import("../database/index.js")
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1_000)
      const result = await prisma.usageEvent.aggregate({
        _sum: { estimatedCostUsd: true },
        where: { timestamp: { gte: dayAgo } },
      })
      const total = result._sum.estimatedCostUsd ?? 0
      if (total > budget) {
        await this.sendAlert(
          "cost-budget",
          `[EDITH Alert] LLM cost $${total.toFixed(2)} exceeded daily budget of $${budget.toFixed(2)}.`,
        )
      }
    } catch {
      // UsageEvent model may not exist yet — silently skip
    }
  }

  /**
   * Check process memory pressure.
   * Alerts when heap usage exceeds 80% of total heap size.
   */
  private async checkMemoryPressure(): Promise<void> {
    const mem = process.memoryUsage()
    const ratio = mem.heapUsed / mem.heapTotal
    if (ratio > MEMORY_PRESSURE_THRESHOLD) {
      const usedMB = (mem.heapUsed / 1024 / 1024).toFixed(0)
      const totalMB = (mem.heapTotal / 1024 / 1024).toFixed(0)
      await this.sendAlert(
        "memory-pressure",
        `[EDITH Alert] Memory pressure: heap ${usedMB}MB / ${totalMB}MB (${(ratio * 100).toFixed(1)}%).`,
      )
    }
  }

  /**
   * Send an alert to ALERT_USER_ID, respecting the cooldown window.
   *
   * @param type - Alert type identifier for cooldown tracking
   * @param message - Alert message text
   */
  private async sendAlert(type: string, message: string, cooldownMs = ALERT_COOLDOWN_MS): Promise<void> {
    const now = Date.now()
    const lastSent = this.lastAlertAt.get(type) ?? 0
    if (now - lastSent < cooldownMs) return

    this.lastAlertAt.set(type, now)
    log.warn("sending self-alert", { type, userId: config.ALERT_USER_ID })
    await channelManager.send(config.ALERT_USER_ID, message)
      .catch((err) => log.warn("alert send failed", { type, err: String(err) }))
  }
}

/** Singleton alerting service. */
export const alertingService = new AlertingService()
