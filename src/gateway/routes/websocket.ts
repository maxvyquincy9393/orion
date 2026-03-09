/**
 * @file websocket.ts
 * @description WebSocket /ws route — connection lifecycle, message dispatch, voice.
 *
 * ARCHITECTURE:
 *   Extracted from gateway/server.ts. Receives GatewayContext from server
 *   so it can access the shared clients map and voice sessions.
 */

import crypto from "node:crypto"
import type { FastifyInstance } from "fastify"

import config from "../../config.js"
import { channelManager } from "../../channels/manager.js"
import { daemon } from "../../background/daemon.js"
import { orchestrator } from "../../engines/orchestrator.js"
import { createLogger } from "../../logger.js"
import { memory } from "../../memory/store.js"
import { multiUser } from "../../multiuser/manager.js"
import { voice } from "../../voice/bridge.js"
import { authenticateWebSocket, getAuthFailure, type AuthContext } from "../auth-middleware.js"
import type { GatewayContext, GatewayClientMessage, GatewayResponse, SocketLike } from "./types.js"
import {
  extractWebSocketToken,
  safeSend,
  normalizeIncomingClientMessage,
  ensureMessageContent,
  generateRequestId,
  userRateLimiter,
} from "./helpers.js"

const logger = createLogger("gateway")

function buildConnectedPayload(clientId: string) {
  return {
    type: "connected",
    clientId,
    engines: orchestrator.getAvailableEngines(),
    channels: channelManager.getConnectedChannels(),
    daemon: daemon.healthCheck(),
  }
}

function buildStatusPayload(requestId: unknown) {
  return {
    type: "status",
    engines: orchestrator.getAvailableEngines(),
    channels: channelManager.getConnectedChannels(),
    daemon: daemon.healthCheck(),
    requestId,
  }
}

export function registerWebSocket(app: FastifyInstance, ctx: GatewayContext): void {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const token = extractWebSocketToken(
      req as unknown as { headers: Record<string, string | undefined>; query: Record<string, unknown> },
    )
    const auth = await authenticateWebSocket(token)
    if (!auth) {
      const failure = getAuthFailure(token)
      safeSend(socket as unknown as SocketLike, {
        type: "error",
        message: failure.message,
        statusCode: failure.statusCode,
        retryAfterSeconds: failure.retryAfterSeconds,
      })
      ;(socket as unknown as SocketLike).close(1008)
      return
    }

    await attachAuthenticatedClient(socket as unknown as SocketLike, auth, ctx)
  })
}

async function attachAuthenticatedClient(
  socket: SocketLike,
  auth: AuthContext,
  ctx: GatewayContext,
): Promise<void> {
  const clientId = crypto.randomUUID()
  let socketClosed = false

  ctx.clients.set(clientId, socket)
  logger.info(`client connected: ${clientId}`, {
    userId: auth.userId,
    channel: auth.channel,
  })

  safeSend(socket, buildConnectedPayload(clientId))

  socket.on("message", async (...args: unknown[]) => {
    const raw = args[0] as Buffer
    if (socketClosed) return

    try {
      const parsed = JSON.parse(raw.toString())
      const msg = normalizeIncomingClientMessage(parsed)
      const res = await handle(msg, auth, socket, ctx)
      safeSend(socket, res)
    } catch (err) {
      safeSend(socket, { type: "error", message: String(err) })
    }
  })

  socket.on("close", () => {
    socketClosed = true
    ctx.clients.delete(clientId)
    ctx.stopVoiceSession(auth.userId, "socket close")
    memory.clearFeedback(auth.userId)
  })
}

async function handle(
  msg: GatewayClientMessage,
  auth: AuthContext | undefined,
  socket: SocketLike | undefined,
  ctx: GatewayContext,
): Promise<GatewayResponse> {
  const userId = auth?.userId ?? msg.userId ?? config.DEFAULT_USER_ID

  await multiUser.getOrCreate(userId, "gateway")

  if (auth && msg.userId && msg.userId !== auth.userId) {
    return { type: "error", message: "Token user does not match request user" }
  }

  if (!multiUser.isOwner(userId) && msg.type !== "message") {
    return { type: "error", message: "Unauthorized for this action" }
  }

  switch (msg.type) {
    case "message": {
      const userDecision = userRateLimiter.consume(userId)
      if (userDecision.limited) {
        return { type: "error", message: "Rate limit exceeded", requestId: msg.requestId }
      }
      const content = ensureMessageContent(msg.content, "message")
      const reqId = generateRequestId()
      logger.debug("processing message", { requestId: reqId, userId })
      const response = await ctx.handleUserMessage(userId, content, "webchat")
      return { type: "response", content: response, requestId: msg.requestId }
    }
    case "status":
      return buildStatusPayload(msg.requestId)
    case "broadcast": {
      const content = ensureMessageContent(msg.content, "broadcast")
      await channelManager.broadcast(content)
      return { type: "ok", requestId: msg.requestId }
    }
    case "voice_start":
      return handleVoiceStart(userId, msg, socket, ctx)
    case "voice_stop":
      return handleVoiceStop(userId, msg.requestId, ctx)
    case "voice_wake_word":
      return handleWakeWord(userId, msg)
    default:
      return { type: "error", message: `unknown type: ${msg.type}` }
  }
}

async function handleVoiceStart(
  userId: string,
  msg: GatewayClientMessage,
  socket: SocketLike | undefined,
  ctx: GatewayContext,
): Promise<GatewayResponse> {
  if (!socket) {
    return { type: "error", message: "Voice mode requires an active WebSocket", requestId: msg.requestId }
  }
  if (ctx.voiceSessions.has(userId)) {
    return { type: "error", message: "Voice session already active", requestId: msg.requestId }
  }

  try {
    const stopVoice = await voice.startStreamingConversation(
      (transcript) => {
        safeSend(socket, { type: "voice_transcript", text: transcript })
        void ctx.handleUserMessage(userId, transcript, "voice")
          .then((response) => {
            safeSend(socket, { type: "assistant_transcript", text: response, requestId: msg.requestId })
          })
          .catch((err) => {
            logger.error("voice pipeline error", err)
            safeSend(socket, { type: "error", message: "Failed to process voice input", requestId: msg.requestId })
          })
      },
      (audioChunk) => {
        safeSend(socket, { type: "voice_audio", data: audioChunk, requestId: msg.requestId })
      },
    )

    ctx.voiceSessions.set(userId, stopVoice)
    logger.info("voice session started", { userId })
    return { type: "voice_started", requestId: msg.requestId }
  } catch (err) {
    logger.error("voice_start failed", { userId, error: String(err) })
    return { type: "error", message: `Failed to start voice: ${String(err)}`, requestId: msg.requestId }
  }
}

async function handleVoiceStop(userId: string, requestId: unknown, ctx: GatewayContext): Promise<GatewayResponse> {
  ctx.stopVoiceSession(userId, "client request")
  return { type: "voice_stopped", requestId }
}

async function handleWakeWord(userId: string, msg: GatewayClientMessage): Promise<GatewayResponse> {
  const keyword = msg.keyword ?? "edith"
  const windowSeconds = msg.windowSeconds ?? 2

  try {
    const detected = await voice.checkWakeWord(keyword, windowSeconds)
    return { type: "wake_word_result", detected, keyword, requestId: msg.requestId }
  } catch (err) {
    logger.error("wake_word check failed", { userId, error: String(err) })
    return { type: "error", message: `Wake word check failed: ${String(err)}`, requestId: msg.requestId }
  }
}
