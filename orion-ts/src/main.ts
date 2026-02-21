import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import config from "./config.js"
import { prisma, saveMessage } from "./database/index.js"
import { orchestrator } from "./engines/orchestrator.js"
import { createLogger } from "./logger.js"
import { memory } from "./memory/store.js"

const log = createLogger("main")

async function start(): Promise<void> {
  log.info("starting orion-ts")

  await prisma
    .$connect()
    .then(() => log.info("database connected"))
    .catch((error) => log.error("database connection failed", error))

  await memory.init()
  await orchestrator.init()

  const available = orchestrator.getAvailableEngines()
  if (available.length > 0) {
    log.info("engines loaded", { engines: available })
  } else {
    log.warn("no engines available")
  }

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

      await saveMessage(userId, "user", text, "cli")

      const context = await memory.buildContext(userId, text)
      const response = await orchestrator.generate("reasoning", {
        prompt: text,
        context,
      })

      output.write(`${response}\n`)
      await saveMessage(userId, "assistant", response, "cli")
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

void start()
