/**
 * @file startup.ts
 * @description EDITH startup orchestrator  initialises all services and returns a ready MessagePipeline.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called by main.ts and gateway/server.ts. Bootstraps database, memory, channels,
 *   voice, daemon, and the pipeline in dependency order.
 */

import { exec } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { prisma } from "../database/index.js"
import { applyPragmas } from "../database/pragmas.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"
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
import { missionManager } from "../mission/mission-manager.js"
import { moodTracker } from "../emotion/mood-tracker.js"
import { skillMarketplace } from "../skills/marketplace.js"
import { syncScheduler } from "../memory/knowledge/sync-scheduler.js"
import { loadEDITHConfig } from "../config/edith-config.js"
import config from "../config.js"
import { deviceScanner } from "../hardware/device-scanner.js"
import { deviceRegistry } from "../hardware/device-registry.js"
import { gatewaySync } from "../gateway/gateway-sync.js"
import { networkDiscovery } from "../gateway/network-discovery.js"
import { sessionStore } from "../sessions/session-store.js"
import { SessionPersistence } from "../sessions/session-persistence.js"
import { outbox } from "../channels/outbox.js"
import { sidecarManager } from "./sidecar-manager.js"
import { performShutdown } from "./shutdown.js"
import { registerErrorBoundaries } from "./error-boundaries.js"
import { memoryGuard } from "./memory-guard.js"
import { ambientScheduler } from "../ambient/ambient-scheduler.js"
import { briefingScheduler } from "../protocols/briefing-scheduler.js"
import { hookLoader } from "../hooks/loader.js"
import { secretStore } from "../security/secret-store.js"

const log = createLogger("startup")

export interface StartupResult {
  processMessage: typeof processMessage
  shutdown: () => Promise<void>
}

/** Evict sessions idle for longer than this from in-memory store (1 hour). */
const SESSION_INACTIVE_MS = 60 * 60 * 1_000

/** How often to sweep inactive sessions (every 15 minutes). */
const SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1_000

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

/**
 * Validates that at least one LLM API key is configured.
 * Crashes with an actionable error message rather than a confusing runtime failure.
 *
 * Called once at the top of initialize().
 */
function validateRequiredEnv(): void {
  const llmKeys = [
    { key: "ANTHROPIC_API_KEY",  value: config.ANTHROPIC_API_KEY  },
    { key: "OPENAI_API_KEY",     value: config.OPENAI_API_KEY     },
    { key: "GEMINI_API_KEY",     value: config.GEMINI_API_KEY     },
    { key: "GROQ_API_KEY",       value: config.GROQ_API_KEY       },
    { key: "OPENROUTER_API_KEY", value: config.OPENROUTER_API_KEY },
  ]

  const hasLLM = llmKeys.some(({ value }) => value && value.trim().length > 0)
  if (!hasLLM) {
    log.error("STARTUP FAILED: no LLM API key configured", {
      required: "Set at least one of: " + llmKeys.map(k => k.key).join(", "),
      hint: "Copy .env.example to .env and fill in at least one API key",
    })
    process.exit(1)
  }

  if (!config.DATABASE_URL) {
    log.error("STARTUP FAILED: DATABASE_URL is not set", {
      hint: "Set DATABASE_URL in your .env file (e.g. DATABASE_URL=file:./edith.db)",
    })
    process.exit(1)
  }

  log.info("env validation passed")
}

/**
 * Run `prisma migrate deploy` if RUN_MIGRATIONS_ON_STARTUP is enabled.
 * Uses `pnpm exec prisma migrate deploy` to apply any pending migrations.
 * Never throws â€” migration failures are logged as warnings (graceful degradation).
 * Calling this at startup ensures the DB schema matches the Prisma schema.
 */
export async function runMigrationsIfEnabled(): Promise<void> {
  if (!config.RUN_MIGRATIONS_ON_STARTUP) return
  return new Promise((resolve) => {
    exec("pnpm exec prisma migrate deploy", (err) => {
      if (err) {
        log.warn("migration failed â€” continuing with existing schema", { err: String(err) })
      } else {
        log.info("database migrations applied")
      }
      resolve()
    })
  })
}

export async function initialize(workspaceDir: string): Promise<StartupResult> {
  registerErrorBoundaries()
  validateRequiredEnv()
  log.info("starting EDITH")

  await ensureWorkspaceStructure(workspaceDir)

  // Migrations acquire a write lock — must run BEFORE prisma.$connect() to
  // avoid "database is locked" on SQLite (single-writer constraint).
  await runMigrationsIfEnabled()

  await prisma
    .$connect()
    .then(() => log.info("database connected"))
    .catch((error: unknown) => log.error("database connection failed", error))

  // Apply production-grade SQLite pragmas (WAL mode, busy timeout, etc.)
  await applyPragmas(prisma)

  // Restore persisted sessions so they survive restarts
  await sessionStore.restoreFromDb()

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
          log.warn("local embedder unavailable â€” cloud embedding will be used")
        }
      })
      .catch((err) => log.warn("local embedder init error", { err }))
  }

  // Phase 9: Start connectivity monitoring
  offlineCoordinator.startMonitoring()
  offlineCoordinator.on("statechange", (state: string, previous: string) => {
    log.info("connectivity state changed", { from: previous, to: state })
    if (state === "offline") {
      log.warn("EDITH is now in offline mode â€” all local providers active")
    }
  })

  // Phase 10: Start habit model background monitoring
  habitModel.startMonitoring()

  // Phase 21: Emotion module (moodTracker is stateful, no explicit init needed)
  void moodTracker
  log.info("emotion module ready")

  // Phase 22: Mission manager (stateful singleton, no explicit init needed)
  void missionManager
  log.info("mission manager ready")

  // Phase 23: Hardware bridge â€” scan for devices (fire-and-forget)
  if (config.HARDWARE_ENABLED) {
    void deviceScanner.scan()
      .then(() => log.info("hardware bridge ready", { devices: deviceRegistry.list().length }))
      .catch((err) => log.warn("hardware scan failed", { err }))
  }

  // Phase 24: Self-improvement engine (stateful singletons, no explicit init needed)
  log.info("self-improvement engine ready")

  // Ambient intelligence â€” start ambient scheduler for weather/market cache warming
  void Promise.resolve(ambientScheduler.start())
    .catch((err) => log.warn("ambient scheduler start failed", { err }))

  // Protocols â€” start morning briefing scheduler
  void Promise.resolve(briefingScheduler.start())
    .catch((err) => log.warn("briefing scheduler start failed", { err }))

  // Hooks â€” load bundled hooks (gmail-watch, calendar-sync, github-events)
  void hookLoader.loadAll()
    .catch((err) => log.warn("hook loader failed", { err }))

  // Voice â€” start wake word detector if enabled
  if (config.WAKE_WORD_ENABLED === "true") {
    const { wakeWordDetector } = await import("../voice/wake-word.js")
    void wakeWordDetector.start()
      .catch((err) => log.warn("wake word detector start failed", { err }))
    log.info("wake word detection enabled")
  }

  // Phase 27: Cross-device mesh â€” start peer discovery (fire-and-forget)
  void networkDiscovery.discover()
    .then((peers) => {
      if (peers.length > 0) {
        log.info("gateway peers discovered", { count: peers.length })
        for (const peer of peers) {
          gatewaySync.registerPeer(peer.gatewayId, peer.url)
        }
      }
    })
    .catch((err) => log.warn("gateway peer discovery failed", { err }))
  log.info("cross-device mesh ready")
  log.info("gateway sync ready")

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

  // Session store: periodic LRU cleanup of inactive in-memory sessions
  const sessionCleanupTimer = setInterval(() => {
    const cleaned = sessionStore.cleanupInactiveSessions(SESSION_INACTIVE_MS)
    if (cleaned > 0) {
      log.debug("session cleanup sweep", { cleaned })
    }
  }, SESSION_CLEANUP_INTERVAL_MS)
  sessionCleanupTimer.unref()

  // Memory pressure guard â€” evicts sessions at warn threshold, graceful shutdown at critical
  memoryGuard.start()

  // Secret rotation â€” watch .env file for live secret updates (zero-downtime key rotation)
  secretStore.watch()
  eventBus.on("security.secrets_rotated", (data) => {
    log.info("API keys rotated â€” engines will use new values on next call", {
      keys: data.changedKeys,
    })
  })

  // Outbox: persist to .edith/ dir + start retry flusher
  outbox.setPersistPath(path.join(workspaceDir, "..", ".edith"))

  // Restore persisted sessions from previous run
  const sessionPersistence = new SessionPersistence(path.join(workspaceDir, "..", ".edith"))
  await sessionPersistence.load()

  // Python sidecar supervision
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const pythonCwd = path.resolve(__dirname, "../../python")
  const py = config.PYTHON_PATH ?? "python"

  if (config.VOICE_ENABLED) {
    sidecarManager.register({
      name: "voice",
      command: py,
      args: ["-m", "delivery.streaming_voice"],
      cwd: pythonCwd,
    })
    sidecarManager.start("voice")
  }

  if (config.VISION_ENABLED) {
    sidecarManager.register({
      name: "vision",
      command: py,
      args: ["-m", "vision.processor"],
      cwd: pythonCwd,
    })
    sidecarManager.start("vision")
  }

  const shutdown = async (): Promise<void> => {
    log.info("shutting down via StartupResult.shutdown()")
    memoryGuard.stop()
    clearInterval(sessionCleanupTimer)
    // Phase 9: Stop connectivity monitoring
    offlineCoordinator.stopMonitoring()
    // Phase 10: Stop habit model monitoring
    habitModel.stopMonitoring()
    // Phase 13: Stop knowledge base sync scheduler
    if (config.KNOWLEDGE_BASE_ENABLED) {
      syncScheduler.stop()
    }
    // Secret store â€” stop fs.watch before process exits
    secretStore.stopWatch()
    // Shutdown MCP clients
    await mcpClient.shutdown().catch((err) => log.warn("MCP shutdown error", err))
    // Delegate remaining teardown (outbox flush, WAL checkpoint, prisma, channels, sidecars)
    await performShutdown()
  }

  // Register signal handlers AFTER shutdown() is defined so they use the full
  // shutdown path (which clears sessionCleanupTimer and all other local teardown).
  process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)).catch(() => process.exit(1)) })
  process.on("SIGINT",  () => { void shutdown().then(() => process.exit(0)).catch(() => process.exit(1)) })

  return {
    processMessage,
    shutdown,
  }
}
