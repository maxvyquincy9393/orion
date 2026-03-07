/**
 * @file main.ts - EDITH entry point (Production-ready)
 * @description Enterprise-grade application entry point with comprehensive error handling,
 * graceful shutdown, and robust initialization.
 *
 * Responsibilities:
 *   - Parse and validate the `--mode` flag (text | gateway | all)
 *   - Initialize all subsystems via startup.ts with proper error handling
 *   - Start the appropriate transport layer(s)
 *   - Handle graceful shutdown with timeout guarantees
 *
 * This file remains thin. All initialization logic lives in src/core/startup.ts.
 * Transport-specific concerns live in their respective modules.
 *
 * @module main
 * @version 0.1.0
 */

// ── EDITH-style: inject edith.json env BEFORE anything reads process.env ──
import { injectEdithJsonEnv } from "./config/edith-config.js"
injectEdithJsonEnv()
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path"
import { readFileSync } from "node:fs"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { fileURLToPath } from "node:url"

import config from "./config.js"
import { createLogger } from "./logger.js"
import { memrlUpdater } from "./memory/memrl.js"
import { gateway } from "./gateway/server.js"
import { channelManager } from "./channels/manager.js"
import { daemon } from "./background/daemon.js"
import { initialize, type StartupResult } from "./core/startup.js"
import { eventBus } from "./core/event-bus.js"
import { memory } from "./memory/store.js"
import { orchestrator } from "./engines/orchestrator.js"
import type { PipelineResult, PipelineOptions } from "./core/message-pipeline.js"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Application version — read from package.json at startup */
function readVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const pkgPath = path.resolve(__dirname, "..", "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const VERSION = readVersion()

/** Valid operation modes */
const VALID_MODES = ["text", "gateway", "all", "edith"] as const
type OperationMode = (typeof VALID_MODES)[number]

/** Default operation mode when not specified */
const DEFAULT_MODE: OperationMode = "text"

/** Graceful shutdown timeout in milliseconds (configurable via SHUTDOWN_TIMEOUT_MS) */
const SHUTDOWN_TIMEOUT_MS = config.SHUTDOWN_TIMEOUT_MS

/** CLI exit commands (case-insensitive) */
const CLI_EXIT_COMMANDS = new Set(["exit", "quit", "bye"])

/** MemRL reward threshold for task success classification */
const MEMRL_SUCCESS_THRESHOLD = 0.5

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

const log = createLogger("main")

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate the --mode argument from command line.
 * @returns Validated operation mode
 */
function parseMode(): OperationMode {
  const modeIndex = process.argv.indexOf("--mode")
  if (modeIndex === -1 || modeIndex === process.argv.length - 1) {
    return DEFAULT_MODE
  }

  const requestedMode = process.argv[modeIndex + 1]?.toLowerCase()

  if (!requestedMode || !VALID_MODES.includes(requestedMode as OperationMode)) {
    log.warn(`Invalid mode "${requestedMode}", defaulting to "${DEFAULT_MODE}"`, {
      validModes: VALID_MODES,
    })
    return DEFAULT_MODE
  }

  return requestedMode as OperationMode
}

/**
 * Resolve workspace directory from environment or default.
 * @returns Absolute path to workspace directory
 */
function resolveWorkspaceDir(): string {
  const envWorkspace = process.env.EDITH_WORKSPACE ?? process.env.EDITH_WORKSPACE
  if (envWorkspace) {
    return path.isAbsolute(envWorkspace)
      ? envWorkspace
      : path.resolve(process.cwd(), envWorkspace)
  }
  return path.resolve(process.cwd(), "workspace")
}

const mode = parseMode()
const workspaceDir = resolveWorkspaceDir()

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Type-safe message processor function signature */
type MessageProcessor = (
  userId: string,
  text: string,
  options: PipelineOptions
) => Promise<PipelineResult>

/** Pending MemRL feedback state */
interface PendingMemRLFeedback {
  readonly memoryIds: readonly string[]
  readonly previousResponseLength: number
  readonly provisionalReward: number
}

/** Application state for tracking shutdown status */
interface ApplicationState {
  isShuttingDown: boolean
  shutdownPromise: Promise<void> | null
  readlineInterface: readline.Interface | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Application State
// ─────────────────────────────────────────────────────────────────────────────

const appState: ApplicationState = {
  isShuttingDown: false,
  shutdownPromise: null,
  readlineInterface: null,
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flush pending MemRL feedback before shutdown.
 * @param pendingFeedback - Pending feedback to flush, or null
 */
async function flushPendingFeedback(
  pendingFeedback: PendingMemRLFeedback | null
): Promise<void> {
  if (!pendingFeedback || pendingFeedback.memoryIds.length === 0) {
    return
  }

  try {
    await memory.provideFeedback({
      memoryIds: [...pendingFeedback.memoryIds],
      taskSuccess: false,
      reward: pendingFeedback.provisionalReward,
    })
    log.debug("flushed pending memrl feedback", {
      memoryCount: pendingFeedback.memoryIds.length,
    })
  } catch (error) {
    log.warn("failed to flush memrl feedback", { error: String(error) })
  }
}

/**
 * Process MemRL feedback from user follow-up.
 * @param text - User's follow-up text
 * @param pendingFeedback - Previous turn's pending feedback
 */
function processMemRLFeedback(
  text: string,
  pendingFeedback: PendingMemRLFeedback
): void {
  const followupReward = memrlUpdater.estimateRewardFromContext(
    text,
    pendingFeedback.previousResponseLength
  )
  const reward = Math.max(pendingFeedback.provisionalReward, followupReward)

  memory
    .provideFeedback({
      memoryIds: [...pendingFeedback.memoryIds],
      taskSuccess: reward >= MEMRL_SUCCESS_THRESHOLD,
      reward,
    })
    .catch((error) => {
      log.warn("async memrl feedback update failed", { error: String(error) })
    })
}

/**
 * Check if user input is an exit command.
 * @param text - User input text
 * @returns True if the input is an exit command
 */
function isExitCommand(text: string): boolean {
  return CLI_EXIT_COMMANDS.has(text.toLowerCase())
}

/**
 * Start the interactive CLI transport.
 * @param processMessage - Message processor function from startup
 */
async function startCLI(processMessage: MessageProcessor): Promise<void> {
  const rl = readline.createInterface({ input, output })
  appState.readlineInterface = rl

  let pendingFeedback: PendingMemRLFeedback | null = null
  const userId = config.DEFAULT_USER_ID

  // Cache the chat command handler to avoid repeated dynamic imports
  const { handleChatCommand } = await import("./core/chat-commands.js")

  log.info("cli transport started", { userId })

  while (!appState.isShuttingDown) {
    try {
      const rawText = await rl.question("> ")
      const text = rawText.trim()

      if (!text) {
        continue
      }

      if (isExitCommand(text)) {
        await flushPendingFeedback(pendingFeedback)
        break
      }

      // Process MemRL feedback from previous turn
      if (pendingFeedback !== null && pendingFeedback.memoryIds.length > 0) {
        processMemRLFeedback(text, pendingFeedback)
        pendingFeedback = null
      }

      // Emit user message event for observability
      eventBus.dispatch("user.message.received", {
        userId,
        content: text,
        channel: "cli",
        timestamp: Date.now(),
      })

      // Handle slash commands (instant response, no LLM call)
      const cmdResult = handleChatCommand(userId, text)
      if (cmdResult.handled) {
        output.write(`${cmdResult.response}\n`)
        continue
      }

      // Process through the main pipeline
      const result = await processMessage(userId, text, { channel: "cli" })
      output.write(`${result.response}\n`)

      // Store feedback context for next turn
      pendingFeedback =
        result.retrievedMemoryIds.length > 0
          ? {
              memoryIds: result.retrievedMemoryIds,
              previousResponseLength: result.response.length,
              provisionalReward: result.provisionalReward,
            }
          : null
    } catch (error) {
      // Handle expected shutdown conditions
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase()
        if (
          errorMessage.includes("aborted") ||
          errorMessage.includes("closed") ||
          errorMessage.includes("readline was closed")
        ) {
          await flushPendingFeedback(pendingFeedback)
          break
        }
      }

      log.error("cli loop error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
  }

  rl.close()
  appState.readlineInterface = null
  log.info("cli transport stopped")
}

// ─────────────────────────────────────────────────────────────────────────────
// Shutdown Handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute graceful shutdown with timeout guarantee.
 * Ensures shutdown only executes once even if called multiple times.
 *
 * @param shutdown - Shutdown function from startup
 * @returns Shutdown handler function
 */
function createGracefulShutdown(
  shutdown: StartupResult["shutdown"]
): (signal: string) => Promise<void> {
  return async (signal: string): Promise<void> => {
    // Prevent multiple shutdown attempts
    if (appState.isShuttingDown) {
      log.debug("shutdown already in progress, ignoring signal", { signal })
      return
    }

    appState.isShuttingDown = true
    log.info(`received ${signal}, initiating graceful shutdown`)
    output.write(`\n  Received ${signal}, shutting down gracefully...\n`)

    // Close readline interface if active
    if (appState.readlineInterface) {
      appState.readlineInterface.close()
      appState.readlineInterface = null
    }

    // Create shutdown with timeout
    const shutdownWithTimeout = async (): Promise<void> => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms`))
        }, SHUTDOWN_TIMEOUT_MS)
      })

      try {
        await Promise.race([shutdown(), timeoutPromise])
        log.info("graceful shutdown completed")
      } catch (error) {
        log.error("shutdown error", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    appState.shutdownPromise = shutdownWithTimeout()
    await appState.shutdownPromise

    process.exit(0)
  }
}

/**
 * Register signal handlers for graceful shutdown.
 * @param gracefulShutdown - Shutdown handler function
 */
function registerSignalHandlers(
  gracefulShutdown: (signal: string) => Promise<void>
): void {
  // Unix signals
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"))

  // Windows-specific signal (Ctrl+Break)
  if (process.platform === "win32") {
    process.on("SIGBREAK", () => void gracefulShutdown("SIGBREAK"))
  }

  // Handle uncaught exceptions in production
  process.on("uncaughtException", (error) => {
    log.error("uncaught exception", {
      error: error.message,
      stack: error.stack,
    })
    void gracefulShutdown("uncaughtException")
  })

  // Log unhandled rejections but don't exit
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Banner Display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display the application startup banner with configuration details.
 */
function displayBanner(): void {
  const engines = orchestrator.getAvailableEngines()
  const bannerLabel = mode === "edith"
    ? `EDITH OS Mode (legacy alias: edith) v${VERSION}`
    : `EDITH v${VERSION}`

  output.write("\n")
  output.write(`  ${bannerLabel}\n`)
  output.write("  Even Dead, I'm The Hero\n")
  output.write("\n")
  output.write(`  Mode      : ${mode}\n`)
  output.write(`  Workspace : ${workspaceDir}\n`)
  output.write(`  Engines   : ${engines.length > 0 ? engines.join(", ") : "none"}\n`)
}

/**
 * Display gateway-specific information.
 */
function displayGatewayInfo(): void {
  const channels = channelManager.getConnectedChannels()

  output.write(`  Gateway   : ws://${config.GATEWAY_HOST}:${config.GATEWAY_PORT}\n`)
  output.write(`  WebChat   : http://127.0.0.1:${config.WEBCHAT_PORT}\n`)
  output.write(`  Channels  : ${channels.length > 0 ? channels.join(", ") : "none"}\n`)
  output.write(`  Daemon    : ${daemon.isRunning() ? "running ✓" : "stopped"}\n`)
}

/**
 * Display help information.
 */
function displayHelpInfo(): void {
  output.write("\n")
  output.write("  Type /help for commands, /models to see engines\n")
  output.write("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main application entry point.
 * Initializes all subsystems and starts the appropriate transport(s).
 */
async function start(): Promise<void> {
  log.info("edith starting", { mode, workspaceDir, version: VERSION })

  // EDITH mode: force OS_AGENT_ENABLED
  if (mode === "edith" && !config.OS_AGENT_ENABLED) {
    process.env.EDITH_MODE = "true"
    ;(config as any).EDITH_MODE = true
    ;(config as any).OS_AGENT_ENABLED = true
  }

  // Initialize core systems
  const { processMessage, shutdown, osAgent } = await initialize(workspaceDir)

  // Display startup banner
  displayBanner()

  // EDITH mode: start perception loop and show OS-Agent status
  if (mode === "edith" && osAgent) {
    try {
      await osAgent.startPerceptionLoop()
      output.write("  OS-Agent  : active ✓\n")
      output.write(`  GUI       : ${osAgent.gui ? "ready" : "off"}\n`)
      output.write(`  Voice     : ${osAgent.voice ? "ready" : "off"}\n`)
      output.write(`  Perception: running (${osAgent.perception ? "live" : "off"})\n`)
    } catch (err) {
      log.warn("EDITH perception loop failed to start", { error: String(err) })
      output.write("  OS-Agent  : partial ⚠️\n")
    }
  }

  // Start gateway services if required
  if (mode === "gateway" || mode === "all" || mode === "edith") {
    await channelManager.init()
    await daemon.start()
    await gateway.start()
    displayGatewayInfo()
  }

  displayHelpInfo()

  // Register signal handlers for graceful shutdown
  const gracefulShutdown = createGracefulShutdown(shutdown)
  registerSignalHandlers(gracefulShutdown)

  log.info("edith ready", { mode })

  // Run appropriate transport(s)
  if (mode === "gateway") {
    // Gateway-only mode: keep process alive indefinitely
    await new Promise<never>(() => {
      // Intentionally never resolves - process stays alive
    })
  }

  if (mode === "edith") {
    // EDITH mode: gateway + CLI + perception (always-on)
    await startCLI(processMessage)
    await gracefulShutdown("cli-exit")
  }

  if (mode === "text" || mode === "all") {
    await startCLI(processMessage)
    // CLI exited normally
    await gracefulShutdown("cli-exit")
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

start().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : String(err)
  const errorStack = err instanceof Error ? err.stack : undefined

  log.error("fatal startup error", { error: errorMessage, stack: errorStack })

  // Use stderr for fatal errors
  process.stderr.write(`[EDITH Fatal Error] ${errorMessage}\n`)
  if (errorStack) {
    process.stderr.write(`${errorStack}\n`)
  }

  process.exit(1)
})


