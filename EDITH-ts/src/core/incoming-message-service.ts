import { orchestrator } from "../engines/orchestrator.js"
import { hookPipeline } from "../hooks/pipeline.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
import { usageTracker } from "../observability/usage-tracker.js"
import {
  processMessage,
  type PipelineChunkCallback,
} from "./message-pipeline.js"
import { handleChatCommand } from "./chat-commands.js"

const log = createLogger("core.incoming-message")

const REQUEST_TOKEN_CHAR_RATIO = 4
const CANCEL_REASON_LATEST_WINS = "Cancelled by newer request"
const inflightByChannelUser = new Map<string, AbortController>()

export interface IncomingMessageOptions {
  signal?: AbortSignal
  onChunk?: PipelineChunkCallback
  latestWins?: boolean
}

function getRequestKey(userId: string, channel: string): string {
  return `${userId}::${channel}`
}

function abortController(controller: AbortController, reason: string): void {
  if (!controller.signal.aborted) {
    controller.abort(new Error(reason))
  }
}

function attachExternalSignal(external: AbortSignal | undefined, target: AbortController): (() => void) | null {
  if (!external) {
    return null
  }

  if (external.aborted) {
    abortController(target, "Cancelled by caller")
    return null
  }

  const handler = () => {
    abortController(target, "Cancelled by caller")
  }
  external.addEventListener("abort", handler, { once: true })
  return () => external.removeEventListener("abort", handler)
}

export function estimateTokensFromText(text: string): number {
  if (!text) {
    return 0
  }
  // Provider-agnostic approximation used for telemetry consistency across engines.
  return Math.max(1, Math.ceil(text.length / REQUEST_TOKEN_CHAR_RATIO))
}

export async function handleIncomingUserMessage(
  userId: string,
  rawMessage: string,
  channel: string,
  options: IncomingMessageOptions = {},
): Promise<string> {
  const requestController = new AbortController()
  const removeExternalHandler = attachExternalSignal(options.signal, requestController)
  const requestKey = getRequestKey(userId, channel)
  const latestWinsEnabled = options.latestWins ?? true

  if (latestWinsEnabled) {
    const previous = inflightByChannelUser.get(requestKey)
    if (previous) {
      abortController(previous, CANCEL_REASON_LATEST_WINS)
    }
    inflightByChannelUser.set(requestKey, requestController)
  }

  // Intercept slash commands before reaching LLM pipeline
  try {
    const command = handleChatCommand(userId, rawMessage)
    if (command.handled) {
      log.info("chat command handled", { userId, channel, command: rawMessage.split(/\s+/)[0] })
      return command.response
    }
    const pending = memory.consumePendingFeedback(userId)
    if (pending) {
      const followUpSignal = pending.provisionalReward
        + (rawMessage.length > 20 ? 0.2 : 0)
        + (Date.now() - pending.timestamp < 10_000 ? 0.1 : 0)

      void memory.provideFeedback({
        memoryIds: pending.retrievedIds,
        taskSuccess: followUpSignal >= 0.5,
        reward: followUpSignal,
      }).catch((error) => log.warn("MemRL feedback follow-up failed", { userId, channel, error }))
    }

    const preMessage = await hookPipeline.run("pre_message", {
      userId,
      channel,
      content: rawMessage,
      metadata: {},
    })

    if (preMessage.abort) {
      return preMessage.abortReason ?? "Message blocked by pre_message hook"
    }

    const startTime = Date.now()
    let responseText = ""
    let usageSuccess = true
    let errorType: string | undefined

    try {
      const result = await processMessage(userId, preMessage.content, {
        channel,
        signal: requestController.signal,
        onChunk: options.onChunk,
      })
      responseText = result.response
    } catch (error) {
      usageSuccess = false
      errorType = error instanceof Error ? error.name : "unknown"
      throw error
    } finally {
      const latencyMs = Date.now() - startTime
      const promptTokens = estimateTokensFromText(preMessage.content)
      const completionTokens = estimateTokensFromText(responseText)
      const lastEngine = orchestrator.getLastUsedEngine()

      void usageTracker.recordUsage({
        userId,
        provider: lastEngine?.provider ?? "unknown",
        model: lastEngine?.model ?? "unknown",
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        latencyMs,
        requestType: "chat",
        success: usageSuccess,
        errorType,
        timestamp: new Date(),
      }).catch((error) => log.warn("Failed to track usage", { userId, channel, error }))
    }

    const postMessage = await hookPipeline.run("post_message", {
      userId,
      channel,
      content: responseText,
      metadata: {},
    })

    if (postMessage.abort) {
      return postMessage.abortReason ?? "Message blocked by post_message hook"
    }

    const preSend = await hookPipeline.run("pre_send", {
      userId,
      channel,
      content: postMessage.content,
      metadata: postMessage.metadata,
    })

    if (preSend.abort) {
      return preSend.abortReason ?? "Message blocked by pre_send hook"
    }

    return preSend.content
  } finally {
    if (latestWinsEnabled && inflightByChannelUser.get(requestKey) === requestController) {
      inflightByChannelUser.delete(requestKey)
    }
    removeExternalHandler?.()
  }
}
