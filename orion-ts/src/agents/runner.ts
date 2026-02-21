import crypto from "node:crypto"

import { generateText } from "ai"

import { orchestrator } from "../engines/orchestrator.js"
import { orionTools } from "./tools.js"
import { createLogger } from "../logger.js"
import { acpRouter } from "../acp/router.js"
import { signMessage, type ACPMessage, type AgentCredential } from "../acp/protocol.js"

const logger = createLogger("runner")

export interface AgentTask {
  id: string
  task: string
  context?: string
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
      const prompt = task.context
        ? `Context: ${task.context}\n\nTask: ${task.task}`
        : task.task

      let output = ""
      try {
        const result = await generateText({
          model: engine as any,
          tools: orionTools,
          prompt,
        })
        output = result.text
      } catch {
        output = await orchestrator.generate("reasoning", { prompt })
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

  async runWithSupervisor(goal: string, maxSubtasks = 5): Promise<string> {
    logger.info(`supervisor planning: ${goal}`)

    const plan = await orchestrator.generate("reasoning", {
      prompt: `Break this goal into at most ${maxSubtasks} independent parallel subtasks. Return ONLY a valid JSON array of strings. No explanation. Goal: "${goal}"`,
    })

    let subtasks: string[]
    try {
      subtasks = JSON.parse(plan.replace(/```json|```/g, "").trim())
      if (!Array.isArray(subtasks)) {
        throw new Error("invalid plan")
      }
    } catch {
      subtasks = [goal]
    }

    const tasks: AgentTask[] = subtasks.map((task, index) => ({
      id: `sub_${index}`,
      task,
    }))

    const results = await this.runParallel(tasks)

    const aggregate = await orchestrator.generate("reasoning", {
      prompt: `Combine into one coherent response. Goal: "${goal}" Results: ${results
        .map((result, index) => `[${index + 1}] ${result.result}`)
        .join("\n\n")}`,
    })

    return aggregate
  }

  private async handleACPMessage(message: ACPMessage): Promise<ACPMessage> {
    const payload = (message.payload ?? {}) as Record<string, unknown>
    let result: unknown

    if (message.action === "runner.execute") {
      const task: AgentTask = {
        id: String(payload.id ?? `acp_${Date.now()}`),
        task: String(payload.task ?? ""),
        context: typeof payload.context === "string" ? payload.context : undefined,
      }
      result = await this.runSingle(task)
    } else if (message.action === "runner.parallel") {
      const tasks = Array.isArray(payload.tasks) ? (payload.tasks as AgentTask[]) : []
      result = await this.runParallel(tasks)
    } else if (message.action === "runner.supervise") {
      result = await this.runWithSupervisor(
        String(payload.goal ?? ""),
        Number(payload.maxSubtasks ?? 5),
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
