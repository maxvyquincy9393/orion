import { EventEmitter } from "node:events"

import { createLogger } from "../logger.js"

const log = createLogger("core.event-bus")

export type OrionEvent =
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

class OrionEventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
  }

  emit<T extends OrionEvent["type"]>(
    eventType: T,
    data: Extract<OrionEvent, { type: T }>,
  ): boolean {
    log.debug("event emitted", { type: eventType })
    return super.emit(eventType, data)
  }

  on<T extends OrionEvent["type"]>(
    eventType: T,
    listener: (data: Extract<OrionEvent, { type: T }>) => void | Promise<void>,
  ): this {
    return super.on(eventType, (data: Extract<OrionEvent, { type: T }>) => {
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

  dispatch<T extends OrionEvent["type"]>(
    eventType: T,
    data: Omit<Extract<OrionEvent, { type: T }>, "type">,
  ): void {
    const fullData = { ...data, type: eventType } as Extract<OrionEvent, { type: T }>
    this.emit(eventType, fullData)
  }
}

export const eventBus = new OrionEventBus()
