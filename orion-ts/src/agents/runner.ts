import { generateText } from "ai"

import { orchestrator } from "../engines/orchestrator.js"
import { orionTools } from "./tools.js"
import { createLogger } from "../logger.js"

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
}

export const agentRunner = new AgentRunner()
