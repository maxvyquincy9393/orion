import { createLogger } from "../logger.js"

const log = createLogger("core.voi")

export interface VoIInput {
  userId: string
  messageContent: string
  triggerType: string
  triggerPriority: "low" | "normal" | "urgent"
  currentHour: number
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

const PEAK_HOURS = [9, 10, 11, 14, 15, 16, 17, 18, 19, 20]
const QUIET_HOURS = [0, 1, 2, 3, 4, 5, 6, 22, 23]

export class VoICalculator {
  private readonly threshold = 0.3

  calculate(input: VoIInput): VoIResult {
    try {
      const pUserBenefits = PRIORITY_PROBABILITY[input.triggerPriority] ?? 0.3

      const triggerCategory = this.categorizeTrigger(input.triggerType, input.messageContent)
      const benefitValue = BENEFIT_VALUES[triggerCategory] ?? BENEFIT_VALUES.default

      const disturbanceCost = this.calculateDisturbanceCost(input.currentHour)

      const voi = pUserBenefits * benefitValue - ACTION_COST - disturbanceCost

      const shouldSend = voi > this.threshold

      const reasoning = this.buildReasoning(
        voi,
        shouldSend,
        pUserBenefits,
        benefitValue,
        disturbanceCost,
        triggerCategory
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

  private calculateDisturbanceCost(currentHour: number): number {
    if (QUIET_HOURS.includes(currentHour)) {
      return 0.5
    }
    if (!PEAK_HOURS.includes(currentHour)) {
      return 0.2
    }
    return 0.1
  }

  private buildReasoning(
    voi: number,
    shouldSend: boolean,
    pUserBenefits: number,
    benefitValue: number,
    disturbanceCost: number,
    category: string
  ): string {
    const parts: string[] = []

    parts.push(`VoI score: ${voi.toFixed(2)}`)
    parts.push(`P(user benefits): ${(pUserBenefits * 100).toFixed(0)}%`)
    parts.push(`Benefit value: ${benefitValue.toFixed(1)} (${category})`)
    parts.push(`Disturbance cost: ${disturbanceCost.toFixed(1)}`)

    if (shouldSend) {
      parts.push("Decision: SEND")
    } else {
      parts.push(`Decision: BLOCK (below threshold ${this.threshold})`)
    }

    return parts.join("; ")
  }
}

export const voiCalculator = new VoICalculator()
