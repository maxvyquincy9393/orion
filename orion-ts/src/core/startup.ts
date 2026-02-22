/**
 * Orion startup and dependency initialization.
 * Sets up all services and returns a configured MessagePipeline ready to use.
 * Separated from main.ts so startup can be tested and reused by gateway.
 */

import fs from "node:fs/promises"
import path from "node:path"

import config from "../config.js"
import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
import { daemon } from "../background/daemon.js"
import { agentRunner } from "../agents/runner.js"
import { skillLoader } from "../skills/loader.js"
import { causalGraph } from "../memory/causal-graph.js"
import { pluginLoader } from "../plugin-sdk/loader.js"
import { eventBus } from "./event-bus.js"
import { processMessage } from "./message-pipeline.js"

const log = createLogger("startup")

export interface StartupResult {
  processMessage: typeof processMessage
  shutdown: () => Promise<void>
}

let eventHandlersInitialized = false

function initializeEventHandlers(): void {
  if (eventHandlersInitialized) return
  eventHandlersInitialized = true

  eventBus.on("memory.save.requested", async (data: { userId: string; content: string; metadata: Record<string, unknown> }) => {
    await memory.save(data.userId, data.content, data.metadata)
  })

  eventBus.on("causal.update.requested", async (data: { userId: string; content: string }) => {
    await causalGraph.extractAndUpdate(data.userId, data.content)
  })

  eventBus.on("memory.consolidate.requested", async (data: { userId: string }) => {
    await memory.compress(data.userId)
  })
}

async function ensureWorkspaceStructure(workspaceDir: string): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true })
  await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true })
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true })
}

export async function initialize(workspaceDir: string): Promise<StartupResult> {
  log.info("starting orion-ts")

  await ensureWorkspaceStructure(workspaceDir)

  await prisma
    .$connect()
    .then(() => log.info("database connected"))
    .catch((error: unknown) => log.error("database connection failed", error))

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

  const shutdown = async (): Promise<void> => {
    log.info("shutting down")
    if (daemon.isRunning()) {
      daemon.stop()
    }
    await prisma.$disconnect()
  }

  return {
    processMessage,
    shutdown,
  }
}
