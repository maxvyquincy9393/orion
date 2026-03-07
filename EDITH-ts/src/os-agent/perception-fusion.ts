/**
 * @file os-agent/perception-fusion.ts — Unified Perception Snapshot
 * @description Fuses inputs from all sensory subsystems (screen, audio, system, IoT)
 * into a single coherent context snapshot. This is the "situational awareness"
 * layer — giving EDITH a unified view of the user's current state.
 *
 * Based on:
 * - Generative Agents (arXiv:2304.03442) — Observation-Planning-Reflection cycle
 * - MemGPT (arXiv:2310.08560) — Virtual context management
 *
 * @module os-agent/perception-fusion
 */

import { createLogger } from "../logger.js"
import type { GUIAgent } from "./gui-agent.js"
import type { VisionCortex } from "./vision-cortex.js"
import type { VoiceIO } from "./voice-io.js"
import type { SystemMonitor } from "./system-monitor.js"
import type { IoTBridge } from "./iot-bridge.js"
import type { PerceptionSnapshot, ActiveContext, ScreenState } from "./types.js"

const log = createLogger("os-agent.perception")

interface PerceptionDeps {
  gui: GUIAgent
  vision: VisionCortex
  voice: VoiceIO
  system: SystemMonitor
  iot: IoTBridge
}

/**
 * Activity detection heuristics based on active window patterns.
 */
const ACTIVITY_PATTERNS: Array<{
  activity: ActiveContext["userActivity"]
  windowPatterns: RegExp[]
  processPatterns: RegExp[]
}> = [
  {
    activity: "coding",
    windowPatterns: [/vs\s?code/i, /visual studio/i, /intellij/i, /webstorm/i, /sublime/i, /vim/i, /neovim/i, /emacs/i, /cursor/i],
    processPatterns: [/code/i, /node/i, /python/i, /java/i, /cargo/i, /go/i],
  },
  {
    activity: "browsing",
    windowPatterns: [/chrome/i, /firefox/i, /safari/i, /edge/i, /brave/i, /opera/i, /arc/i],
    processPatterns: [/chrome/i, /firefox/i, /safari/i, /msedge/i, /brave/i],
  },
  {
    activity: "writing",
    windowPatterns: [/word/i, /docs/i, /notion/i, /obsidian/i, /typora/i, /google docs/i, /overleaf/i],
    processPatterns: [/winword/i, /notion/i, /obsidian/i],
  },
  {
    activity: "coding",
    windowPatterns: [/terminal/i, /powershell/i, /cmd\.exe/i, /windows terminal/i, /iterm/i, /warp/i, /alacritty/i, /kitty/i, /hyper/i, /wezterm/i, /konsole/i, /gnome-terminal/i],
    processPatterns: [/windowsterminal/i, /powershell/i, /cmd/i, /iterm2/i, /alacritty/i, /kitty/i, /wezterm/i, /bash/i, /zsh/i],
  },
  {
    activity: "communicating",
    windowPatterns: [/zoom/i, /teams/i, /meet/i, /webex/i, /discord/i, /slack/i, /skype/i, /google meet/i],
    processPatterns: [/zoom/i, /teams/i, /discord/i, /slack/i, /skype/i],
  },
  {
    activity: "designing",
    windowPatterns: [/figma/i, /sketch/i, /photoshop/i, /illustrator/i, /canva/i, /gimp/i, /inkscape/i, /blender/i, /affinity/i, /xd/i],
    processPatterns: [/figma/i, /sketch/i, /photoshop/i, /illustrator/i, /gimp/i, /blender/i, /inkscape/i],
  },
  {
    activity: "gaming",
    windowPatterns: [/steam/i, /game/i, /unity/i, /unreal/i, /minecraft/i, /valorant/i, /genshin/i],
    processPatterns: [/steam/i, /epicgames/i],
  },
  {
    activity: "media",
    windowPatterns: [/spotify/i, /youtube/i, /netflix/i, /vlc/i, /music/i, /video/i, /twitch/i],
    processPatterns: [/spotify/i, /vlc/i, /mpv/i],
  },
]

export class PerceptionFusion {
  private loopInterval: ReturnType<typeof setInterval> | null = null
  private lastSnapshot: PerceptionSnapshot | null = null
  private lastSuccessfulRefresh = 0
  private refreshFailCount = 0
  /** Maximum age in ms before a snapshot is considered stale */
  private static readonly STALE_THRESHOLD_MS = 10_000
  private activityStartTime = Date.now()
  private lastActivity: ActiveContext["userActivity"] = "unknown"

  constructor(private deps: PerceptionDeps) {}

  /**
   * Start the perception fusion loop.
   * Refreshes the unified snapshot at the configured interval.
   */
  async startLoop(intervalMs = 1000): Promise<void> {
    if (this.loopInterval) return

    // Start system monitoring
    this.deps.system.startMonitoring()

    // Initial snapshot
    await this.refresh()

    // Periodic refresh
    this.loopInterval = setInterval(async () => {
      try {
        await this.refresh()
      } catch (err) {
        log.warn("Perception refresh failed", { error: String(err) })
      }
    }, intervalMs)

    log.info(`Perception loop started (interval: ${intervalMs}ms)`)
  }

  /**
   * Stop the perception loop.
   */
  async stopLoop(): Promise<void> {
    if (this.loopInterval) {
      clearInterval(this.loopInterval)
      this.loopInterval = null
    }
    this.deps.system.stopMonitoring()
    log.info("Perception loop stopped")
  }

  /**
   * Get the latest perception snapshot.
   * If the loop isn't running, takes a fresh snapshot.
   * Returns null if all data is stale beyond threshold.
   */
  async getSnapshot(): Promise<PerceptionSnapshot> {
    if (!this.lastSnapshot) {
      await this.refresh()
    }

    // If the last successful refresh was too long ago, attempt a fresh one
    const age = Date.now() - this.lastSuccessfulRefresh
    if (age > PerceptionFusion.STALE_THRESHOLD_MS) {
      log.warn("Perception snapshot stale", { ageMs: age, failCount: this.refreshFailCount })
      try {
        await this.refresh()
      } catch {
        // Return what we have, but mark it
      }
    }

    return this.lastSnapshot!
  }

  /**
   * Produce a natural-language summary of the current context.
   * This can be injected into the system prompt for situational awareness.
   */
  summarize(): string {
    if (!this.lastSnapshot) return "No perception data available."

    const s = this.lastSnapshot
    const parts: string[] = []

    // System state
    parts.push(`System: CPU ${s.system.cpuUsage}%, RAM ${s.system.ramUsage}%`)
    if (s.system.batteryLevel !== undefined) {
      parts.push(`Battery: ${s.system.batteryLevel}%${s.system.isCharging ? " (charging)" : ""}`)
    }

    // Screen context
    if (s.screen) {
      parts.push(`Active window: "${s.screen.activeWindowTitle}" (${s.screen.activeWindowProcess})`)
    }

    // User activity
    parts.push(`Activity: ${s.activeContext.userActivity} (${s.activeContext.activityDurationMinutes} min)`)

    // Idle
    if (s.system.idleTimeSeconds > 60) {
      parts.push(`Idle: ${Math.floor(s.system.idleTimeSeconds / 60)} minutes`)
    }

    // IoT
    if (s.iot && s.iot.connectedDevices > 0) {
      parts.push(`IoT: ${s.iot.connectedDevices} devices connected`)
    }

    return parts.join(" | ")
  }

  // ── Private ──

  private async refresh(): Promise<void> {
    try {
      // Gather data from all subsystems in parallel
      const [screen, iotState] = await Promise.all([
        this.deps.vision.getScreenState().catch(() => null),
        this.deps.iot.getStates().catch(() => ({ connectedDevices: 0, devices: [] })),
      ])

      const systemState = this.deps.system.state
      const activeContext = this.detectActivity(screen)

      this.lastSnapshot = {
        timestamp: Date.now(),
        screen: screen ?? undefined,
        system: systemState,
        iot: iotState.connectedDevices > 0 ? iotState : undefined,
        activeContext,
        audio: {
          isSpeaking: this.deps.voice.isSpeaking,
          wakeWordDetected: this.deps.voice.wakeWordDetected,
          audioLevel: this.deps.voice.audioLevel,
          transcription: this.deps.voice.lastTranscript,
        },
      }

      this.lastSuccessfulRefresh = Date.now()
      this.refreshFailCount = 0
    } catch (err) {
      this.refreshFailCount++
      log.warn("Perception refresh error", { error: String(err), failCount: this.refreshFailCount })
      throw err
    }
  }

  private detectActivity(screen: ScreenState | null): ActiveContext {
    let detected: ActiveContext["userActivity"] = "unknown"
    let confidence = 0.3

    if (screen) {
      for (const pattern of ACTIVITY_PATTERNS) {
        const windowMatch = pattern.windowPatterns.some((p) => p.test(screen.activeWindowTitle))
        const processMatch = pattern.processPatterns.some((p) => p.test(screen.activeWindowProcess))

        if (windowMatch || processMatch) {
          detected = pattern.activity
          confidence = windowMatch && processMatch ? 0.95 : 0.75
          break
        }
      }
    }

    // Check idle
    const idleSeconds = this.deps.system.state.idleTimeSeconds
    if (idleSeconds > 300) {
      detected = "idle"
      confidence = 0.9
    }

    // Track activity duration
    if (detected !== this.lastActivity) {
      this.lastActivity = detected
      this.activityStartTime = Date.now()
    }

    return {
      userActivity: detected,
      activityConfidence: confidence,
      currentProject: this.detectProject(screen),
      activityDurationMinutes: Math.floor((Date.now() - this.activityStartTime) / 60_000),
    }
  }

  private detectProject(screen: ScreenState | null): string | undefined {
    if (!screen) return undefined

    // Try to extract project name from window title
    // VS Code: "filename - projectname - Visual Studio Code"
    const vscodeMatch = screen.activeWindowTitle.match(/.+\s-\s(.+?)\s-\s(?:Visual Studio Code|Cursor)/)
    if (vscodeMatch) return vscodeMatch[1]

    // JetBrains: "projectname – filename"
    const jetbrainsMatch = screen.activeWindowTitle.match(/^(.+?)\s[–-]\s/)
    if (jetbrainsMatch) return jetbrainsMatch[1]

    return undefined
  }
}
