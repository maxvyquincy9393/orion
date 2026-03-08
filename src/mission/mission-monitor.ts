/**
 * @file mission-monitor.ts
 * @description Checkpoint saving, dead-man-switch tracking, and budget counters.
 *
 * ARCHITECTURE:
 *   mission-monitor is called by mission-executor.ts at regular intervals
 *   (MISSION_CHECKPOINT_INTERVAL_MS) and after each task completion.
 *   It saves checkpoint rows to Prisma and updates the in-memory budget state.
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import config from "../config.js"
import type { Mission, MissionBudget } from "./mission-schema.js"

const log = createLogger("mission.monitor")

/**
 * Tracks checkpoints and monitors resource consumption for a mission.
 */
export class MissionMonitor {
  /** Last progress time keyed by missionId. */
  private readonly lastProgress = new Map<string, number>()
  /** Checkpoint interval timers keyed by missionId. */
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>()

  /**
   * Starts checkpoint interval for a mission.
   * @param mission - The mission being monitored
   * @param getBudget - Callback to get the current budget state
   */
  startCheckpointing(mission: Mission, getBudget: () => MissionBudget): void {
    this.lastProgress.set(mission.id, Date.now())
    const timer = setInterval(() => {
      void this.saveCheckpoint(mission.id, getBudget()).catch(err =>
        log.warn("checkpoint failed", { missionId: mission.id, err }),
      )
    }, config.MISSION_CHECKPOINT_INTERVAL_MS)
    this.timers.set(mission.id, timer)
    log.info("checkpoint monitoring started", { missionId: mission.id })
  }

  /**
   * Stops the checkpoint interval for a mission.
   */
  stopCheckpointing(missionId: string): void {
    const timer = this.timers.get(missionId)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(missionId)
    }
    this.lastProgress.delete(missionId)
  }

  /**
   * Marks that a task completed (resets dead man's switch).
   */
  recordProgress(missionId: string): void {
    this.lastProgress.set(missionId, Date.now())
  }

  /**
   * Returns when the last progress was recorded for dead man's switch checks.
   */
  getLastProgressMs(missionId: string): number {
    return this.lastProgress.get(missionId) ?? Date.now()
  }

  /** Saves a checkpoint to the database. */
  private async saveCheckpoint(missionId: string, getBudget: () => MissionBudget): Promise<void> {
    const budget = getBudget()
    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
      select: { dag: true },
    })
    if (!mission) return

    const dag = mission.dag as Array<{ id: string; status: string }>
    const completedTaskIds = dag.filter(t => t.status === "done").map(t => t.id)

    await prisma.missionCheckpoint.create({
      data: {
        missionId,
        progress: {
          completedTaskIds,
          tokensUsed: budget.tokensUsed,
          apiCallsUsed: budget.apiCallsUsed,
          savedAt: new Date().toISOString(),
        },
      },
    })
    log.debug("checkpoint saved", { missionId, completedTasks: completedTaskIds.length })
  }
}

export const missionMonitor = new MissionMonitor()
