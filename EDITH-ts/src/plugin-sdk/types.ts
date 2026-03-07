import type { Hook } from "../hooks/registry.js"

export interface NovaPlugin {
  name: string
  version: string
  description: string
  hooks?: Hook[]
  tools?: Record<string, unknown>
  onLoad?: () => Promise<void>
  onUnload?: () => Promise<void>
}
