import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("agents.task-planner")

export type AgentType =
  | "researcher"
  | "coder"
  | "writer"
  | "analyst"
  | "executor"
  | "reviewer"

export interface TaskNode {
  id: string
  task: string
  agentType: AgentType
  dependsOn: string[]
  context?: string
  maxRetries: number
}

export interface TaskDAG {
  nodes: TaskNode[]
  rootGoal: string
}

const PLANNER_PROMPT = `Decompose this goal into a DAG of specialized tasks.
Each task must specify:
- id: unique string
- task: what to do (one clear action)
- agentType: one of [researcher, coder, writer, analyst, executor, reviewer]
- dependsOn: array of task IDs that must complete first (empty array for independent tasks)
- maxRetries: 1 or 2

Rules:
- Maximum 8 nodes
- researcher: gather information, search, summarize sources
- coder: write/debug/fix code
- writer: write prose, docs, emails
- analyst: analyze data, compare options, evaluate
- executor: run commands, use tools
- reviewer: check quality, validate output

Goal: "{goal}"

Return ONLY valid JSON array:
[
  {"id":"t1","task":"...","agentType":"researcher","dependsOn":[],"maxRetries":1},
  {"id":"t2","task":"...","agentType":"analyst","dependsOn":["t1"],"maxRetries":2}
]`

export class TaskPlanner {
  async plan(goal: string): Promise<TaskDAG> {
    try {
      const prompt = PLANNER_PROMPT.replace("{goal}", goal.slice(0, 500))
      const raw = await orchestrator.generate("reasoning", { prompt })
      const cleaned = raw.replace(/```json|```/g, "").trim()
      const parsed = JSON.parse(cleaned) as unknown
      const nodes = this.normalizeNodes(parsed)

      this.validateDAG(nodes)

      log.info("task plan created", { goal: goal.slice(0, 50), nodes: nodes.length })
      return { nodes, rootGoal: goal }
    } catch (error) {
      log.warn("planning failed, using single task fallback", { error: String(error) })
      return {
        rootGoal: goal,
        nodes: [
          {
            id: "t1",
            task: goal,
            agentType: "analyst",
            dependsOn: [],
            maxRetries: 2,
          },
        ],
      }
    }
  }

  private normalizeNodes(rawNodes: unknown): TaskNode[] {
    if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
      throw new Error("invalid plan structure")
    }

    return rawNodes.slice(0, 8).map((rawNode, index) => {
      if (!rawNode || typeof rawNode !== "object") {
        throw new Error("invalid node structure")
      }

      const node = rawNode as Record<string, unknown>
      const id = this.readString(node.id, `t${index + 1}`)
      const task = this.readString(node.task)
      const agentType = this.readAgentType(node.agentType)
      const dependsOn = Array.isArray(node.dependsOn)
        ? node.dependsOn
            .filter((dep): dep is string => typeof dep === "string")
            .map((dep) => dep.trim())
            .filter((dep) => dep.length > 0)
        : []
      const context = this.readOptionalString(node.context)
      const maxRetries = node.maxRetries === 2 ? 2 : 1

      return {
        id,
        task,
        agentType,
        dependsOn,
        context,
        maxRetries,
      }
    })
  }

  private readString(value: unknown, fallback?: string): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }

    if (fallback) {
      return fallback
    }

    throw new Error("invalid string value")
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  private readAgentType(value: unknown): AgentType {
    if (value === "researcher") {
      return value
    }
    if (value === "coder") {
      return value
    }
    if (value === "writer") {
      return value
    }
    if (value === "analyst") {
      return value
    }
    if (value === "executor") {
      return value
    }
    if (value === "reviewer") {
      return value
    }

    throw new Error("invalid agentType")
  }

  private validateDAG(nodes: TaskNode[]): void {
    const ids = new Set<string>()

    for (const node of nodes) {
      if (ids.has(node.id)) {
        throw new Error(`Duplicate node id: ${node.id}`)
      }
      ids.add(node.id)
    }

    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        if (!ids.has(dep)) {
          throw new Error(`Invalid dependency: ${dep} not found`)
        }
        if (dep === node.id) {
          throw new Error(`Invalid dependency: ${node.id} depends on itself`)
        }
      }
    }

    if (this.hasCycle(nodes)) {
      throw new Error("Circular dependency detected")
    }
  }

  private hasCycle(nodes: TaskNode[]): boolean {
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const visited = new Set<string>()
    const activePath = new Set<string>()

    const visit = (nodeId: string): boolean => {
      if (activePath.has(nodeId)) {
        return true
      }
      if (visited.has(nodeId)) {
        return false
      }

      visited.add(nodeId)
      activePath.add(nodeId)
      const node = nodeById.get(nodeId)

      if (node) {
        for (const depId of node.dependsOn) {
          if (visit(depId)) {
            return true
          }
        }
      }

      activePath.delete(nodeId)
      return false
    }

    for (const node of nodes) {
      if (visit(node.id)) {
        return true
      }
    }

    return false
  }

  getExecutionOrder(dag: TaskDAG): TaskNode[][] {
    const remaining = new Set(dag.nodes.map((node) => node.id))
    const completed = new Set<string>()
    const waves: TaskNode[][] = []

    while (remaining.size > 0) {
      const wave = dag.nodes.filter(
        (node) => remaining.has(node.id) && node.dependsOn.every((dep) => completed.has(dep)),
      )

      if (wave.length === 0) {
        const unresolved = dag.nodes.filter((node) => remaining.has(node.id))
        log.warn("circular dependency detected in task DAG, running unresolved as fallback", {
          nodes: unresolved.map((node) => node.id),
        })
        waves.push(unresolved)
        break
      }

      waves.push(wave)
      for (const node of wave) {
        remaining.delete(node.id)
        completed.add(node.id)
      }
    }

    return waves
  }
}

export const taskPlanner = new TaskPlanner()
