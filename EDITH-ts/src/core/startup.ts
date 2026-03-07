/**
 * EDITH startup and dependency initialization.
 * Sets up all services and returns a configured MessagePipeline ready to use.
 * Separated from main.ts so startup can be tested and reused by gateway.
 */

import fs from "node:fs/promises"
import path from "node:path"

import { agentRunner } from "../agents/runner.js"
import { registerOSAgentTool } from "../agents/tools.js"
import { daemon } from "../background/daemon.js"
import config from "../config.js"
import { loadEdithConfig } from "../config/edith-config.js"
import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"
import { causalGraph } from "../memory/causal-graph.js"
import { memory } from "../memory/store.js"
import { mcpClient, type MCPServerConfig } from "../mcp/client.js"
import { initializeTracing, shutdownTracing } from "../observability/tracing.js"
import { getDefaultOSAgentConfig, getEdithOSConfig } from "../os-agent/defaults.js"
import { OSAgent } from "../os-agent/index.js"
import type { OSAgentConfig } from "../os-agent/types.js"
import { resolveOSVoiceConfig } from "../os-agent/voice-config.js"
import { pluginLoader } from "../plugin-sdk/loader.js"
import { skillLoader } from "../skills/loader.js"
import { resolveRuntimeVoiceConfig } from "../voice/runtime-config.js"
import { bootstrapLoader } from "./bootstrap.js"
import { eventBus } from "./event-bus.js"
import { processMessage } from "./message-pipeline.js"

const log = createLogger("startup")

export interface StartupResult {
  processMessage: typeof processMessage
  shutdown: () => Promise<void>
  osAgent: OSAgent | null
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
  log.info("starting EDITH-ts")

  await ensureWorkspaceStructure(workspaceDir)
  await initializeTracing()

  try {
    await prisma.$connect()
    log.info("database connected")
  } catch (error: unknown) {
    log.error("database connection failed", error)
    throw new Error("Cannot start without database connection")
  }

  await memory.init()
  await orchestrator.init()
  await skillLoader.buildSnapshot()
  skillLoader.startWatching({ enabled: true, debounceMs: 1_500 })
  await pluginLoader.loadAllFromDefaultDir()
  void agentRunner
  void bootstrapLoader
  initializeEventHandlers()

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

  const edithConfig = await loadEdithConfig()
  const edithMode = config.EDITH_MODE
  const runtimeVoice = resolveRuntimeVoiceConfig(edithConfig)
  const edithOsAgent = (edithConfig as Record<string, unknown>).osAgent as
    | { enabled?: boolean; gui?: object; vision?: object; voice?: object; system?: object; iot?: object; perceptionIntervalMs?: number }
    | undefined
  const shouldStartOSAgent = config.OS_AGENT_ENABLED
    || edithMode
    || Boolean(edithOsAgent?.enabled)
    || (runtimeVoice.enabled && runtimeVoice.mode === "always-on")

  let osAgent: OSAgent | null = null
  if (shouldStartOSAgent) {
    try {
      let osAgentConfig: OSAgentConfig
      if (edithMode) {
        const defaults = getEdithOSConfig()
        osAgentConfig = {
          gui: defaults.gui,
          vision: defaults.vision,
          voice: resolveOSVoiceConfig(
            defaults.voice,
            runtimeVoice,
            edithOsAgent?.voice as
              | {
                enabled?: boolean
                wakeWord?: string
                wakeWordModelPath?: string
                wakeWordEngine?: "porcupine" | "openwakeword"
                sttEngine?: "whisper-local" | "deepgram" | "google" | "azure"
                vadEngine?: "cobra" | "silero" | "webrtc"
                whisperModel?: "tiny" | "base" | "small" | "medium" | "large"
                fullDuplex?: boolean
                language?: string
                ttsVoice?: string
              }
              | undefined,
          ),
          system: defaults.system,
          iot: defaults.iot,
          perceptionIntervalMs: defaults.perceptionIntervalMs,
        }
        log.info("OS-Agent: EDITH mode enabled (all features ON)")
      } else {
        const defaults = getDefaultOSAgentConfig()
        osAgentConfig = {
          gui: { ...defaults.gui, ...(edithOsAgent?.gui as object ?? {}) },
          vision: { ...defaults.vision, ...(edithOsAgent?.vision as object ?? {}) },
          voice: resolveOSVoiceConfig(
            defaults.voice,
            runtimeVoice,
            edithOsAgent?.voice as
              | {
                enabled?: boolean
                wakeWord?: string
                wakeWordModelPath?: string
                wakeWordEngine?: "porcupine" | "openwakeword"
                sttEngine?: "whisper-local" | "deepgram" | "google" | "azure"
                vadEngine?: "cobra" | "silero" | "webrtc"
                whisperModel?: "tiny" | "base" | "small" | "medium" | "large"
                fullDuplex?: boolean
                language?: string
                ttsVoice?: string
              }
              | undefined,
          ),
          system: { ...defaults.system, ...(edithOsAgent?.system as object ?? {}) },
          iot: { ...defaults.iot, ...(edithOsAgent?.iot as object ?? {}) },
          perceptionIntervalMs: edithOsAgent?.perceptionIntervalMs ?? defaults.perceptionIntervalMs,
        }
      }

      if (config.HOME_ASSISTANT_URL) {
        osAgentConfig.iot.homeAssistantUrl = config.HOME_ASSISTANT_URL
      }
      if (config.HOME_ASSISTANT_TOKEN) {
        osAgentConfig.iot.homeAssistantToken = config.HOME_ASSISTANT_TOKEN
      }

      osAgent = new OSAgent(osAgentConfig)

      if (osAgentConfig.voice.enabled && osAgentConfig.voice.mode === "always-on") {
        let activeVoiceTurn: AbortController | null = null
        const voiceUserId = config.DEFAULT_USER_ID

        osAgent.voice.on("speechEnd", (transcription: string) => {
          const trimmed = transcription.trim()
          if (!trimmed) {
            return
          }

          void (async () => {
            activeVoiceTurn?.abort("superseded")
            const turnAbort = new AbortController()
            activeVoiceTurn = turnAbort

            try {
              const result = await processMessage(voiceUserId, trimmed, {
                channel: "voice",
                signal: turnAbort.signal,
              })

              if (turnAbort.signal.aborted) {
                return
              }

              await osAgent?.voice.speak(result.response, {
                voice: osAgentConfig.voice.ttsVoice,
              })
            } catch (voiceError) {
              if (!turnAbort.signal.aborted) {
                log.warn("OS-Agent voice turn failed", {
                  transcription: trimmed,
                  error: String(voiceError),
                })
              }
            }
          })()
        })

        osAgent.voice.on("error", (voiceError: Error) => {
          log.warn("OS-Agent voice loop error", { error: voiceError.message })
        })
      }

      await osAgent.initialize()

      if (osAgentConfig.voice.enabled && osAgentConfig.voice.mode === "always-on") {
        await osAgent.voice.startListening()
      }

      ;(globalThis as any).__edithOSAgent = osAgent
      registerOSAgentTool(osAgent)

      log.info("OS-Agent layer initialized", {
        gui: osAgentConfig.gui.enabled,
        vision: osAgentConfig.vision.enabled,
        voice: osAgentConfig.voice.enabled,
        system: osAgentConfig.system.enabled,
        iot: osAgentConfig.iot.enabled,
      })
    } catch (osErr) {
      log.warn("OS-Agent initialization failed (non-fatal)", { error: String(osErr) })
    }
  }

  const shutdown = async (): Promise<void> => {
    log.info("shutting down")
    if (daemon.isRunning()) {
      daemon.stop()
    }
    if (osAgent) {
      await osAgent.shutdown().catch((err) => log.warn("OS-Agent shutdown error", err))
    }
    await mcpClient.shutdown().catch((err) => log.warn("MCP shutdown error", err))
    await shutdownTracing().catch((err) => log.warn("tracing shutdown error", err))
    await prisma.$disconnect()
  }

  return {
    processMessage,
    shutdown,
    osAgent,
  }
}
