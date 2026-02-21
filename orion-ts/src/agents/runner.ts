import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import { orchestrator } from "../engines/orchestrator"
import { orionTools } from "./tools"

export interface AgentTask {
  id: string
  task: string
  context?: string
  tools?: string[]
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

      const result = await orchestrator.generate("reasoning", { prompt })

      return {
        id: task.id,
        result,
        durationMs: Date.now() - start,
      }
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
    return await Promise.all(tasks.map((t) => this.runSingle(t)))
  }

  async runSequential(tasks: AgentTask[]): Promise<AgentResult[]> {
    const results: AgentResult[] = []

    for (const task of tasks) {
      const prev = results[results.length - 1]
      if (prev && prev.result) {
        task.context = prev.result
      }
      results.push(await this.runSingle(task))
    }

    return results
  }

  async runWithSupervisor(goal: string, maxAgents = 5): Promise<string> {
    const planPrompt = `Break this goal into ${maxAgents} parallel subtasks. Return ONLY a JSON array of strings, no other text. Goal: "${goal}"`

    let plan: string[]
    try {
      const planResponse = await orchestrator.generate("reasoning", { prompt: planPrompt })
      const jsonMatch = planResponse.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0])
      } else {
        plan = [goal]
      }
    } catch {
      plan = [goal]
    }

    const tasks: AgentTask[] = plan.slice(0, maxAgents).map((t, i) => ({
      id: `task_${i}`,
      task: t,
    }))

    const results = await this.runParallel(tasks)

    const aggregatePrompt = `Combine these results into one coherent response for goal: "${goal}"

Results:
${results.map((r) => r.result).join("\n\n")}`

    return await orchestrator.generate("reasoning", { prompt: aggregatePrompt })
  }
}

export const agentRunner = new AgentRunner()
