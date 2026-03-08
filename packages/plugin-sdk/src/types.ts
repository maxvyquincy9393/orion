/**
 * @file types.ts
 * @description EDITH Plugin SDK — base types for building extensions and plugins.
 *
 * ARCHITECTURE:
 *   Extensions implement BaseChannelExtension or BaseToolExtension.
 *   Each extension has an ExtensionManifest for discovery by the loader.
 */

export interface ExtensionManifest {
  name: string
  version: string
  description: string
  type: 'channel' | 'tool' | 'skill' | 'hook'
  enabled?: boolean
}

export interface BaseChannelExtension {
  readonly channelId: string
  initialize(): Promise<void>
  send(userId: string, message: string): Promise<void>
  onMessage(handler: (userId: string, message: string) => Promise<void>): void
}

export interface BaseToolExtension {
  readonly toolId: string
  readonly description: string
  execute(params: Record<string, unknown>): Promise<unknown>
}
