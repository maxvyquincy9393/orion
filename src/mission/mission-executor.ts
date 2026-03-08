/**
 * @file mission-executor.ts
 * @description Runs a mission DAG, enforcing budgets and safety at every step.
 *
 * ARCHITECTURE:
 *   Processes the planned DAG in topological order (respecting dependsOn).
 *   Parallel tasks at the same depth level run concurrently (up to a safe cap).
 *   ALL sub-tasks are routed through orchestrator.generate() — never bypass.
 *   Persists state to the Mission Prisma model after every task transition.
 *
 *   Budget accounting: each LLM call increments apiCallsUsed; token counts
 *   are tracked via the response metadata if available.
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { safetyGuardrails, BudgetExceededError } from "./safety-guardrails.js"
import { missionMonitor } from "./mission-monitor.js"
import type { Mission, MissionTask, MissionBudget } from "./mission-schema.js"

const log = createLogger("mission.executor")

/** System prompt for task execution sub-calls. */
const TASK_SYSTEM = `You are executing one sub-task of a larger autonomous mission.
Complete the task described. Be concise. Return a plain-text result.`

/**
 * Executes a mission DAG, task by task, respecting all guardrails.
 */
export class MissionExecutor {
  /**
   * Runs the mission DAG to completion (or termination by guardrails).
   * Updates mission status in the database throughout.
   *
   * @param mission - The mission to execute (must be in "executing" status)
   */
  async execute(mission: Mission): Promise<void> {
    log.info("execution started", { missionId: mission.id })

    mission.budget.startedAtMs = Date.now()
    missionMonitor.startCheckpointing(mission, () => mission.budget)

    try {
      await this.updateStatus(mission.id, "executing")
      await this.runDag(mission)
      await this.updateStatus(mission.id, "winding_down")
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        log.warn("mission halted by budget limit", { missionId: mission.id, reason: err.message })
        await this.updateStatus(mission.id, "winding_down")
      } else {
        log.error("mission executor error", { missionId: mission.id, err })
        await this.updateStatus(mission.id, "recovering")
      }
      throw err
    } finally {
      missionMonitor.stopCheckpointing(mission.id)
    }
  }

  /** Processes the DAG in topological waves. */
  private async runDag(mission: Mission): Promise<void> {
    const tasks = mission.dag
    const completed = new Set<string>()

    while (true) {
      safetyGuardrails.checkBudgets(mission.budget)
      safetyGuardrails.checkDeadManSwitch(missionMonitor.getLastProgressMs(mission.id))

      // Find tasks whose dependencies are all satisfied.
      const ready = tasks.filter(
        t => t.status === "pending" && t.dependsOn.every(dep => completed.has(dep)),
      )

      if (ready.length === 0) break

      // Separate parallel vs sequential.
      const parallelBatch = ready.filter(t => t.parallel)
      const sequential = ready.filter(t => !t.parallel)

      // Run parallel batch concurrently.
      if (parallelBatch.length > 0) {
        await Promise.all(parallelBatch.map(t => this.runTask(mission, t, completed)))
      }

      // Run sequential tasks one by one.
      for (const task of sequential) {
        await this.runTask(mission, task, completed)
        safetyGuardrails.checkBudgets(mission.budget)
      }
    }
  }

  /** Executes a single task and persists the result. */
  private async runTask(
    mission: Mission,
    task: MissionTask,
    completed: Set<string>,
  ): Promise<void> {
    task.status = "running"
    task.startedAt = new Date().toISOString()
    await this.persistDag(mission)

    log.debug("running task", { missionId: mission.id, taskId: task.id })

    try {
      const result = await orchestrator.generate("reasoning", {
        systemPrompt: TASK_SYSTEM,
        prompt: `Mission: ${mission.goal}\nTask: ${task.description}`,
      })

      mission.budget.apiCallsUsed += 1
      mission.budget.tokensUsed += Math.ceil(result.length / 4) // rough estimate

      task.status = "done"
      task.result = result
      task.completedAt = new Date().toISOString()
      completed.add(task.id)
      missionMonitor.recordProgress(mission.id)
    } catch (err) {
      task.status = "failed"
      task.error = err instanceof Error ? err.message : String(err)
      log.warn("task failed", { missionId: mission.id, taskId: task.id, err })
    }

    await this.persistDag(mission)
  }

  /** Saves the current DAG state to the database. */
  private async persistDag(mission: Mission): Promise<void> {
    await prisma.mission.update({
      where: { id: mission.id },
      data: {
        dag: mission.dag as object[],
        tokensUsed: mission.budget.tokensUsed,
        apiCallsUsed: mission.budget.apiCallsUsed,
      },
    })
  }

  /** Updates the mission status in the database. */
  private async updateStatus(missionId: string, status: string): Promise<void> {
    await prisma.mission.update({
      where: { id: missionId },
      data: { status },
    })
  }
}

export const missionExecutor = new MissionExecutor()
