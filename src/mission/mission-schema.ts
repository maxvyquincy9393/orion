/**
 * @file mission-schema.ts
 * @description Type definitions for Phase 22 Autonomous Mission Mode.
 *
 * ARCHITECTURE:
 *   Shared types used by mission-planner.ts, mission-executor.ts,
 *   mission-monitor.ts, safety-guardrails.ts, and mission-reporter.ts.
 */

/** Mission lifecycle state machine. */
export type MissionStatus =
  | "planning"
  | "reviewing"
  | "executing"
  | "checkpointing"
  | "recovering"
  | "winding_down"
  | "reporting"
  | "delivered"
  | "cancelled"

/** A single node in the mission DAG (task graph). */
export interface MissionTask {
  id: string
  description: string
  /** IDs of tasks that must complete before this one. */
  dependsOn: string[]
  /** Whether this task can run in parallel with siblings at the same depth. */
  parallel: boolean
  status: "pending" | "running" | "done" | "failed" | "skipped"
  result?: string
  error?: string
  startedAt?: string
  completedAt?: string
}

/** Hard resource and time budgets. When any is exceeded the mission stops. */
export interface MissionBudget {
  tokensBudget: number
  tokensUsed: number
  apiCallBudget: number
  apiCallsUsed: number
  /** Milliseconds */
  timeBudgetMs: number
  startedAtMs: number
}

/** A sensitive action requiring user approval before execution. */
export interface ApprovalRequest {
  id: string
  missionId: string
  taskId: string
  action: string
  reason: string
  status: "pending" | "approved" | "rejected"
  createdAt: Date
  resolvedAt?: Date
}

/** Full mission structure. */
export interface Mission {
  id: string
  userId: string
  title: string
  goal: string
  status: MissionStatus
  dag: MissionTask[]
  budget: MissionBudget
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}

/** Snapshot of mission progress at a checkpoint. */
export interface MissionCheckpointData {
  missionId: string
  completedTaskIds: string[]
  tokensUsed: number
  apiCallsUsed: number
  savedAt: Date
}

/** Final mission report delivered to the user. */
export interface MissionReport {
  missionId: string
  title: string
  goal: string
  status: MissionStatus
  summary: string
  completedTasks: string[]
  failedTasks: string[]
  tokensUsed: number
  apiCallsUsed: number
  elapsedMs: number
  deliveredAt: Date
}

/** Actions that require explicit user approval before execution. */
export const SENSITIVE_ACTIONS: readonly string[] = [
  "file_delete",
  "git_push",
  "email_send",
  "deploy",
  "database_drop",
  "payment",
]
