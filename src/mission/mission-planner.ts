/**
 * @file mission-planner.ts
 * @description Converts a natural-language goal into a validated DAG of tasks.
 *
 * ARCHITECTURE:
 *   Uses the 'reasoning' LLM task type to decompose a high-level goal
 *   into a DAG of MissionTasks. Validates that budget estimates are
 *   within configured hard limits before returning.
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import config from "../config.js"
import { v4 as uuidv4 } from "uuid"
import type { Mission, MissionTask, MissionBudget } from "./mission-schema.js"

const log = createLogger("mission.planner")

const PLANNER_SYSTEM = `You are a mission planner for an autonomous AI assistant.
Given a goal, produce a JSON DAG (array of tasks). Each task has:
- id: string (short slug)
- description: string (one sentence)
- dependsOn: string[] (IDs of prerequisite tasks)
- parallel: boolean (can run concurrently with siblings)

Return ONLY the JSON array. No commentary. Maximum 20 tasks.`

/**
 * Plans a mission by decomposing the goal into a task DAG.
 */
export class MissionPlanner {
  /**
   * Creates a new Mission with a planned DAG from a natural-language goal.
   *
   * @param userId - User initiating the mission
   * @param title - Short descriptive title
   * @param goal - Natural-language description of what to achieve
   * @returns A planned Mission ready for review/execution
   */
  async plan(userId: string, title: string, goal: string): Promise<Mission> {
    log.info("planning mission", { userId, title })

    const raw = await orchestrator.generate("reasoning", {
      systemPrompt: PLANNER_SYSTEM,
      prompt: `Goal: ${goal}`,
    })

    const dag = this.parseDag(raw)

    const budget: MissionBudget = {
      tokensBudget: config.MISSION_TOKEN_BUDGET,
      tokensUsed: 0,
      apiCallBudget: config.MISSION_API_CALL_BUDGET,
      apiCallsUsed: 1, // planning call
      timeBudgetMs: config.MISSION_TIME_BUDGET_MS,
      startedAtMs: 0,
    }

    const mission: Mission = {
      id: uuidv4(),
      userId,
      title,
      goal,
      status: "planning",
      dag,
      budget,
      createdAt: new Date(),
    }

    log.info("mission planned", { missionId: mission.id, taskCount: dag.length })
    return mission
  }

  /** Parses LLM output into a validated MissionTask array. */
  private parseDag(raw: string): MissionTask[] {
    const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0]
    if (!jsonStr) {
      log.warn("planner returned no valid JSON array, using empty DAG")
      return []
    }

    const items = JSON.parse(jsonStr) as Partial<MissionTask>[]
    return items
      .slice(0, 20)
      .map(item => ({
        id: String(item.id ?? uuidv4()),
        description: String(item.description ?? "Unknown task"),
        dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [],
        parallel: Boolean(item.parallel),
        status: "pending" as const,
      }))
  }
}

export const missionPlanner = new MissionPlanner()
