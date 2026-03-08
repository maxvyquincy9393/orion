/**
 * @file sidecar-manager.ts
 * @description Manages Python sidecar process lifecycle with auto-restart.
 *
 * ARCHITECTURE:
 *   VoiceBridge and VisionBridge spawn Python subprocesses on demand.
 *   SidecarManager tracks long-running sidecars and restarts them if they
 *   exit unexpectedly, using exponential backoff to avoid tight restart loops.
 *   Sidecars are registered by name (e.g. "voice", "vision") and can be
 *   queried for health status.
 *
 * PAPER BASIS:
 *   Exponential backoff: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */

import { spawn, type ChildProcess } from "node:child_process"
import { createLogger } from "../logger.js"

const log = createLogger("core.sidecar-manager")

/** Configuration for a managed sidecar process. */
export interface SidecarConfig {
  /** Unique name for this sidecar (e.g. "voice", "vision"). */
  name: string
  /** The command to run (e.g. "python"). */
  command: string
  /** Arguments to pass (e.g. ["-m", "delivery.streaming_voice"]). */
  args: string[]
  /** Working directory for the process. */
  cwd: string
  /** Whether to auto-restart on crash (default: true). */
  autoRestart?: boolean
  /** Maximum restart attempts before giving up (default: 5). */
  maxRestarts?: number
}

/** Runtime state of a tracked sidecar. */
interface SidecarState {
  config: SidecarConfig
  process: ChildProcess | null
  restartCount: number
  healthy: boolean
  startedAt: Date | null
}

/**
 * SidecarManager — tracks and supervises long-running Python child processes.
 *
 * Usage:
 *   sidecarManager.register({ name: "voice", command: "python", args: [...], cwd: "..." })
 *   sidecarManager.start("voice")
 */
export class SidecarManager {
  /** Registry of all known sidecars. */
  private readonly sidecars = new Map<string, SidecarState>()

  /** Maximum backoff delay in ms (caps at 30 seconds). */
  private static readonly MAX_BACKOFF_MS = 30_000

  /**
   * Register a sidecar configuration. Does not start the process.
   *
   * @param config - Sidecar configuration
   */
  register(config: SidecarConfig): void {
    this.sidecars.set(config.name, {
      config,
      process: null,
      restartCount: 0,
      healthy: false,
      startedAt: null,
    })
    log.debug("sidecar registered", { name: config.name })
  }

  /**
   * Start a registered sidecar.
   *
   * @param name - Sidecar name (must be registered first)
   */
  start(name: string): void {
    const state = this.sidecars.get(name)
    if (!state) {
      log.warn("sidecar not registered", { name })
      return
    }
    this._spawn(state)
  }

  /**
   * Stop a sidecar and disable auto-restart.
   *
   * @param name - Sidecar name
   */
  stop(name: string): void {
    const state = this.sidecars.get(name)
    if (!state) return
    state.config.autoRestart = false
    state.process?.kill("SIGTERM")
    state.healthy = false
    log.info("sidecar stopped", { name })
  }

  /**
   * Stop all managed sidecars (call on process shutdown).
   */
  stopAll(): void {
    for (const name of this.sidecars.keys()) {
      this.stop(name)
    }
  }

  /**
   * Returns health status of all registered sidecars.
   */
  getStatus(): Record<string, { healthy: boolean; restarts: number; pid: number | undefined }> {
    const result: Record<string, { healthy: boolean; restarts: number; pid: number | undefined }> = {}
    for (const [name, state] of this.sidecars) {
      result[name] = {
        healthy: state.healthy,
        restarts: state.restartCount,
        pid: state.process?.pid,
      }
    }
    return result
  }

  /**
   * Spawn a sidecar and attach exit/error handlers for auto-restart.
   *
   * @param state - Mutable sidecar state to update
   */
  private _spawn(state: SidecarState): void {
    const { config } = state
    log.info("starting sidecar", { name: config.name, command: config.command, args: config.args })

    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })

    state.process = child
    state.healthy = true
    state.startedAt = new Date()

    child.stdout?.on("data", (data: Buffer) => {
      log.debug(`[${config.name}] ${data.toString().trim()}`)
    })

    child.stderr?.on("data", (data: Buffer) => {
      log.warn(`[${config.name}] stderr: ${data.toString().trim()}`)
    })

    child.on("error", (err) => {
      state.healthy = false
      log.error("sidecar process error", { name: config.name, err })
    })

    child.on("exit", (code, signal) => {
      state.healthy = false
      state.process = null

      if (code === 0 || signal === "SIGTERM") {
        log.info("sidecar exited cleanly", { name: config.name, code, signal })
        return
      }

      log.warn("sidecar crashed", { name: config.name, code, signal, restarts: state.restartCount })

      if (config.autoRestart === false) return

      const maxRestarts = config.maxRestarts ?? 5
      if (state.restartCount >= maxRestarts) {
        log.error("sidecar exceeded max restarts, giving up", {
          name: config.name,
          maxRestarts,
        })
        return
      }

      state.restartCount++
      const backoffMs = Math.min(1_000 * 2 ** (state.restartCount - 1), SidecarManager.MAX_BACKOFF_MS)
      log.info("sidecar restart scheduled", { name: config.name, backoffMs, attempt: state.restartCount })

      setTimeout(() => this._spawn(state), backoffMs)
    })
  }
}

/** Singleton instance used across the application. */
export const sidecarManager = new SidecarManager()
