import { createLogger } from "../logger.js"
import type { TaskNode } from "./task-planner.js"
import { runSpecializedAgent } from "./specialized-agents.js"

const log = createLogger("agents.execution-monitor")

export interface TaskResult {
  nodeId: string
  success: boolean
  output: string
  attempts: number
  errorHistory: string[]
}

export class ExecutionMonitor {
  async executeNode(
    node: TaskNode,
    completedResults: Map<string, TaskResult>,
  ): Promise<TaskResult> {
    const depContext = node.dependsOn
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
}

export const executionMonitor = new ExecutionMonitor()
