import { createLogger } from "../logger.js"

const logger = createLogger("permissions.task-scope")

export type TaskScopeType = "conversation" | "research" | "coding" | "system"

export interface TaskScope {
  taskType: TaskScopeType
  allowedTools: string[]
  requiresExplicitApproval: boolean
  reason: string
}

export interface ScopedToolsResult {
  tools: Record<string, unknown>
  blockedTools: string[]
  approvalRequired: boolean
}

const TASK_SCOPES: Record<TaskScopeType, TaskScope> = {
  conversation: {
    taskType: "conversation",
    allowedTools: ["searchTool", "memoryQueryTool", "fileReadTool"],
    requiresExplicitApproval: false,
    reason: "General chat only needs read-only, low-risk tools.",
  },
  research: {
    taskType: "research",
    allowedTools: ["searchTool", "memoryQueryTool", "fileReadTool", "fileListTool"],
    requiresExplicitApproval: false,
    reason: "Research can browse and inspect files without mutating state.",
  },
  coding: {
    taskType: "coding",
    allowedTools: ["searchTool", "fileReadTool", "fileWriteTool", "fileListTool", "terminalTool"],
    requiresExplicitApproval: false,
    reason: "Coding requires read/write and terminal execution.",
  },
  system: {
    taskType: "system",
    allowedTools: [
      "searchTool",
      "memoryQueryTool",
      "fileReadTool",
      "fileWriteTool",
      "fileListTool",
      "terminalTool",
      "calendarTool",
    ],
    requiresExplicitApproval: true,
    reason: "System-level requests require explicit approval before using broad tool access.",
  },
}

const TASK_PATTERNS: Array<{ type: TaskScopeType; patterns: RegExp[] }> = [
  {
    type: "system",
    patterns: [
      /\b(root|sudo|administrator|admin)\b/i,
      /\b(deploy|provision|infrastructure|ops|permissions?)\b/i,
      /\b(restart|shutdown|reboot|daemon|service)\b/i,
      /\b(security policy|access control|credential|token)\b/i,
    ],
  },
  {
    type: "coding",
    patterns: [
      /\b(code|coding|typescript|javascript|python|bug|fix|refactor)\b/i,
      /\b(compile|build|test|unit test|integration test|lint)\b/i,
      /\b(file|repository|repo|module|function|class|api)\b/i,
      /\b(command|terminal|script)\b/i,
    ],
  },
  {
    type: "research",
    patterns: [
      /\b(research|investigate|analyze|compare|evaluate)\b/i,
      /\b(latest|news|trend|paper|citation|source)\b/i,
      /\b(search|browse|look up|find information)\b/i,
    ],
  },
]

export function inferTaskType(userMessage: string): TaskScopeType {
  const normalized = userMessage.trim()
  if (!normalized) {
    return "conversation"
  }

  for (const candidate of TASK_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
      return candidate.type
    }
  }

  return "conversation"
}

export function getScopeForTask(taskType: TaskScopeType): TaskScope {
  return { ...TASK_SCOPES[taskType], allowedTools: [...TASK_SCOPES[taskType].allowedTools] }
}

export function isToolAllowed(scope: TaskScope, toolName: string): boolean {
  return scope.allowedTools.includes(toolName)
}

export function applyTaskScope(
  tools: Record<string, unknown>,
  scope: TaskScope,
  options?: { explicitApproval?: boolean; actorId?: string },
): ScopedToolsResult {
  const actorId = options?.actorId ?? "unknown"
  const explicitApproval = options?.explicitApproval ?? process.env.ORION_SYSTEM_TOOL_APPROVED === "true"

  if (scope.requiresExplicitApproval && !explicitApproval) {
    logger.warn("Scope requires explicit approval; tools disabled", {
      actorId,
      taskType: scope.taskType,
      reason: scope.reason,
    })
    return {
      tools: {},
      blockedTools: Object.keys(tools),
      approvalRequired: true,
    }
  }

  const allowedTools: Record<string, unknown> = {}
  const blockedTools: string[] = []

  for (const [toolName, toolDef] of Object.entries(tools)) {
    if (isToolAllowed(scope, toolName)) {
      allowedTools[toolName] = toolDef
      continue
    }
    blockedTools.push(toolName)
  }

  if (blockedTools.length > 0) {
    logger.info("Tool scope applied", {
      actorId,
      taskType: scope.taskType,
      allowedTools: Object.keys(allowedTools),
      blockedTools,
    })
  }

  return {
    tools: allowedTools,
    blockedTools,
    approvalRequired: false,
  }
}
