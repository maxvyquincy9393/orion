import fs from "node:fs"

import yaml from "js-yaml"

import { getHistory } from "../database/index.js"
import { createLogger } from "../logger.js"

const logger = createLogger("trigger-engine")

export enum TriggerType {
  SCHEDULED = "scheduled",
  INACTIVITY = "inactivity",
  PATTERN = "pattern",
  WEBHOOK = "webhook",
}

export type TriggerPriority = "low" | "normal" | "urgent"

export interface Trigger {
  id: string
  name: string
  type: TriggerType
  enabled: boolean
  priority?: TriggerPriority
  confidence?: number
  schedule?: string
  inactivityMinutes?: number
  message: string
  userId: string
}

class TriggerEngine {
  private triggers: Trigger[] = []

  async load(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      this.triggers = []
      logger.warn(`Triggers file missing: ${filePath}`)
      return
    }

    const raw = fs.readFileSync(filePath, "utf-8")
    const parsed = yaml.load(raw)

    if (!Array.isArray(parsed)) {
      this.triggers = []
      logger.warn("Triggers file did not contain a list")
      return
    }

    this.triggers = parsed as Trigger[]
    logger.info(`Loaded ${this.triggers.length} triggers`)
  }

  async evaluate(userId: string): Promise<Trigger[]> {
    const now = new Date()
    const matches: Trigger[] = []

    for (const trigger of this.triggers) {
      if (!trigger.enabled || trigger.userId !== userId) {
        continue
      }

      if (trigger.type === TriggerType.SCHEDULED && trigger.schedule) {
        if (cronMatchesNow(trigger.schedule, now)) {
          matches.push(trigger)
        }
      }

      if (trigger.type === TriggerType.INACTIVITY && trigger.inactivityMinutes) {
        const history = await getHistory(userId, 1)
        if (history.length === 0) {
          matches.push(trigger)
          continue
        }
        const last = history[0].createdAt
        const deltaMinutes = (now.getTime() - new Date(last).getTime()) / 60000
        if (deltaMinutes >= trigger.inactivityMinutes) {
          matches.push(trigger)
        }
      }
    }

    return matches
  }

  getTriggers(): Trigger[] {
    return this.triggers
  }

  addTrigger(trigger: Trigger): void {
    this.triggers.push(trigger)
  }

  removeTrigger(id: string): void {
    this.triggers = this.triggers.filter((trigger) => trigger.id !== id)
  }
}

function cronMatchesNow(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return false
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  return (
    fieldMatches(minute, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(dayOfMonth, date.getDate(), 1, 31) &&
    fieldMatches(month, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dayOfWeek, date.getDay(), 0, 6)
  )
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") {
    return true
  }

  const segments = field.split(",")
  for (const segment of segments) {
    if (segment.includes("/")) {
      const [base, stepRaw] = segment.split("/")
      const step = Number.parseInt(stepRaw, 10)
      if (Number.isNaN(step) || step <= 0) {
        continue
      }
      const baseRange = base === "*" ? `${min}-${max}` : base
      if (rangeMatches(baseRange, value, step)) {
        return true
      }
      continue
    }

    if (rangeMatches(segment, value)) {
      return true
    }
  }

  return false
}

function rangeMatches(segment: string, value: number, step = 1): boolean {
  if (segment.includes("-")) {
    const [startRaw, endRaw] = segment.split("-")
    const start = Number.parseInt(startRaw, 10)
    const end = Number.parseInt(endRaw, 10)
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return false
    }
    if (value < start || value > end) {
      return false
    }
    return (value - start) % step === 0
  }

  const numeric = Number.parseInt(segment, 10)
  if (Number.isNaN(numeric)) {
    return false
  }
  if (step <= 1) {
    return value === numeric
  }
  return value >= numeric && (value - numeric) % step === 0
}

export const triggerEngine = new TriggerEngine()
