import crypto from "node:crypto"

import { generateText } from "ai"

import { orchestrator } from "../engines/orchestrator.js"
import { orionTools } from "./tools.js"
import { createLogger } from "../logger.js"
import { acpRouter } from "../acp/router.js"
import { signMessage, type ACPMessage, type AgentCredential } from "../acp/protocol.js"
import { wrapWithGuard } from "../security/tool-guard.js"
import { dualAgentReviewer, wrapWithDualAgentReview } from "../security/dual-agent-reviewer.js"
import { applyTaskScope, getScopeForTask, inferTaskType } from "../permissions/task-scope.js"
import { responseCritic } from "../core/critic.js"
import { taskPlanner, type TaskDAG } from "./task-planner.js"
import { executionMonitor, type TaskResult } from "./execution-monitor.js"
import { buildSystemPrompt } from "../core/system-prompt-builder.js"
import { LoopDetector } from "../core/loop-detector.js"

const logger = createLogger("runner")

export interface AgentTask {
  id: string
  task: string
  context?: string
  userId?: string
}

export interface AgentResult {
  id: string
  result: string
  error?: string
  durationMs: number
}

export class AgentRunner {
  private readonly credential: AgentCredential

  constructor() {
    this.credential = acpRouter.registerAgent(
      "runner",
      ["runner.execute", "runner.parallel", "runner.supervise", "runner.status"],
      async (msg) => this.handleACPMessage(msg),
    )
  }

  getCredential(): AgentCredential {
    return this.credential
  }

  async runSingle(task: AgentTask): Promise<AgentResult> {
    const start = Date.now()

    try {
      const engine = orchestrator.route("reasoning")
      const inferredTaskType = inferTaskType(task.task)
      const taskScope = getScopeForTask(inferredTaskType)
      const scopeResult = applyTaskScope(orionTools, taskScope, {
        actorId: task.userId ?? "runner",
      })
      const scopedTools = scopeResult.tools
      const guardedTools = wrapWithGuard(scopedTools, task.userId ?? "runner")
      const reviewedTools = wrapWithDualAgentReview(guardedTools, {
        userRequest: task.task,
        actorId: task.userId ?? "runner",
        reviewer: dualAgentReviewer,
      })

      if (scopeResult.approvalRequired) {
        return {
          id: task.id,
          result: "",
          error:
            "Task requires explicit approval for system-level tools. Set ORION_SYSTEM_TOOL_APPROVED=true to allow.",
          durationMs: Date.now() - start,
        }
      }

      if (scopeResult.blockedTools.length > 0) {
        logger.info("Task scope blocked tools", {
          taskId: task.id,
          taskType: inferredTaskType,
          blockedTools: scopeResult.blockedTools,
        })
      }

      const prompt = task.context
        ? `Context: ${task.context}\n\nTask: ${task.task}`
        : task.task

      const systemPrompt = await buildSystemPrompt({
        sessionMode: "subagent",
        includeSkills: true,
        includeSafety: true,
        includeTooling: true,
        availableTools: Object.keys(reviewedTools),
      })

      let output = ""
      try {
        const result = await generateText({
          model: engine as any,
          system: systemPrompt,
          ...(Object.keys(reviewedTools).length > 0 ? { tools: reviewedTools as any } : {}),
          prompt,
        })
        output = result.text
      } catch {
        output = await orchestrator.generate("reasoning", { prompt, systemPrompt })
      }

      const critiqued = await responseCritic.critiqueAndRefine(task.task, output, 1)
      output = critiqued.finalResponse

      if (critiqued.refined) {
        logger.debug("response refined", {
          taskId: task.id,
          score: critiqued.critique.score,
          iterations: critiqued.iterations,
        })
      }

      logger.info(`task ${task.id} done in ${Date.now() - start}ms`)
      return { id: task.id, result: output, durationMs: Date.now() - start }
    } catch (err) {
      return {
        id: task.id,
        result: "",
        error: String(err),
        durationMs: Date.now() - start,
      }
    }
  }

  async runParallel(tasks: AgentTask[]): Promise<AgentResult[]> {
    logger.info(`running ${tasks.length} tasks in parallel`)
    return await Promise.all(tasks.map((t) => this.runSingle(t)))
  }

  async runSequential(tasks: AgentTask[]): Promise<AgentResult[]> {
    const results: AgentResult[] = []

    for (const task of tasks) {
      const prev = results[results.length - 1]
      if (prev?.result) {
        task.context = `Previous: ${prev.result}\n${task.context ?? ""}`
      }
      results.push(await this.runSingle(task))
    }

    return results
  }

  async runWithSupervisor(goal: string, maxSubtasks = 8): Promise<string> {
    logger.info("supervisor starting", { goal: goal.slice(0, 80), maxSubtasks })

    const timeoutMs = 120_000
    let timeoutHandle: NodeJS.Timeout | undefined
    
    // Phase I-2: Create LoopDetector instance per supervisor call
    const loopDetector = new LoopDetector()

    const supervisorRun = async (): Promise<string> => {
      const dag = await taskPlanner.plan(goal)
      const boundedDag = this.limitDagSize(dag, maxSubtasks)
      const executionWaves = taskPlanner.getExecutionOrder(boundedDag)
      const completedResults = new Map<string, TaskResult>()

      for (const wave of executionWaves) {
        logger.info("executing wave", { tasks: wave.map((node) => node.id) })

        // Phase I-2: Pass loopDetector to executeNode
        const waveResults = await Promise.all(
          wave.map((node) => executionMonitor.executeNode(node, completedResults, loopDetector)),
        )

        for (const result of waveResults) {
          completedResults.set(result.nodeId, result)
          
          // Phase I-2: Check for loop break signal
          if (result.loopBreak) {
            logger.warn("supervisor halted by loop detector", { 
              nodeId: result.nodeId, 
              signal: result.loopSignal 
            })
            // Synthesize with completed results so far
            break
          }
        }
      }

      const successfulOutputs = boundedDag.nodes
        .map((node) => {
          const result = completedResults.get(node.id)

          if (!result) {
            return `[${node.id}] success=false attempts=0\nTask: ${node.task}\nOutput: missing result`
          }

          return `[${node.id}] success=${result.success} attempts=${result.attempts}\nTask: ${node.task}\nOutput: ${result.output.slice(0, 900)}`
        })
        .join("\n\n---\n\n")

      const synthesisPrompt = `Synthesize these task results into one coherent response for this goal.
Goal: ${goal}
Results: ${successfulOutputs.slice(0, 4000)}

Provide a clear, unified answer.`

      return orchestrator.generate("reasoning", { prompt: synthesisPrompt })
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Supervisor timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      return await Promise.race([supervisorRun(), timeoutPromise])
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }

  private limitDagSize(dag: TaskDAG, maxSubtasks: number): TaskDAG {
    const boundedMax = Number.isFinite(maxSubtasks)
      ? Math.max(1, Math.min(8, Math.floor(maxSubtasks)))
      : 8

    if (dag.nodes.length <= boundedMax) {
      return dag
    }

    const keptNodes = dag.nodes.slice(0, boundedMax)
    const keptIds = new Set(keptNodes.map((node) => node.id))
    const normalizedNodes = keptNodes.map((node) => ({
      ...node,
      dependsOn: node.dependsOn.filter((depId) => keptIds.has(depId)),
    }))

    logger.warn("task plan exceeded max subtasks and was trimmed", {
      goal: dag.rootGoal.slice(0, 80),
      planned: dag.nodes.length,
      boundedMax,
    })

    return {
      ...dag,
      nodes: normalizedNodes,
    }
  }

  private async handleACPMessage(message: ACPMessage): Promise<ACPMessage> {
    const payload = (message.payload ?? {}) as Record<string, unknown>
    let result: unknown

    if (message.action === "runner.execute") {
      const task: AgentTask = {
        id: String(payload.id ?? `acp_${Date.now()}`),
        task: String(payload.task ?? ""),
        context: typeof payload.context === "string" ? payload.context : undefined,
        userId: typeof payload.userId === "string" ? payload.userId : undefined,
      }
      result = await this.runSingle(task)
    } else if (message.action === "runner.parallel") {
      const tasks = Array.isArray(payload.tasks) ? (payload.tasks as AgentTask[]) : []
      result = await this.runParallel(tasks)
    } else if (message.action === "runner.supervise") {
      result = await this.runWithSupervisor(
        String(payload.goal ?? ""),
        Number(payload.maxSubtasks ?? 8),
      )
    } else {
      result = { error: `unknown action: ${message.action}` }
    }

    const responseNoSignature = {
      id: crypto.randomUUID(),
      from: "runner",
      to: message.from,
      type: "response" as const,
      action: message.action,
      payload: result,
      correlationId: message.id,
      timestamp: Date.now(),
      state: "done" as const,
    }

    return {
      ...responseNoSignature,
      signature: signMessage(responseNoSignature, this.credential.secret),
    }
  }
}

export const agentRunner = new AgentRunner()
