/**
 * channelSendTool — Agent-initiated message sending to user channels.
 *
 * Allows the agent (not just the daemon) to proactively send messages
 * to any connected channel: WhatsApp, Telegram, Signal, LINE, etc.
 *
 * Security gates:
 *   - Only sends to channels the user is subscribed to
 *   - Rate limit: max 10 proactive sends per 5 minutes per channel
 *   - Requires ORION_ALLOW_PROACTIVE_CHANNEL_SEND=true
 *
 * @module agents/tools/channel-send
 */
import { tool } from "ai"
import { z } from "zod"
import { channelManager } from "../../channels/manager.js"
import { sandbox, PermissionAction } from "../../permissions/sandbox.js"
import config from "../../config.js"
import { createLogger } from "../../logger.js"

const log = createLogger("tools.channel-send")

// Simple in-memory rate limiter per channel
const sendCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 5 * 60 * 1_000

function checkRateLimit(channel: string): boolean {
  const now = Date.now()
  const entry = sendCounts.get(channel)

  if (!entry || now > entry.resetAt) {
    sendCounts.set(channel, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT) {
    return false
  }

  entry.count += 1
  return true
}

export const channelSendTool = tool({
  description: `Send a message to a communication channel (WhatsApp, Telegram, Signal, LINE, etc).
Requires ORION_ALLOW_PROACTIVE_CHANNEL_SEND=true in config.
Use for: sending reminders, alerts, summaries to user's messaging apps.
Note: Rate limited to 10 messages per 5 minutes per channel.`,
  inputSchema: z.object({
    channel: z.string().describe("Channel name: whatsapp, telegram, signal, line, webchat, etc."),
    message: z.string().describe("Message text to send"),
    userId: z.string().default("owner").describe("User ID to send to"),
  }),
  execute: async ({ channel, message, userId }) => {
    // Guard: permission must be explicitly enabled
    if (!config.ALLOW_PROACTIVE_CHANNEL_SEND) {
      return "Channel send not enabled. Set ORION_ALLOW_PROACTIVE_CHANNEL_SEND=true to allow."
    }

    // Guard: permission sandbox check
    const allowed = await sandbox.check(PermissionAction.PROACTIVE_MESSAGE, userId)
    if (!allowed) {
      log.warn("channelSendTool blocked by sandbox", { userId, channel })
      return "Send blocked by permission sandbox."
    }

    // Guard: rate limit
    const rateKey = `${userId}:${channel}`
    if (!checkRateLimit(rateKey)) {
      return `Rate limit reached for channel '${channel}'. Max 10 messages per 5 minutes.`
    }

    const sent = await channelManager.send(userId, message)
    if (!sent) {
      return `Failed to send to '${channel}'. Channel may not be connected.`
    }

    log.info("channelSendTool sent message", { channel, userId, chars: message.length })
    return `Message sent to ${channel} (${message.length} chars)`
  },
})

/**
 * channelStatusTool — Check which channels are currently connected.
 *
 * @module agents/tools/channel-status
 */
export const channelStatusTool = tool({
  description: `Check which messaging channels are currently connected (WhatsApp, Telegram, Signal, LINE, etc).
Returns channel names, connection status, and last activity time.
Use before channelSendTool to verify a channel is connected.`,
  inputSchema: z.object({}),
  execute: async () => {
    const channels = channelManager.getConnectedChannels()

    if (channels.length === 0) {
      return "No channels connected. Channels are configured in orion.json."
    }

    return `Connected channels (${channels.length}):\n${channels.map((c) => `  - ${c}`).join("\n")}`
  },
})
