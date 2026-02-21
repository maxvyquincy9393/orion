import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import config from "./config.js"
import { prisma, saveMessage } from "./database/index.js"
import { orchestrator } from "./engines/orchestrator.js"
import { responseCritic } from "./core/critic.js"
import { personaEngine } from "./core/persona.js"
import { createLogger } from "./logger.js"
import { memrlUpdater } from "./memory/memrl.js"
import { memory } from "./memory/store.js"
import { gateway } from "./gateway/server.js"
import { channelManager } from "./channels/manager.js"
import { daemon } from "./background/daemon.js"
import { agentRunner } from "./agents/runner.js"
import { skillManager } from "./skills/manager.js"
import { sessionStore } from "./sessions/session-store.js"
import { causalGraph } from "./memory/causal-graph.js"
import { profiler } from "./memory/profiler.js"
import { pluginLoader } from "./plugin-sdk/loader.js"
import { filterPromptWithAffordance } from "./security/prompt-filter.js"
import { outputScanner } from "./security/output-scanner.js"
import { eventBus } from "./core/event-bus.js"

const log = createLogger("main")

const mode = process.argv.includes("--mode")
  ? process.argv[process.argv.indexOf("--mode") + 1]
  : "text"

interface PendingMemRLFeedback {
  memoryIds: string[]
  previousResponseLength: number
  provisionalReward: number
}

let eventHandlersInitialized = false

function initializeEventHandlers(): void {
  if (eventHandlersInitialized) {
    return
  }

  eventHandlersInitialized = true

  eventBus.on("memory.save.requested", async (data) => {
    await memory.save(data.userId, data.content, data.metadata)
  })

  eventBus.on("profile.update.requested", async (data) => {
    const { facts, opinions } = await profiler.extractFromMessage(data.userId, data.content, "user")
    await profiler.updateProfile(data.userId, facts, opinions)
  })

  eventBus.on("causal.update.requested", async (data) => {
    await causalGraph.extractAndUpdate(data.userId, data.content)
  })

  eventBus.on("memory.consolidate.requested", async (data) => {
    await memory.compress(data.userId)
  })
}

async function start(): Promise<void> {
  log.info("starting orion-ts")

  await prisma
    .$connect()
    .then(() => log.info("database connected"))
    .catch((error) => log.error("database connection failed", error))

  await memory.init()
  await orchestrator.init()
  await skillManager.init()
  await pluginLoader.loadAllFromDefaultDir()
  void agentRunner
  initializeEventHandlers()

  const available = orchestrator.getAvailableEngines()
  if (available.length > 0) {
    log.info("engines loaded", { engines: available })
  } else {
    log.warn("no engines available")
  }

  console.log("=== Orion TS ===")
  console.log(`Mode: ${mode}`)
  console.log(`Engines: ${available.join(", ") || "none"}`)

  if (mode === "gateway" || mode === "all") {
    await channelManager.init()
    await daemon.start()
    await gateway.start()
    console.log("Gateway: ws://127.0.0.1:18789")
    console.log("WebChat: http://127.0.0.1:8080")
  }

  if (mode !== "text") {
    console.log(`Channels: ${channelManager.getConnectedChannels().join(", ") || "none"}`)
    console.log(`Daemon: ${daemon.isRunning() ? "running" : "stopped"}`)
  }

  if (mode === "gateway") {
    await new Promise(() => { })
  }

  if (mode === "text" || mode === "all") {
    const rl = readline.createInterface({ input, output })
    let pendingFeedback: PendingMemRLFeedback | null = null

    const flushPendingFeedback = async () => {
      if (!pendingFeedback || pendingFeedback.memoryIds.length === 0) {
        return
      }

      const fallbackFeedback = {
        memoryIds: pendingFeedback.memoryIds,
        taskSuccess: false,
        reward: pendingFeedback.provisionalReward,
      }
      pendingFeedback = null

      try {
        await memory.provideFeedback(fallbackFeedback)
      } catch (error) {
        log.warn("failed to flush memrl feedback", error)
      }
    }

    const shutdown = async () => {
      log.info("shutting down")
      await flushPendingFeedback()
      rl.close()
      if (daemon.isRunning()) {
        daemon.stop()
      }
      await prisma.$disconnect()
      process.exit(0)
    }

    process.on("SIGINT", () => {
      void shutdown()
    })

    const userId = config.DEFAULT_USER_ID

    while (true) {
      try {
        const text = (await rl.question("> ")).trim()
        if (!text) {
          continue
        }

        if (["exit", "quit", "bye"].includes(text.toLowerCase())) {
          await shutdown()
        }

        const inputSafety = await filterPromptWithAffordance(text, userId)
        if (!inputSafety.safe && inputSafety.affordance?.shouldBlock) {
          output.write("Gue tidak bisa bantu dengan itu.\n")
          continue
        }

        const safeText = inputSafety.sanitized

        if (pendingFeedback && pendingFeedback.memoryIds.length > 0) {
          const followupReward = memrlUpdater.estimateRewardFromContext(
            safeText,
            pendingFeedback.previousResponseLength,
          )
          const reward = Math.max(pendingFeedback.provisionalReward, followupReward)

          void memory
            .provideFeedback({
              memoryIds: pendingFeedback.memoryIds,
              taskSuccess: reward >= 0.5,
              reward,
            })
            .catch((error) => log.warn("async memrl feedback update failed", error))

          pendingFeedback = null
        }

        const userTimestamp = Date.now()
        const userMessageMetadata = {
          role: "user",
          category: "event",
          level: 0,
          security: {
            affordance: inputSafety.affordance ?? null,
            sanitized: safeText !== text,
          },
        }
        const userMemoryMetadata = {
          role: "user",
          category: "event",
          level: 0,
          channel: "cli",
        }

        eventBus.dispatch("user.message.received", {
          userId,
          content: safeText,
          channel: "cli",
          timestamp: userTimestamp,
        })
        eventBus.dispatch("memory.save.requested", {
          userId,
          content: safeText,
          metadata: userMemoryMetadata,
        })
        eventBus.dispatch("profile.update.requested", { userId, content: safeText })
        eventBus.dispatch("causal.update.requested", { userId, content: safeText })

        const [, { messages, systemContext, retrievedMemoryIds }] = await Promise.all([
          saveMessage(userId, "user", safeText, "cli", userMessageMetadata),
          memory.buildContext(userId, safeText),
        ])
        sessionStore.addMessage(userId, "cli", { role: "user", content: safeText, timestamp: userTimestamp })

        let systemPrompt: string | undefined
        if (config.PERSONA_ENABLED) {
          const [profile, profileSummary] = await Promise.all([
            profiler.getProfile(userId),
            profiler.formatForContext(userId),
          ])

          const mood = personaEngine.detectMood(safeText, profile?.currentTopics ?? [])
          const expertise = personaEngine.detectExpertise(profile, safeText)
          const topicCategory = personaEngine.detectTopicCategory(safeText)
          systemPrompt = personaEngine.buildSystemPrompt(
            {
              userMood: mood,
              userExpertise: expertise,
              topicCategory,
              urgency: mood === "stressed",
            },
            profileSummary,
          )
        }

        const response = await orchestrator.generate("reasoning", {
          prompt: systemContext ? `${systemContext}\n\nUser: ${safeText}` : safeText,
          context: messages,
          systemPrompt,
        })
        const provisionalReward = memrlUpdater.estimateRewardFromContext(null, response.length)
        const critiqued = await responseCritic.critiqueAndRefine(safeText, response, 2)
        const finalResponse = critiqued.finalResponse

        if (critiqued.refined) {
          log.debug("cli response refined", {
            score: critiqued.critique.score,
            iterations: critiqued.iterations,
          })
        }

        const scanResult = outputScanner.scan(finalResponse)
        if (!scanResult.safe) {
          log.warn("Assistant output sanitized", {
            userId,
            issues: scanResult.issues,
          })
        }

        const safeResponse = scanResult.sanitized
        output.write(`${safeResponse}\n`)

        const assistantTimestamp = Date.now()
        const assistantMemoryMetadata = {
          role: "assistant",
          category: "summary",
          level: 0,
          channel: "cli",
        }

        eventBus.dispatch("user.message.sent", {
          userId,
          content: safeResponse,
          channel: "cli",
          timestamp: assistantTimestamp,
        })
        eventBus.dispatch("memory.save.requested", {
          userId,
          content: safeResponse,
          metadata: assistantMemoryMetadata,
        })

        await saveMessage(userId, "assistant", safeResponse, "cli", {
          role: "assistant",
          category: "summary",
          level: 0,
          security: {
            outputIssues: scanResult.issues,
            sanitized: safeResponse !== finalResponse,
          },
        })
        sessionStore.addMessage(userId, "cli", { role: "assistant", content: safeResponse, timestamp: assistantTimestamp })

        pendingFeedback = retrievedMemoryIds.length > 0
          ? {
            memoryIds: retrievedMemoryIds,
            previousResponseLength: response.length,
            provisionalReward,
          }
          : null
      } catch (error) {
        if (error instanceof Error) {
          const lowered = error.message.toLowerCase()
          if (lowered.includes("aborted") || lowered.includes("closed")) {
            await shutdown()
          }
        }
        log.error("cli loop failed", error)
      }
    }
  }
}

void start()
