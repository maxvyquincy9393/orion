import crypto from "node:crypto"

import { generateText, type LanguageModel } from "ai"

import config from "../config.js"
import { orchestrator } from "../engines/orchestrator.js"
import { edithTools } from "./tools.js"
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

// ── Research-Paper Modules (Reflexion, Self-Refine, CoALA Memory) ────────────
import { reflexionLoop } from "../core/reflexion.js"
import { selfRefine } from "../core/self-refine.js"
import { WorkingMemory } from "../memory/working-memory.js"
import { episodicMemory } from "../memory/episodic.js"

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

function normalizeMaxLlmCalls(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value))
  }
  return Math.max(1, Math.floor(config.AGENT_MAX_LLM_CALLS))
}

function wouldExceedLlmBudget(currentCalls: number, nextCalls: number, maxCalls: number): boolean {
  if (!Number.isFinite(nextCalls) || nextCalls <= 0) {
    return currentCalls > maxCalls
  }
  return currentCalls + Math.floor(nextCalls) > maxCalls
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
      // ── 1. Working Memory (CoALA scratchpad for this task) ──
      const wm = new WorkingMemory(`task_${task.id}`)

      // ── 2. Episodic Memory — recall past lessons for this type of task ──
      const userId = task.userId ?? "unknown"
      const failureLessons = episodicMemory.getFailureLessons(userId, task.task)
      const successPatterns = episodicMemory.getSuccessPatterns(userId, task.task)
      const episodicContext = episodicMemory.toContext(userId, task.task)

      if (failureLessons.length > 0) {
        wm.observe(`Past failures to avoid: ${failureLessons.join("; ")}`)
      }
      if (successPatterns.length > 0) {
        wm.observe(`Past successes to replicate: ${successPatterns.join("; ")}`)
      }

      const engine = orchestrator.route("reasoning")
      const inferredTaskType = inferTaskType(task.task)
      const taskScope = getScopeForTask(inferredTaskType)
      const scopeResult = applyTaskScope(edithTools, taskScope, {
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
            "Task requires explicit approval for system-level tools. Set EDITH_SYSTEM_TOOL_APPROVED=true to allow.",
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

      // ── 3. Build system prompt enriched with episodic memory ──
      const baseSystemPrompt = await buildSystemPrompt({
        sessionMode: "subagent",
        includeSkills: true,
        includeSafety: true,
        includeTooling: true,
        availableTools: Object.keys(reviewedTools),
      })

      const systemPrompt = episodicContext
        ? `${baseSystemPrompt}\n\n--- Episodic Memory ---\n${episodicContext}`
        : baseSystemPrompt

      // ── 4. Generate initial response ──
      let output = ""
      try {
        // Tools are Record<string, unknown> from security wrappers but AI SDK expects ToolSet.
        // The underlying objects are structurally compatible; cast at the boundary.
        const result = await generateText({
          model: engine as unknown as LanguageModel,
          system: systemPrompt,
          ...(Object.keys(reviewedTools).length > 0
            ? { tools: reviewedTools as Parameters<typeof generateText>[0]["tools"] }
            : {}),
          prompt,
        })
        output = result.text
      } catch (aiError) {
        logger.warn("AI SDK generation failed, falling back to orchestrator", {
          taskId: task.id,
          error: String(aiError),
        })
        output = await orchestrator.generate("reasoning", { prompt, systemPrompt })
      }

      wm.storePartial(output.slice(0, 500))

      // ── 5. Self-Refine: structured multi-dimension iterative refinement ──
      //    (replaces simple responseCritic for deeper quality improvement)
      try {
        const refined = await selfRefine(output, {
          task: task.task,
          dimensions: ["accuracy", "completeness", "clarity", "relevance"],
          maxIterations: 2,
        })

        if (refined.output !== output) {
          wm.think(`Self-refine improved output (${refined.iterations} iterations, satisfied=${refined.satisfiedEarly})`)
          output = refined.output
        }

        // ── 6. Reflexion fallback: if self-refine couldn't satisfy, retry from scratch ──
        if (!refined.satisfiedEarly && refined.finalScores.some((s) => s.score < 0.5)) {
          logger.info("self-refine unsatisfied, engaging reflexion loop", { taskId: task.id })
          wm.think("Output quality still low after self-refine, attempting reflexion retry")

          const reflexionResult = await reflexionLoop(
            task.task,
            async (augmentedPrompt) => {
              return orchestrator.generate("reasoning", {
                prompt: augmentedPrompt,
                systemPrompt,
              })
            },
            { maxTrials: 2 },
          )

          if (reflexionResult.passed || reflexionResult.output.length > output.length * 0.5) {
            output = reflexionResult.output
            wm.think(`Reflexion ${reflexionResult.passed ? "accepted" : "best-effort"} after ${reflexionResult.attempts} trials`)
          }
        }
      } catch (refineErr) {
        // Self-refine/reflexion failed — fall back to legacy critic
        logger.warn("self-refine pipeline failed, falling back to critic", {
          taskId: task.id,
          error: String(refineErr),
        })
        const critiqued = await responseCritic.critiqueAndRefine(task.task, output, 1)
        output = critiqued.finalResponse
      }

      // ── 7. Record episode for future recall ──
      const durationMs = Date.now() - start
      episodicMemory.record({
        userId,
        task: task.task,
        approach: inferredTaskType,
        outcome: "success",
        result: output.slice(0, 500),
        lesson: `Completed in ${durationMs}ms using ${inferredTaskType} approach`,
        tags: [inferredTaskType],
      })

      logger.info(`task ${task.id} done in ${durationMs}ms`)
      return { id: task.id, result: output, durationMs }
    } catch (err) {
      // Record failure episode for learning
      episodicMemory.record({
        userId: task.userId ?? "unknown",
        task: task.task,
        approach: "unknown",
        outcome: "failure",
        result: String(err),
        lesson: `Failed with error: ${String(err).slice(0, 200)}`,
        tags: ["error"],
      })

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

  async runWithSupervisor(
    goal: string,
    maxSubtasks = config.AGENT_MAX_SUBTASKS,
    options: { maxLlmCalls?: number } = {},
  ): Promise<string> {
    const maxLlmCalls = normalizeMaxLlmCalls(options.maxLlmCalls)
    logger.info("supervisor starting", { goal: goal.slice(0, 80), maxSubtasks, maxLlmCalls })

    const timeoutMs = config.AGENT_TIMEOUT_MS
    let timeoutHandle: NodeJS.Timeout | undefined
    let llmCallsUsed = 0

    const consumeLlmBudget = (count: number, stage: string): void => {
      if (!Number.isFinite(count) || count <= 0) {
        return
      }

      if (wouldExceedLlmBudget(llmCallsUsed, count, maxLlmCalls)) {
        llmCallsUsed += Math.floor(count)
        throw new Error(`LLM call budget exceeded at ${stage} (${llmCallsUsed}/${maxLlmCalls})`)
      }

      llmCallsUsed += Math.floor(count)
    }
    
    // Phase I-2: Create LoopDetector instance per supervisor call
    const loopDetector = new LoopDetector()

    const supervisorRun = async (): Promise<string> => {
      consumeLlmBudget(1, "task_planner")
      const dag = await taskPlanner.plan(goal)
      const boundedDag = this.limitDagSize(dag, maxSubtasks)
      const executionWaves = taskPlanner.getExecutionOrder(boundedDag)
      const completedResults = new Map<string, TaskResult>()

      for (const wave of executionWaves) {
        logger.info("executing wave", { tasks: wave.map((node) => node.id) })
        for (const node of wave) {
          if (llmCallsUsed >= maxLlmCalls) {
            throw new Error(`LLM call budget reached before node execution (${llmCallsUsed}/${maxLlmCalls})`)
          }

          // Phase I-2: Pass loopDetector to executeNode
          const result = await executionMonitor.executeNode(node, completedResults, loopDetector)
          completedResults.set(result.nodeId, result)
          consumeLlmBudget(Math.max(1, result.attempts), `node:${result.nodeId}`)
          
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

      consumeLlmBudget(1, "final_synthesis")
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
      const maxLlmCallsRaw = Number(payload.maxLlmCalls)
      const maxLlmCalls = Number.isFinite(maxLlmCallsRaw) ? maxLlmCallsRaw : undefined
      result = await this.runWithSupervisor(
        String(payload.goal ?? ""),
        Number(payload.maxSubtasks ?? 8),
        { maxLlmCalls },
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

export const __runnerTestUtils = {
  normalizeMaxLlmCalls,
  wouldExceedLlmBudget,
}
