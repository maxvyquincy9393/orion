import { createLogger } from "../logger.js"
import type { TaskNode } from "./task-planner.js"
import { runSpecializedAgent } from "./specialized-agents.js"
import { LoopDetector, type LoopSignal } from "../core/loop-detector.js"

const log = createLogger("agents.execution-monitor")

export interface TaskResult {
  nodeId: string
  success: boolean
  output: string
  attempts: number
  errorHistory: string[]
  loopBreak?: boolean      // true if circuit break triggered
  loopSignal?: LoopSignal  // signal yang memicu break
}

export class ExecutionMonitor {
  async executeNode(
    node: TaskNode,
    completedResults: Map<string, TaskResult>,
    loopDetector?: LoopDetector,  // optional untuk backward compat
  ): Promise<TaskResult> {
    // Phase I-5: Multi-Agent Memory — reviewer/analyst get full context
    const contextScope =
      node.agentType === "reviewer" || node.agentType === "analyst"
        ? [...completedResults.keys()]
        : node.dependsOn

    const depContext = contextScope
      .map((depId) => {
        const result = completedResults.get(depId)
        if (!result) {
          return `[Result of ${depId}]: unavailable`
        }

        return `[Result of ${depId} | success=${result.success}]: ${result.output.slice(0, 500)}`
      })
      .join("\n\n")

    let attempts = 0
    const errorHistory: string[] = []

    while (attempts < node.maxRetries + 1) {
      attempts += 1

      try {
        const context = attempts > 1
          ? `${depContext}\n\nPrevious attempt failed: ${errorHistory[errorHistory.length - 1]}\nTry a different approach.`
          : depContext || node.context

        const output = await runSpecializedAgent(node.agentType, node.task, context || undefined)

        // Phase I-2: Loop Detection — record tool call after successful execution
        if (loopDetector) {
          // Extract tool info from output if available
          const toolInfo = this.extractToolInfo(output)
          const signal = loopDetector.record(
            toolInfo.tool,
            toolInfo.params,
            output,
          )
          if (signal?.shouldStop) {
            log.warn("loop detector circuit break", { nodeId: node.id, signal })
            return {
              nodeId: node.id,
              success: false,
              output: `Loop detected: ${signal.message}`,
              attempts,
              errorHistory,
              loopBreak: true,
              loopSignal: signal,
            }
          }
          if (signal?.severity === "warning") {
            log.info("loop detector warning", { nodeId: node.id, message: signal.message })
          }
        }

        log.info("node completed", {
          nodeId: node.id,
          attempts,
          outputLength: output.length,
        })

        return {
          nodeId: node.id,
          success: true,
          output,
          attempts,
          errorHistory,
        }
      } catch (error) {
        const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        errorHistory.push(errMsg)

        log.warn("node attempt failed", {
          nodeId: node.id,
          attempt: attempts,
          error: errMsg,
        })

        if (attempts >= node.maxRetries + 1) {
          log.error("node exhausted retries", { nodeId: node.id })

          return {
            nodeId: node.id,
            success: false,
            output: `Task failed after ${attempts} attempts. Last error: ${errMsg}`,
            attempts,
            errorHistory,
          }
        }
      }
    }

    return {
      nodeId: node.id,
      success: false,
      output: "Task failed due to unexpected monitor state.",
      attempts,
      errorHistory,
    }
  }

  /**
   * Extract tool information from agent output.
   * This is a heuristic — in production, tool calls would be instrumented directly.
   */
  private extractToolInfo(output: string): { tool: string; params: Record<string, unknown> } {
    // Look for tool call patterns in output
    const toolMatch = output.match(/(\w+Tool)\s*\(/)
    if (toolMatch) {
      return {
        tool: toolMatch[1],
        params: { outputLength: output.length },
      }
    }
    // Default to generic task info
    return {
      tool: "specializedAgent",
      params: { outputLength: output.length },
    }
  }
}

export const executionMonitor = new ExecutionMonitor()
