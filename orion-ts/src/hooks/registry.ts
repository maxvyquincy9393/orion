export type HookType = "pre_message" | "post_message" | "pre_tool" | "post_tool" | "pre_send" | "post_send"

export interface HookContext {
  userId: string
  channel: string
  content: string
  metadata: Record<string, unknown>
  abort?: boolean
  abortReason?: string
}

export interface Hook {
  name: string
  type: HookType
  priority: number
  handler: (context: HookContext) => Promise<HookContext>
}

export class HookRegistry {
  private readonly hooks = new Map<string, Hook>()

  register(hook: Hook): void {
    this.hooks.set(hook.name, hook)
  }

  unregister(name: string): void {
    this.hooks.delete(name)
  }

  getHooks(type: HookType): Hook[] {
    return Array.from(this.hooks.values())
      .filter((hook) => hook.type === type)
      .sort((a, b) => b.priority - a.priority)
  }
}

export const hookRegistry = new HookRegistry()
