/**
 * @file safety-guardrails.ts
 * @description Hard budget limits and sensitive-action gating for mission execution.
 *
 * ARCHITECTURE:
 *   Called before every task execution step. Acts as a circuit breaker:
 *   - Enforces token, API call, and time budgets (hard caps — never exceed)
 *   - Gates sensitive actions (file delete, git push, email send, etc.)
 *     by queuing them for user approval and pausing execution
 *   - Implements the dead man's switch (stop if no progress)
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import config from "../config.js"
import { SENSITIVE_ACTIONS } from "./mission-schema.js"
import type { Mission, MissionBudget, ApprovalRequest } from "./mission-schema.js"

const log = createLogger("mission.safety-guardrails")

/** Thrown when a hard budget limit is exceeded. Non-recoverable. */
export class BudgetExceededError extends Error {
  constructor(
    public readonly limitType: "tokens" | "api_calls" | "time",
    message: string,
  ) {
    super(message)
    this.name = "BudgetExceededError"
  }
}

/** Thrown when a sensitive action is pending approval. Recoverable. */
export class PendingApprovalError extends Error {
  constructor(public readonly approvalId: string) {
    super(`Action pending approval: ${approvalId}`)
    this.name = "PendingApprovalError"
  }
}

/**
 * Enforces hard limits and gates sensitive actions for mission execution.
 */
export class SafetyGuardrails {
  /**
   * Checks all budget limits. Throws BudgetExceededError if any cap is reached.
   *
   * @param budget - Current mission budget state
   */
  checkBudgets(budget: MissionBudget): void {
    if (budget.tokensUsed >= budget.tokensBudget) {
      throw new BudgetExceededError("tokens", `Token budget exhausted: ${budget.tokensUsed}/${budget.tokensBudget}`)
    }
    if (budget.apiCallsUsed >= budget.apiCallBudget) {
      throw new BudgetExceededError("api_calls", `API call budget exhausted: ${budget.apiCallsUsed}/${budget.apiCallBudget}`)
    }
    if (budget.startedAtMs > 0) {
      const elapsed = Date.now() - budget.startedAtMs
      if (elapsed >= budget.timeBudgetMs) {
        throw new BudgetExceededError("time", `Time budget exhausted: ${elapsed}ms / ${budget.timeBudgetMs}ms`)
      }
    }
  }

  /**
   * Checks whether an action requires approval. If so, persists the approval
   * request and throws PendingApprovalError to pause execution.
   *
   * @param mission - Current mission
   * @param taskId - ID of the task requesting the action
   * @param actionName - Action identifier (e.g. "file_delete")
   * @param reason - Human-readable explanation
   */
  async gateAction(
    mission: Mission,
    taskId: string,
    actionName: string,
    reason: string,
  ): Promise<void> {
    if (!SENSITIVE_ACTIONS.includes(actionName)) return

    // Check if already approved.
    const existing = await prisma.missionApproval.findFirst({
      where: {
        missionId: mission.id,
        taskId,
        action: actionName,
        status: "approved",
      },
    })
    if (existing) {
      log.debug("action already approved", { missionId: mission.id, taskId, actionName })
      return
    }

    // Queue for user approval.
    const row = await prisma.missionApproval.create({
      data: {
        missionId: mission.id,
        taskId,
        action: actionName,
        reason,
        status: "pending",
      },
    })
    log.warn("sensitive action gated, awaiting approval", { missionId: mission.id, taskId, actionName, approvalId: row.id })
    throw new PendingApprovalError(row.id)
  }

  /**
   * Checks the dead man's switch: if no task completed within the threshold,
   * throws a BudgetExceededError to halt the mission.
   *
   * @param lastProgressMs - Epoch ms of the last completed task
   */
  checkDeadManSwitch(lastProgressMs: number): void {
    const idle = Date.now() - lastProgressMs
    if (idle > config.MISSION_DEAD_MAN_SWITCH_MS) {
      throw new BudgetExceededError(
        "time",
        `Dead man's switch triggered: no progress for ${Math.round(idle / 60_000)} minutes`,
      )
    }
  }
}

export const safetyGuardrails = new SafetyGuardrails()
