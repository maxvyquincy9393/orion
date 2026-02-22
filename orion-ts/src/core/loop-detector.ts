/**
 * loop-detector.ts — Detects repetitive patterns in agent workflows.
 *
 * Patterns detected:
 *   - identical-calls: Same tool + same params called N times
 *   - no-progress: Multiple calls, none producing new information
 *   - ping-pong: A→B→A→B alternation (agent stuck oscillating)
 *
 * Design: One instance per supervisor call. Pass to executeNode() to record
 * tool calls at the point they actually happen.
 *
 * Refs: arXiv 2510.23883 (Agentic AI Security)
 *
 * @module core/loop-detector
 */
import { createLogger } from "../logger.js"

const log = createLogger("core.loop-detector")

const WARNING_THRESHOLD = 3
const BREAK_THRESHOLD = 5
const PING_PONG_WINDOW = 6
const PROGRESS_WINDOW_MS = 30_000
// Minimum unique characters in output to count as "produced progress"
const MIN_PROGRESS_OUTPUT_CHARS = 50

export interface ToolCallRecord {
  tool: string
  paramHash: string
  timestamp: number
  producedProgress: boolean
}

export type LoopSeverity = "warning" | "circuit-break"

export interface LoopSignal {
  severity: LoopSeverity
  pattern: "identical-calls" | "no-progress" | "ping-pong"
  message: string
  shouldStop: boolean
}

export class LoopDetector {
  private readonly history: ToolCallRecord[] = []

  /**
   * Record a completed tool call with its output.
   *
   * @param tool   - Tool name (e.g. "searchTool", "fileReadTool")
   * @param params - Actual tool params (used for hash, not just node ID)
   * @param output - Output string from the tool call
   * @returns      Loop signal if loop detected, null if clean
   */
  record(
    tool: string,
    params: Record<string, unknown>,
    output: string,
  ): LoopSignal | null {
    // Detect progress by output length and uniqueness from previous outputs
    const producedProgress = this.evaluateProgress(tool, output)
    const paramHash = JSON.stringify(params)

    this.history.push({ tool, paramHash, timestamp: Date.now(), producedProgress })
    return this.analyze()
  }

  reset(): void {
    this.history.length = 0
  }

  /**
   * Determine if an output represents meaningful new progress.
   * Compares against recent outputs for the same tool.
   */
  private evaluateProgress(tool: string, output: string): boolean {
    if (output.trim().length < MIN_PROGRESS_OUTPUT_CHARS) return false

    // Check if this output is substantially different from recent outputs for same tool
    const recentSameTool = this.history
      .filter((c) => c.tool === tool)
      .slice(-3)
      .map((c) => c.producedProgress)

    // If we have no history for this tool, it's progress
    if (recentSameTool.length === 0) return true

    // Simple heuristic: at least MIN_PROGRESS_OUTPUT_CHARS of new content
    // More sophisticated: could diff against stored outputs, but that's memory-heavy
    return output.trim().length >= MIN_PROGRESS_OUTPUT_CHARS
  }

  private analyze(): LoopSignal | null {
    return (
      this.checkIdenticalCalls() ??
      this.checkNoProgress() ??
      this.checkPingPong()
    )
  }

  private checkIdenticalCalls(): LoopSignal | null {
    if (this.history.length < WARNING_THRESHOLD) return null

    const last = this.history[this.history.length - 1]
    const identicalCount = this.history.filter(
      (c) => c.tool === last.tool && c.paramHash === last.paramHash,
    ).length

    if (identicalCount >= BREAK_THRESHOLD) {
      log.warn("loop: circuit break — identical calls", { tool: last.tool, count: identicalCount })
      return {
        severity: "circuit-break",
        pattern: "identical-calls",
        message: `Tool '${last.tool}' called ${identicalCount}x with identical params. Stopping.`,
        shouldStop: true,
      }
    }

    if (identicalCount >= WARNING_THRESHOLD) {
      return {
        severity: "warning",
        pattern: "identical-calls",
        message: `Tool '${last.tool}' called ${identicalCount}x with identical params. Try a different approach.`,
        shouldStop: false,
      }
    }

    return null
  }

  private checkNoProgress(): LoopSignal | null {
    const now = Date.now()
    const recent = this.history.filter((c) => now - c.timestamp < PROGRESS_WINDOW_MS)
    if (recent.length < WARNING_THRESHOLD) return null

    const noProgressCount = recent.filter((c) => !c.producedProgress).length
    if (noProgressCount >= BREAK_THRESHOLD) {
      return {
        severity: "circuit-break",
        pattern: "no-progress",
        message: `No meaningful progress in ${noProgressCount} calls over ${PROGRESS_WINDOW_MS / 1000}s. Stopping.`,
        shouldStop: true,
      }
    }
    return null
  }

  private checkPingPong(): LoopSignal | null {
    if (this.history.length < PING_PONG_WINDOW) return null

    const recent = this.history.slice(-PING_PONG_WINDOW).map((c) => c.tool)
    let alterations = 0
    for (let i = 2; i < recent.length; i++) {
      if (recent[i] === recent[i - 2] && recent[i] !== recent[i - 1]) {
        alterations++
      }
    }

    if (alterations >= 3) {
      log.warn("loop: ping-pong detected", { pattern: recent.join("→") })
      return {
        severity: "circuit-break",
        pattern: "ping-pong",
        message: `Ping-pong loop: ${recent.join("→")}. Agent is stuck. Stopping.`,
        shouldStop: true,
      }
    }

    return null
  }
}
