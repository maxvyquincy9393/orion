/**
 * Gateway Server with Observability (OC-11)
 *
 * Enhanced with:
 * - Usage tracking via UsageTracker
 * - /api/usage/summary endpoint
 * - Request instrumentation
 *
 * Based on: Portkey/Maxim/Braintrust observability patterns
 */

import crypto from "node:crypto"

import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"

import { orchestrator } from "../engines/orchestrator.js"
import { channelManager } from "../channels/manager.js"
import { memory } from "../memory/store.js"
import { saveMessage } from "../database/index.js"
import { daemon } from "../background/daemon.js"
import { multiUser } from "../multiuser/manager.js"
import { filterPromptWithAffordance } from "../security/prompt-filter.js"
import { createLogger } from "../logger.js"
import { sessionStore } from "../sessions/session-store.js"
import { causalGraph } from "../memory/causal-graph.js"
import { profiler } from "../memory/profiler.js"
import { linkSummarizer } from "../link-understanding/summarizer.js"
import { hookPipeline } from "../hooks/pipeline.js"
import { outputScanner } from "../security/output-scanner.js"
import { personaEngine } from "../core/persona.js"
import { buildSystemPrompt } from "../core/system-prompt-builder.js"
import { usageTracker } from "../observability/usage-tracker.js"
import {
  authenticateWebSocket,
  getAuthFailure,
  type AuthContext,
} from "./auth-middleware.js"
import config from "../config.js"

const logger = createLogger("gateway")
const BLOCKED_RESPONSE = "Gue tidak bisa bantu dengan itu."

export class GatewayServer {
  private app = Fastify({ logger: false })
  private clients = new Map<string, any>()

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
            const res = await this.handle(msg, auth)
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

  private async handle(msg: any, auth?: AuthContext): Promise<any> {
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
      default:
        return { type: "error", message: `unknown type: ${msg.type}` }
    }
  }

  async start(): Promise<void> {
    await this.app.listen({ port: this.port, host: "127.0.0.1" })
    logger.info(`gateway running at ws://127.0.0.1:${this.port}`)
  }

  private async handleUserMessage(userId: string, rawMessage: string, channel: string): Promise<string> {
    const preMessage = await hookPipeline.run("pre_message", {
      userId,
      channel,
      content: rawMessage,
      metadata: {},
    })

    if (preMessage.abort) {
      return preMessage.abortReason ?? "Message blocked by pre_message hook"
    }

    const inputSafety = await filterPromptWithAffordance(preMessage.content, userId)
    const safePrompt = inputSafety.sanitized
    if (!inputSafety.safe && inputSafety.affordance?.shouldBlock) {
      logger.warn("Blocked message in gateway by affordance checker", {
        userId,
        channel,
        riskScore: inputSafety.affordance.riskScore,
        category: inputSafety.affordance.category,
        reason: inputSafety.reason,
      })
      return BLOCKED_RESPONSE
    }

    if (!inputSafety.safe && inputSafety.reason) {
      logger.warn("Prompt sanitized before generation", {
        userId,
        channel,
        reason: inputSafety.reason,
      })
    }

    const linkContext = await linkSummarizer.processMessage(safePrompt)
    const modelInput = linkContext.enrichedContext

    const { messages, systemContext } = await memory.buildContext(userId, safePrompt)
    let personaDynamicContext: string | undefined
    if (config.PERSONA_ENABLED) {
      const [profile, profileSummary] = await Promise.all([
        profiler.getProfile(userId),
        profiler.formatForContext(userId),
      ])

      const mood = personaEngine.detectMood(safePrompt, profile?.currentTopics ?? [])
      const expertise = personaEngine.detectExpertise(profile, safePrompt)
      const topicCategory = personaEngine.detectTopicCategory(safePrompt)
      personaDynamicContext = personaEngine.buildDynamicContext(
        {
          userMood: mood,
          userExpertise: expertise,
          topicCategory,
          urgency: mood === "stressed",
        },
        profileSummary,
      )
    }

    const systemPrompt = await buildSystemPrompt({
      sessionMode: "dm",
      includeSkills: true,
      includeSafety: true,
      extraContext: personaDynamicContext,
    })

    // Track LLM usage with timing (OC-11)
    const startTime = Date.now()
    let generatedResponse: string
    let usageSuccess = true
    let errorType: string | undefined
    let responseLength = 0

    try {
      generatedResponse = await orchestrator.generate("reasoning", {
        prompt: systemContext ? `${systemContext}\n\nUser: ${modelInput}` : modelInput,
        context: messages,
        systemPrompt,
      })
      responseLength = generatedResponse.length
    } catch (error) {
      usageSuccess = false
      errorType = error instanceof Error ? error.name : "unknown"
      throw error
    } finally {
      const latencyMs = Date.now() - startTime

      // Estimate token counts (in production, get actual counts from provider)
      // Rough estimate: 1 token ≈ 4 characters
      const promptTokens = Math.ceil(((systemPrompt?.length ?? 0) + modelInput.length) / 4)
      const completionTokens = Math.ceil(responseLength / 4)

      // Track usage asynchronously (don't block response)
      void usageTracker.recordUsage({
        userId,
        provider: "groq", // TODO: Get actual provider from orchestrator
        model: "llama-3.3-70b-versatile", // TODO: Get actual model
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

    const postMessage = await hookPipeline.run("post_message", {
      userId,
      channel,
      content: generatedResponse,
      metadata: {
        safePrompt,
        systemContext,
      },
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

    const outputScan = outputScanner.scan(preSend.content)
    if (!outputScan.safe) {
      logger.warn("Gateway response sanitized by output scanner", {
        userId,
        channel,
        issues: outputScan.issues,
      })
    }
    const response = outputScan.sanitized

    const now = Date.now()
    const userMeta = {
      role: "user",
      channel,
      category: "event",
      level: 0,
      security: {
        affordance: inputSafety.affordance ?? null,
        sanitized: safePrompt !== preMessage.content,
      },
    }
    const assistantMeta = {
      role: "assistant",
      channel,
      category: "summary",
      level: 0,
      security: {
        outputIssues: outputScan.issues,
        sanitized: response !== preSend.content,
      },
    }

    await Promise.all([
      saveMessage(userId, "user", safePrompt, channel, userMeta),
      memory.save(userId, safePrompt, userMeta),
    ])
    sessionStore.addMessage(userId, channel, { role: "user", content: safePrompt, timestamp: now })
    void this.runAsyncExtractors(userId, safePrompt, "user")

    await Promise.all([
      saveMessage(userId, "assistant", response, channel, assistantMeta),
      memory.save(userId, response, assistantMeta),
    ])
    sessionStore.addMessage(userId, channel, { role: "assistant", content: response, timestamp: Date.now() })

    return response
  }

  private runAsyncExtractors(userId: string, message: string, role: "user" | "assistant"): void {
    void profiler
      .extractFromMessage(userId, message, role)
      .then(({ facts, opinions }) => profiler.updateProfile(userId, facts, opinions))
      .catch((error) => logger.warn("Profiler async extraction failed", { userId, error }))

    if (role === "user") {
      void causalGraph
        .extractAndUpdate(userId, message)
        .catch((error) => logger.warn("Causal graph async update failed", { userId, error }))
    }
  }

  async stop(): Promise<void> {
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
