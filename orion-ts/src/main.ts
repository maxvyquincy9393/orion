import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import config from "./config.js"
import { prisma, saveMessage } from "./database/index.js"
import { orchestrator } from "./engines/orchestrator.js"
import { createLogger } from "./logger.js"
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

const log = createLogger("main")

const mode = process.argv.includes("--mode")
  ? process.argv[process.argv.indexOf("--mode") + 1]
  : "text"

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

    const shutdown = async () => {
      log.info("shutting down")
      rl.close()
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
        await saveMessage(userId, "user", safeText, "cli", {
          role: "user",
          category: "event",
          level: 0,
          security: {
            affordance: inputSafety.affordance ?? null,
            sanitized: safeText !== text,
          },
        })
        await memory.save(userId, safeText, { role: "user", category: "event", level: 0, channel: "cli" })
        sessionStore.addMessage(userId, "cli", { role: "user", content: safeText, timestamp: Date.now() })
        void profiler
          .extractFromMessage(userId, safeText, "user")
          .then(({ facts, opinions }) => profiler.updateProfile(userId, facts, opinions))
          .catch((error) => log.warn("profile extraction failed", error))
        void causalGraph.extractAndUpdate(userId, safeText).catch((error) => log.warn("causal update failed", error))

        const { messages, systemContext } = await memory.buildContext(userId, safeText)
        const response = await orchestrator.generate("reasoning", {
          prompt: systemContext ? `${systemContext}\n\nUser: ${safeText}` : safeText,
          context: messages,
        })

        const scanResult = outputScanner.scan(response)
        if (!scanResult.safe) {
          log.warn("Assistant output sanitized", {
            userId,
            issues: scanResult.issues,
          })
        }

        const safeResponse = scanResult.sanitized
        output.write(`${safeResponse}\n`)
        await saveMessage(userId, "assistant", safeResponse, "cli", {
          role: "assistant",
          category: "summary",
          level: 0,
          security: {
            outputIssues: scanResult.issues,
            sanitized: safeResponse !== response,
          },
        })
        await memory.save(userId, safeResponse, {
          role: "assistant",
          category: "summary",
          level: 0,
          channel: "cli",
        })
        sessionStore.addMessage(userId, "cli", { role: "assistant", content: safeResponse, timestamp: Date.now() })
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
