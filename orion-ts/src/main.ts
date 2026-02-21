/**
 * main.ts — Orion entry point.
 *
 * Responsibilities:
 *   - Parse the `--mode` flag (text | gateway | all)
 *   - Initialize all subsystems in dependency order
 *   - Start the appropriate transport layer(s)
 *
 * This file should remain thin. All message processing logic lives in
 * src/core/message-pipeline.ts. Transport-specific concerns (CLI REPL,
 * WebSocket server) live in their respective modules.
 */

import fs from "node:fs/promises"
import path from "node:path"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import config from "./config.js"
import { prisma } from "./database/index.js"
import { orchestrator } from "./engines/orchestrator.js"
import { createLogger } from "./logger.js"
import { memrlUpdater } from "./memory/memrl.js"
import { memory } from "./memory/store.js"
import { gateway } from "./gateway/server.js"
import { channelManager } from "./channels/manager.js"
import { daemon } from "./background/daemon.js"
import { agentRunner } from "./agents/runner.js"
import { skillLoader } from "./skills/loader.js"
import { sessionStore } from "./sessions/session-store.js"
import { causalGraph } from "./memory/causal-graph.js"
import { profiler } from "./memory/profiler.js"
import { pluginLoader } from "./plugin-sdk/loader.js"
import { eventBus } from "./core/event-bus.js"
import { processMessage } from "./core/message-pipeline.js"

const log = createLogger("main")

const mode = process.argv.includes("--mode")
  ? process.argv[process.argv.indexOf("--mode") + 1]
  : "text"
const workspaceDir = process.env.ORION_WORKSPACE ?? path.resolve(process.cwd(), "workspace")

interface PendingMemRLFeedback {
  memoryIds: string[]
  previousResponseLength: number
  provisionalReward: number
}

let eventHandlersInitialized = false

/**
 * Initialize event handlers for cross-module communication via event bus.
 * This decouples modules that need to trigger actions but shouldn't know
 * implementation details.
 */
function initializeEventHandlers(): void {
  if (eventHandlersInitialized) {
    return
  }

  eventHandlersInitialized = true

  eventBus.on("memory.save.requested", async (data) => {
    await memory.save(data.userId, data.content, data.metadata)
  })

  eventBus.on("causal.update.requested", async (data) => {
    await causalGraph.extractAndUpdate(data.userId, data.content)
  })

  eventBus.on("memory.consolidate.requested", async (data) => {
    await memory.compress(data.userId)
  })
}

/**
 * Ensure workspace directory structure exists.
 * Creates workspace, skills, and memory subdirectories.
 */
async function ensureWorkspaceStructure(): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true })
  await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true })
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true })
}

/**
 * Initialize all Orion subsystems in dependency order.
 *
 * Order matters:
 *   1. Database first (prerequisite for everything)
 *   2. Memory store (needs DB for metadata, creates LanceDB table)
 *   3. Orchestrator (validates available LLM engines)
 *   4. Skills loader (builds snapshot for system prompts)
 *   5. Plugin loader (extends capabilities)
 *   6. Event handlers (starts listening for cross-module events)
 */
async function initialize(): Promise<void> {
  log.info("starting orion-ts")

  await ensureWorkspaceStructure()

  await prisma
    .$connect()
    .then(() => log.info("database connected"))
    .catch((error) => log.error("database connection failed", error))

  await memory.init()
  await orchestrator.init()
  await skillLoader.buildSnapshot()
  skillLoader.startWatching({ enabled: true, debounceMs: 1_500 })
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
}

/**
 * Start the CLI REPL for interactive text mode.
 *
 * Handles:
 *   - MemRL feedback loop (reward refinement based on user follow-up)
 *   - Graceful shutdown (SIGINT, exit commands)
 *   - Delegates actual message processing to MessagePipeline
 */
async function startCLI(): Promise<void> {
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

      // Process MemRL feedback from previous turn
      if (pendingFeedback && pendingFeedback.memoryIds.length > 0) {
        const followupReward = memrlUpdater.estimateRewardFromContext(
          text,
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

      // Dispatch events for listeners (profilers, etc.)
      eventBus.dispatch("user.message.received", {
        userId,
        content: text,
        channel: "cli",
        timestamp: Date.now(),
      })

      // Process message through canonical pipeline
      const result = await processMessage(userId, text, { channel: "cli" })

      // Display response
      output.write(`${result.response}\n`)

      // Set up feedback for next turn
      pendingFeedback = result.retrievedMemoryIds.length > 0
        ? {
          memoryIds: result.retrievedMemoryIds,
          previousResponseLength: result.response.length,
          provisionalReward: result.provisionalReward,
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

/**
 * Main entry point. Orchestrates initialization and transport startup.
 *
 * Modes:
 *   - "text"  : CLI REPL only
 *   - "gateway": HTTP/WebSocket gateway only
 *   - "all"   : Both CLI and gateway
 */
async function start(): Promise<void> {
  await initialize()

  const available = orchestrator.getAvailableEngines()

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
    await startCLI()
  }
}

void start()
