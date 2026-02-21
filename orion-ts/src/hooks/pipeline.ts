import { createLogger } from "../logger.js"
import { hookRegistry, type HookContext, type HookType, type HookRegistry } from "./registry.js"

const log = createLogger("hooks.pipeline")

export class HookPipeline {
  constructor(private readonly registry: HookRegistry) {}

  async run(type: HookType, context: HookContext): Promise<HookContext> {
    let currentContext = { ...context, metadata: { ...context.metadata } }
    const hooks = this.registry.getHooks(type)

    for (const hook of hooks) {
      if (currentContext.abort) {
        break
      }

      try {
        currentContext = await hook.handler(currentContext)
      } catch (error) {
        log.warn("Hook handler failed", {
          hook: hook.name,
          type,
          error,
        })
      }
    }

    return currentContext
  }
}

export const hookPipeline = new HookPipeline(hookRegistry)
