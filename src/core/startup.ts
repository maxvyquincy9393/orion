/**
 * EDITH startup and dependency initialization.
 * Sets up all services and returns a configured MessagePipeline ready to use.
 * Separated from main.ts so startup can be tested and reused by gateway.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"

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
import { mcpClient, type MCPServerConfig } from "../mcp/client.js"
import { offlineCoordinator } from "../offline/coordinator.js"
import { habitModel } from "../background/habit-model.js"
import { localEmbedder } from "../memory/local-embedder.js"
import { skillMarketplace } from "../skills/marketplace.js"
import { syncScheduler } from "../memory/knowledge/sync-scheduler.js"
import { loadEDITHConfig } from "../config/edith-config.js"
import config, { mergeEdithJsonCredentials } from "../config.js"
import { vault } from "../security/vault.js"
import { auditLog } from "../security/audit-log.js"

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
  log.info("starting EDITH")

  await ensureWorkspaceStructure(workspaceDir)

  // Overlay edith.json credentials onto runtime config before any service reads them
  await mergeEdithJsonCredentials()

  // Phase 17: Initialize vault (load from disk, unlock with stored passphrase if available)
  try {
    const vaultMetaPath = `${config.VAULT_PATH}.meta`
    if (existsSync(vaultMetaPath)) {
      const passphrase = process.env.EDITH_VAULT_PASSPHRASE?.trim()
      if (passphrase) {
        await vault.unlock(passphrase)
        log.info("vault loaded and unlocked")
        // Wire vault HMAC key to audit log for tamper-evident chaining
        const hmacKey = await vault.get("__audit_hmac_key__").catch(() => undefined)
        if (hmacKey) {
          auditLog.setHmacKey(hmacKey)
          log.debug("audit log HMAC key loaded from vault")
        }
      } else {
        log.info("vault not yet unlocked — no EDITH_VAULT_PASSPHRASE in env")
      }
    } else {
      log.info("vault not yet created — skipping load")
    }
  } catch (vaultError) {
    log.warn("vault load failed — secrets will not be resolved", { error: String(vaultError) })
  }

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

  // Phase 11: Discover skills from trusted directories
  if (config.SKILL_MARKETPLACE_ENABLED) {
    void skillMarketplace.discover()
      .then((count) => log.info("skill marketplace ready", { skills: count }))
      .catch((err) => log.warn("skill marketplace discovery failed", { err }))
  }

  // Phase 9: Initialize local embedder if enabled
  if (config.LOCAL_EMBEDDER_ENABLED) {
    void localEmbedder.init()
      .then((ok) => {
        if (ok) {
          log.info("local embedder initialized")
        } else {
          log.warn("local embedder unavailable — cloud embedding will be used")
        }
      })
      .catch((err) => log.warn("local embedder init error", { err }))
  }

  // Phase 9: Start connectivity monitoring
  offlineCoordinator.startMonitoring()
  offlineCoordinator.on("statechange", (state: string, previous: string) => {
    log.info("connectivity state changed", { from: previous, to: state })
    if (state === "offline") {
      log.warn("EDITH is now in offline mode — all local providers active")
    }
  })

  // Phase 10: Start habit model background monitoring
  habitModel.startMonitoring()

  // Phase 13: Knowledge base sync scheduler
  if (config.KNOWLEDGE_BASE_ENABLED) {
    void loadEDITHConfig()
      .then((edithConfig) => {
        syncScheduler.start(edithConfig.knowledgeBase, config.DEFAULT_USER_ID)
      })
      .catch((err) => log.warn("knowledge base sync scheduler init failed", { err }))
  }

  // Initialize MCP Client with configuration from edith.json (T-2)
  try {
    const edithJsonPath = path.join(workspaceDir, "..", "edith.json")
    const edithJson = await fs.readFile(edithJsonPath, "utf-8").catch(() => "{}")
    const edithConfig = JSON.parse(edithJson) as Record<string, unknown>
    const mcpServers: MCPServerConfig[] = (edithConfig?.mcp as { servers?: MCPServerConfig[] })?.servers || []
    if (mcpServers.length > 0) {
      await mcpClient.init(mcpServers)
      log.info("MCP client initialized", { servers: mcpServers.length })
    }
  } catch (mcpError) {
    log.warn("MCP client initialization failed", { error: String(mcpError) })
  }

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
    // Phase 9: Stop connectivity monitoring
    offlineCoordinator.stopMonitoring()
    // Phase 10: Stop habit model monitoring
    habitModel.stopMonitoring()
    // Phase 13: Stop knowledge base sync scheduler
    if (config.KNOWLEDGE_BASE_ENABLED) {
      syncScheduler.stop()
    }
    // Phase 17: Lock vault on shutdown
    vault.lock()
    // Shutdown MCP clients
    await mcpClient.shutdown().catch((err) => log.warn("MCP shutdown error", err))
    await prisma.$disconnect()
  }

  return {
    processMessage,
    shutdown,
  }
}
