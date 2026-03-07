import { EventEmitter } from "node:events"

import { createLogger } from "../logger.js"

const log = createLogger("core.event-bus")

export type EdithEvent =
  | {
    type: "user.message.received"
    userId: string
    content: string
    channel: string
    timestamp: number
  }
  | {
    type: "user.message.sent"
    userId: string
    content: string
    channel: string
    timestamp: number
  }
  | {
    type: "memory.save.requested"
    userId: string
    content: string
    metadata: Record<string, unknown>
  }
  | {
    type: "trigger.fired"
    triggerName: string
    userId: string
    message: string
    priority: string
  }
  | {
    type: "channel.connected"
    channelName: string
  }
  | {
    type: "channel.disconnected"
    channelName: string
    reason?: string
  }
  | {
    type: "memory.consolidate.requested"
    userId: string
  }
  | {
    type: "profile.update.requested"
    userId: string
    content: string
  }
  | {
    type: "causal.update.requested"
    userId: string
    content: string
  }
  | {
    type: "system.heartbeat"
    timestamp: number
  }

class EdithEventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
  }

  emit<T extends EdithEvent["type"]>(
    eventType: T,
    data: Extract<EdithEvent, { type: T }>,
  ): boolean {
    log.debug("event emitted", { type: eventType })
    return super.emit(eventType, data)
  }

  on<T extends EdithEvent["type"]>(
    eventType: T,
    listener: (data: Extract<EdithEvent, { type: T }>) => void | Promise<void>,
  ): this {
    return super.on(eventType, (data: Extract<EdithEvent, { type: T }>) => {
      try {
        const result = listener(data)
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            log.error(`Event handler error for ${eventType}`, error)
          })
        }
      } catch (error) {
        log.error(`Event handler error for ${eventType}`, error)
      }
    })
  }

  dispatch<T extends EdithEvent["type"]>(
    eventType: T,
    data: Omit<Extract<EdithEvent, { type: T }>, "type">,
  ): void {
    const fullData = { ...data, type: eventType } as Extract<EdithEvent, { type: T }>
    this.emit(eventType, fullData)
  }
}

export const eventBus = new EdithEventBus()
