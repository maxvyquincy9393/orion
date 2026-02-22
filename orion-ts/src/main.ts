/**
 * main.ts — Orion entry point.
 *
 * Responsibilities:
 *   - Parse the `--mode` flag (text | gateway | all)
 *   - Initialize all subsystems via startup.ts
 *   - Start the appropriate transport layer(s)
 *
 * This file remains thin (<150 lines). All initialization logic lives in
 * src/core/startup.ts. Transport-specific concerns live in their respective modules.
 */

import path from "node:path"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import config from "./config.js"
import { createLogger } from "./logger.js"
import { memrlUpdater } from "./memory/memrl.js"
import { gateway } from "./gateway/server.js"
import { channelManager } from "./channels/manager.js"
import { daemon } from "./background/daemon.js"
import { initialize } from "./core/startup.js"
import { eventBus } from "./core/event-bus.js"
import { memory } from "./memory/store.js"

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

async function startCLI(processMessage: Function): Promise<void> {
  const rl = readline.createInterface({ input, output })
  let pendingFeedback: PendingMemRLFeedback | null = null

  const flushPendingFeedback = async () => {
    if (!pendingFeedback || pendingFeedback.memoryIds.length === 0) return

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

  const userId = config.DEFAULT_USER_ID

  while (true) {
    try {
      const text = (await rl.question("> ")).trim()
      if (!text) continue

      if (["exit", "quit", "bye"].includes(text.toLowerCase())) {
        await flushPendingFeedback()
        rl.close()
        process.exit(0)
      }

      // Process MemRL feedback from previous turn
      if (pendingFeedback && pendingFeedback.memoryIds.length > 0) {
        const followupReward = memrlUpdater.estimateRewardFromContext(text, pendingFeedback.previousResponseLength)
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

      eventBus.dispatch("user.message.received", {
        userId,
        content: text,
        channel: "cli",
        timestamp: Date.now(),
      })

      const result = await processMessage(userId, text, { channel: "cli" })
      output.write(`${result.response}\n`)

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
          await flushPendingFeedback()
          rl.close()
          process.exit(0)
        }
      }
      log.error("cli loop failed", error)
    }
  }
}

async function start(): Promise<void> {
  const { processMessage, shutdown } = await initialize(workspaceDir)
  const available = log.info("available engines", { engines: "loaded" })

  console.log("=== Orion TS ===")
  console.log(`Mode: ${mode}`)

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

  process.on("SIGINT", async () => {
    await shutdown()
    process.exit(0)
  })

  if (mode === "gateway") {
    await new Promise(() => {})
  }

  if (mode === "text" || mode === "all") {
    await startCLI(processMessage)
  }
}

void start()
