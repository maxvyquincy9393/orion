import { createLogger } from "../logger.js"
import type { MultiDimContext } from "./context-predictor.js"

const log = createLogger("core.voi")

export interface VoIInput {
  userId: string
  messageContent: string
  triggerType: string
  triggerPriority: "low" | "normal" | "urgent"
  currentHour: number
  context: MultiDimContext
}

export interface VoIResult {
  score: number
  shouldSend: boolean
  reasoning: string
}

const PRIORITY_PROBABILITY: Record<string, number> = {
  urgent: 0.9,
  normal: 0.6,
  low: 0.3,
}

const BENEFIT_VALUES: Record<string, number> = {
  reminder: 1.0,
  deadline: 1.0,
  alert: 0.8,
  "check-in": 0.4,
  notification: 0.5,
  update: 0.3,
  default: 0.5,
}

const ACTION_COST = 0.1

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

export class VoICalculator {
  private readonly threshold = 0.3

  calculate(input: VoIInput): VoIResult {
    try {
      const baseProbability = PRIORITY_PROBABILITY[input.triggerPriority] ?? 0.3
      const pUserBenefits = this.adjustBenefitProbability(baseProbability, input.context)

      const triggerCategory = this.categorizeTrigger(input.triggerType, input.messageContent)
      const benefitValue = BENEFIT_VALUES[triggerCategory] ?? BENEFIT_VALUES.default

      const disturbanceCost = this.calculateDisturbanceCost(input.currentHour, input.context)
      const voi = pUserBenefits * benefitValue - ACTION_COST - disturbanceCost
      const shouldSend = voi > this.threshold

      const reasoning = this.buildReasoning(
        voi,
        shouldSend,
        pUserBenefits,
        benefitValue,
        disturbanceCost,
        triggerCategory,
        input.context,
      )

      if (!shouldSend) {
        log.debug("VoI check: message blocked", {
          userId: input.userId,
          voi,
          threshold: this.threshold,
          reason: reasoning,
        })
      }

      return {
        score: voi,
        shouldSend,
        reasoning,
      }
    } catch (error) {
      log.error("VoI calculation error", error)
      return {
        score: 0,
        shouldSend: true,
        reasoning: "Defaulting to send due to calculation error",
      }
    }
  }

  private adjustBenefitProbability(baseProbability: number, context: MultiDimContext): number {
    let adjusted = baseProbability

    if (context.typicalActiveHour) {
      adjusted += 0.2
    }

    if (context.channelActivity >= 0.6) {
      adjusted += 0.1
    } else if (context.channelActivity <= 0.2) {
      adjusted -= 0.05
    }

    if (context.urgencySignals.length > 0) {
      adjusted += 0.08
    }

    return clamp(adjusted)
  }

  private categorizeTrigger(triggerType: string, content: string): string {
    const type = triggerType.toLowerCase()
    const text = content.toLowerCase()

    if (type.includes("reminder") || text.includes("remind")) {
      return "reminder"
    }
    if (type.includes("deadline") || text.includes("deadline") || text.includes("due")) {
      return "deadline"
    }
    if (type.includes("alert") || text.includes("alert") || text.includes("warning")) {
      return "alert"
    }
    if (type.includes("check") || text.includes("how are") || text.includes("checking in")) {
      return "check-in"
    }
    if (type.includes("notif") || text.includes("update")) {
      return "notification"
    }
    if (type.includes("update")) {
      return "update"
    }
    return "default"
  }

  private calculateDisturbanceCost(currentHour: number, context: MultiDimContext): number {
    const quietHours = [0, 1, 2, 3, 4, 5, 6, 22, 23]

    if (context.conversationRecency < 5 / 60) {
      return 0.1
    }

    if (!context.typicalActiveHour || quietHours.includes(currentHour)) {
      return 0.5
    }

    if (context.conversationRecency > 8) {
      return 0.4
    }

    if (context.conversationRecency > 2) {
      return 0.25
    }

    return 0.15
  }

  private buildReasoning(
    voi: number,
    shouldSend: boolean,
    pUserBenefits: number,
    benefitValue: number,
    disturbanceCost: number,
    category: string,
    context: MultiDimContext,
  ): string {
    const parts: string[] = []

    parts.push(`VoI score: ${voi.toFixed(2)}`)
    parts.push(`P(user benefits): ${(pUserBenefits * 100).toFixed(0)}%`)
    parts.push(`Benefit value: ${benefitValue.toFixed(1)} (${category})`)
    parts.push(`Disturbance cost: ${disturbanceCost.toFixed(1)}`)
    parts.push(`Recency(h): ${context.conversationRecency.toFixed(2)}`)
    parts.push(`Channel activity: ${context.channelActivity.toFixed(2)}`)
    parts.push(`Typical hour: ${context.typicalActiveHour}`)

    if (shouldSend) {
      parts.push("Decision: SEND")
    } else {
      parts.push(`Decision: BLOCK (below threshold ${this.threshold})`)
    }

    return parts.join("; ")
  }
}

export const voiCalculator = new VoICalculator()
