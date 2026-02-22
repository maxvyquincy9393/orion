/**
 * Gateway server — WebSocket + HTTP transport layer.
 *
 * Handles incoming connections from WebChat, external webhooks, and the
 * REST API. All message processing is delegated to MessagePipeline.
 * This file is responsible ONLY for:
 *   - WebSocket connection lifecycle (connect, disconnect, heartbeat)
 *   - HTTP route definitions
 *   - Auth/pairing checks (before message reaches pipeline)
 *   - Channel-specific formatting (markdown adaptation per channel)
 *   - Usage summary API endpoint (/api/usage/summary)
 *
 * What this file does NOT do:
 *   - Message processing logic (lives in message-pipeline.ts)
 *   - Memory retrieval (lives in himes.ts, memrl.ts)
 *   - LLM calls (lives in orchestrator.ts)
 *   - Security checks beyond pairing (lives in security/)
 *
 * OC-11 telemetry: all LLM calls are tracked via usageTracker (singleton).
 * Usage data is written to data/usage.db asynchronously.
 * Provider and model are read from orchestrator.getLastUsedEngine() to ensure
 * accurate tracking (never hardcoded).
 *
 * Based on: Portkey/Maxim/Braintrust observability patterns
 */

import crypto from "node:crypto"

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import config from "../config.js"
import { orchestrator } from "../engines/orchestrator.js"
import { channelManager } from "../channels/manager.js"
import { daemon } from "../background/daemon.js"
import { multiUser } from "../multiuser/manager.js"
import { createLogger } from "../logger.js"
import { hookPipeline } from "../hooks/pipeline.js"
import { usageTracker } from "../observability/usage-tracker.js"
import { processMessage } from "../core/message-pipeline.js"
import { voice } from "../voice/bridge.js"
import {
  authenticateWebSocket,
  getAuthFailure,
  type AuthContext,
} from "./auth-middleware.js"
const logger = createLogger("gateway")

export class GatewayServer {
  private app = Fastify({ logger: false })
  private clients = new Map<string, any>()
  private voiceSessions = new Map<string, () => void>() // userId -> stop function

  constructor(private port = 18789) {
    this.registerRoutes()
  }

  private registerRoutes(): void {
    this.app.register(websocketPlugin)

    this.app.register(async (app) => {
      app.get("/ws", { websocket: true }, async (socket: any, req: any) => {
        const token = this.extractToken(req)
        const auth = await authenticateWebSocket(token)
        if (!auth) {
          const failure = getAuthFailure(token)
          socket.send(
            JSON.stringify({
              type: "error",
              message: failure.message,
              statusCode: failure.statusCode,
              retryAfterSeconds: failure.retryAfterSeconds,
            }),
          )
          socket.close(1008)
          return
        }

        const clientId = crypto.randomUUID()
        this.clients.set(clientId, socket)
        logger.info(`client connected: ${clientId}`, {
          userId: auth.userId,
          channel: auth.channel,
        })

        socket.send(
          JSON.stringify({
            type: "connected",
            clientId,
            engines: orchestrator.getAvailableEngines(),
            channels: channelManager.getConnectedChannels(),
            daemon: daemon.healthCheck(),
          }),
        )

        socket.on("message", async (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString())
            const res = await this.handle(msg, auth, socket)
            socket.send(JSON.stringify(res))
          } catch (err) {
            socket.send(JSON.stringify({ type: "error", message: String(err) }))
          }
        })

        socket.on("close", () => {
          this.clients.delete(clientId)
        })
      })

      app.get("/health", async () => ({
        status: "ok",
        uptime: process.uptime(),
        engines: orchestrator.getAvailableEngines(),
        channels: channelManager.getConnectedChannels(),
        users: multiUser.listUsers().length,
      }))

      app.post<{ Body: { message: string; userId?: string } }>(
        "/message",
        async (req) => {
          const { message, userId = config.DEFAULT_USER_ID } = req.body
          const response = await this.handleUserMessage(userId, message, "webchat")
          return { response }
        },
      )

      // Usage summary endpoint (OC-11)
      app.get<{
        Querystring: { userId?: string; days?: string }
      }>("/api/usage/summary", async (req) => {
        const userId = req.query.userId ?? config.DEFAULT_USER_ID
        const days = Math.min(30, Math.max(1, parseInt(req.query.days ?? "7", 10)))

        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - days)

        const summary = await usageTracker.getUserSummary(userId, startDate, endDate)

        return {
          userId,
          period: { start: startDate, end: endDate, days },
          summary,
        }
      })

      // Global usage summary (admin only - simplified auth)
      app.get<{
        Querystring: { days?: string; adminToken?: string }
      }>("/api/usage/global", async (req) => {
        // Simple admin check - in production use proper auth
        if (req.query.adminToken !== process.env.ADMIN_TOKEN) {
          return { error: "Unauthorized" }
        }

        const days = Math.min(30, Math.max(1, parseInt(req.query.days ?? "7", 10)))

        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - days)

        const summary = await usageTracker.getGlobalSummary(startDate, endDate)

        return {
          period: { start: startDate, end: endDate, days },
          summary,
        }
      })
    })
  }

  private async handle(msg: any, auth?: AuthContext, socket?: any): Promise<any> {
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
        const response = await this.handleUserMessage(userId, msg.content, "webchat")
        return { type: "response", content: response, requestId: msg.requestId }
      }
      case "status":
        return {
          type: "status",
          engines: orchestrator.getAvailableEngines(),
          channels: channelManager.getConnectedChannels(),
          daemon: daemon.healthCheck(),
          requestId: msg.requestId,
        }
      case "broadcast":
        await channelManager.broadcast(msg.content)
        return { type: "ok", requestId: msg.requestId }
      // T-3: Voice Mode Handlers
      case "voice_start": {
        return await this.handleVoiceStart(userId, msg, socket)
      }
      case "voice_stop": {
        return await this.handleVoiceStop(userId)
      }
      case "voice_wake_word": {
        return await this.handleWakeWord(userId, msg)
      }
      default:
        return { type: "error", message: `unknown type: ${msg.type}` }
    }
  }

  async start(): Promise<void> {
    await this.app.listen({ port: this.port, host: "127.0.0.1" })
    logger.info(`gateway running at ws://127.0.0.1:${this.port}`)
  }

  private async handleUserMessage(userId: string, rawMessage: string, channel: string): Promise<string> {
    // Run pre-message hook
    const preMessage = await hookPipeline.run("pre_message", {
      userId,
      channel,
      content: rawMessage,
      metadata: {},
    })

    if (preMessage.abort) {
      return preMessage.abortReason ?? "Message blocked by pre_message hook"
    }

    // Process through canonical pipeline
    const startTime = Date.now()
    let responseText = ""
    let usageSuccess = true
    let errorType: string | undefined

    try {
      const result = await processMessage(userId, preMessage.content, { channel })
      responseText = result.response
    } catch (error) {
      usageSuccess = false
      errorType = error instanceof Error ? error.name : "unknown"
      throw error
    } finally {
      const latencyMs = Date.now() - startTime
      
      // Track usage asynchronously (don't block response)
      // Estimate tokens: 1 token ≈ 4 characters
      const promptTokens = Math.ceil(preMessage.content.length / 4)
      const completionTokens = Math.ceil(responseText.length / 4)
      
      // Get actual provider/model from orchestrator
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
      }).catch((err) => logger.warn("Failed to track usage", err))
    }

    // Run post-message hook
    const postMessage = await hookPipeline.run("post_message", {
      userId,
      channel,
      content: responseText,
      metadata: {},
    })

    if (postMessage.abort) {
      return postMessage.abortReason ?? "Message blocked by post_message hook"
    }

    // Run pre-send hook
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
  }

  // T-3: Voice Mode Handlers
  private async handleVoiceStart(userId: string, msg: any, socket: any): Promise<any> {
    // Check if voice is already active for this user
    if (this.voiceSessions.has(userId)) {
      return { type: "error", message: "Voice session already active", requestId: msg.requestId }
    }

    try {
      const stopVoice = await voice.startStreamingConversation(
        (transcript) => {
          // User spoke — send transcript to client
          socket.send(JSON.stringify({ type: "voice_transcript", text: transcript }))
          
          // Process through pipeline and get response
          void processMessage(userId, transcript, { channel: "voice" })
            .then((result) => {
              // Send assistant transcript (text response)
              socket.send(JSON.stringify({ 
                type: "assistant_transcript", 
                text: result.response,
                requestId: msg.requestId 
              }))
            })
            .catch((err) => {
              logger.error("voice pipeline error", err)
              socket.send(JSON.stringify({ 
                type: "error", 
                message: "Failed to process voice input",
                requestId: msg.requestId 
              }))
            })
        },
        (audioChunk) => {
          // Stream TTS audio chunk to frontend (base64)
          socket.send(JSON.stringify({ 
            type: "voice_audio", 
            data: audioChunk,
            requestId: msg.requestId 
          }))
        },
      )

      // Store stop function for cleanup
      this.voiceSessions.set(userId, stopVoice)
      
      logger.info("voice session started", { userId })
      return { type: "voice_started", requestId: msg.requestId }
    } catch (err) {
      logger.error("voice_start failed", { userId, error: String(err) })
      return { type: "error", message: `Failed to start voice: ${String(err)}`, requestId: msg.requestId }
    }
  }

  private async handleVoiceStop(userId: string): Promise<any> {
    const stopFn = this.voiceSessions.get(userId)
    if (stopFn) {
      stopFn()
      this.voiceSessions.delete(userId)
      logger.info("voice session stopped", { userId })
    }
    return { type: "voice_stopped" }
  }

  private async handleWakeWord(userId: string, msg: any): Promise<any> {
    const keyword = msg.keyword ?? "orion"
    const windowSeconds = msg.windowSeconds ?? 2
    
    try {
      const detected = await voice.checkWakeWord(keyword, windowSeconds)
      return { 
        type: "wake_word_result", 
        detected,
        keyword,
        requestId: msg.requestId 
      }
    } catch (err) {
      logger.error("wake_word check failed", { userId, error: String(err) })
      return { 
        type: "error", 
        message: `Wake word check failed: ${String(err)}`,
        requestId: msg.requestId 
      }
    }
  }

  async stop(): Promise<void> {
    // Stop all voice sessions
    for (const [userId, stopFn] of this.voiceSessions.entries()) {
      try {
        stopFn()
        logger.info("voice session stopped on shutdown", { userId })
      } catch (err) {
        logger.warn("error stopping voice session", { userId, error: String(err) })
      }
    }
    this.voiceSessions.clear()
    
    await this.app.close()
  }

  broadcast(payload: unknown): void {
    const raw = JSON.stringify(payload)
    for (const [, socket] of this.clients) {
      try {
        socket.send(raw)
      } catch {
        continue
      }
    }
  }

  private extractToken(req: any): string | null {
    const queryToken = req?.query?.token
    if (typeof queryToken === "string" && queryToken.trim().length > 0) {
      return queryToken.trim()
    }

    const authHeader = req?.headers?.authorization
    if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
      return authHeader.slice(7).trim()
    }

    return null
  }
}

export const gateway = new GatewayServer()
