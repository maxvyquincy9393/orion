/**
 * @file mission-reporter.ts
 * @description Generates the final mission report delivered to the user.
 *
 * ARCHITECTURE:
 *   Called when the mission transitions to "reporting" status.
 *   Uses LLM to produce a clean Markdown summary from the raw DAG results.
 *   Persists the report as the mission's `progress` field and returns
 *   the Markdown string for delivery through the message channel.
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import type { Mission, MissionReport } from "./mission-schema.js"

const log = createLogger("mission.reporter")

const REPORTER_SYSTEM = `You are summarising the results of an autonomous mission.
Write a clear, structured Markdown report covering: what was accomplished, what failed (if anything), and key outputs.
Be concise. Use bullet points for task results.`

/**
 * Builds and persists the final mission report.
 */
export class MissionReporter {
  /**
   * Generates a MissionReport and saves it to the database.
   *
   * @param mission - The completed (or halted) mission
   * @returns The final MissionReport
   */
  async report(mission: Mission): Promise<MissionReport> {
    log.info("generating report", { missionId: mission.id })

    const completedTasks = mission.dag.filter(t => t.status === "done")
    const failedTasks = mission.dag.filter(t => t.status === "failed")

    const taskSummary = mission.dag
      .map(t => `[${t.status.toUpperCase()}] ${t.description}${t.result ? `: ${t.result.slice(0, 200)}` : ""}`)
      .join("\n")

    const summary = await orchestrator.generate("fast", {
      systemPrompt: REPORTER_SYSTEM,
      prompt: `Mission: ${mission.goal}\n\nTasks:\n${taskSummary}`,
    })

    const elapsed = mission.startedAt
      ? Date.now() - new Date(mission.startedAt).getTime()
      : 0

    const missionReport: MissionReport = {
      missionId: mission.id,
      title: mission.title,
      goal: mission.goal,
      status: completedTasks.length === mission.dag.length ? "delivered" : mission.status,
      summary,
      completedTasks: completedTasks.map(t => t.description),
      failedTasks: failedTasks.map(t => t.description),
      tokensUsed: mission.budget.tokensUsed,
      apiCallsUsed: mission.budget.apiCallsUsed,
      elapsedMs: elapsed,
      deliveredAt: new Date(),
    }

    await prisma.mission.update({
      where: { id: mission.id },
      data: {
        status: missionReport.status,
        completedAt: missionReport.deliveredAt,
        progress: {
          summary: missionReport.summary,
          completedTaskCount: completedTasks.length,
          failedTaskCount: failedTasks.length,
        },
      },
    })

    log.info("report generated", { missionId: mission.id, status: missionReport.status })
    return missionReport
  }
}

export const missionReporter = new MissionReporter()
