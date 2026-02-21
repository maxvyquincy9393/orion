# Phase G — Multi-Agent Combat Assist: Autonomous Coordination

## Papers
**[1] ALAS: Adaptive LLM Agent Scheduler**
arXiv: 2505.12501 | May 2025 | Three-layer agent architecture

**[2] The Orchestration of Multi-Agent Systems: MCP + A2A**
arXiv: 2601.13671 | Jan 2026 | Formal MCP/A2A framework

**[3] Evolution of Agentic AI in Cybersecurity**
arXiv: 2512.06659 | Dec 2025 | Five-generation taxonomy

## Core Idea dari Papers
Orion sekarang punya `AgentRunner` yang bisa single/parallel/sequential/supervisor.
Tapi ini basic — tidak ada persistent task state, tidak ada retry dengan different approach,
tidak ada true agent specialization.

ALAS three-layer model:
1. Meta-planner: decompose goal ke workflow template (nodes + edges dengan dependencies)
2. Agent Factory: instantiate specialized agents per node
3. Runtime Monitor: handle failures, retry, escalate

Untuk Orion, translate ini ke:
1. TaskPlanner: buat DAG (directed acyclic graph) dari task dependencies
2. SpecializedAgents: agents dengan prompt/tool set berbeda (researcher, coder, writer, analyst)
3. ExecutionMonitor: track state, handle failures, decide retry vs escalate

"Combat Assist" dalam konteks Orion = kemampuan mengambil aksi autonomous yang complex:
- Research + Summarize + Write = multi-agent pipeline
- Debug + Fix + Test = sequential agents dengan feedback loop
- Monitor + Alert + Respond = background autonomous loop

## Gap di Orion Sekarang
`agents/runner.ts` → supervisor hanya break goal ke parallel subtasks.
Tidak ada task dependencies (DAG).
Tidak ada specialized agents dengan different tools/prompts.
Tidak ada state persistence between agent calls.

## Prompt untuk AI Coding Assistant

```
Kamu sedang memodifikasi Orion-TS. Implementasi true multi-agent coordination.
Paper referensi: arXiv 2505.12501, 2601.13671

### TASK: Phase G — Multi-Agent System

Target files:
- `src/agents/task-planner.ts` (file baru)
- `src/agents/specialized-agents.ts` (file baru)
- `src/agents/execution-monitor.ts` (file baru)
- `src/agents/runner.ts` (upgrade runWithSupervisor)

#### Step 1: Buat src/agents/task-planner.ts

DAG-based task planning.

```typescript
import { orchestrator } from "../engines/orchestrator.js"
import { createLogger } from "../logger.js"

const log = createLogger("agents.task-planner")

export interface TaskNode {
  id: string
  task: string
  agentType: AgentType
  dependsOn: string[]       // IDs dari tasks yang harus selesai dulu
  context?: string          // context tambahan
  maxRetries: number
}

export type AgentType = "researcher" | "coder" | "writer" | "analyst" | "executor" | "reviewer"

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
      const nodes: TaskNode[] = JSON.parse(cleaned)

      if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error("invalid plan structure")
      }

      // Validate no circular dependencies
      this.validateDAG(nodes)

      log.info("task plan created", { goal: goal.slice(0, 50), nodes: nodes.length })
      return { nodes, rootGoal: goal }
    } catch (error) {
      log.warn("planning failed, using single task fallback", error)
      return {
        rootGoal: goal,
        nodes: [{
          id: "t1",
          task: goal,
          agentType: "analyst",
          dependsOn: [],
          maxRetries: 2,
        }],
      }
    }
  }

  private validateDAG(nodes: TaskNode[]): void {
    const ids = new Set(nodes.map(n => n.id))
    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        if (!ids.has(dep)) {
          throw new Error(`Invalid dependency: ${dep} not found`)
        }
      }
    }
  }

  // Topological sort: return execution order respecting dependencies
  getExecutionOrder(dag: TaskDAG): TaskNode[][] {
    const remaining = new Set(dag.nodes.map(n => n.id))
    const completed = new Set<string>()
    const waves: TaskNode[][] = []

    while (remaining.size > 0) {
      const wave = dag.nodes.filter(n =>
        remaining.has(n.id) &&
        n.dependsOn.every(dep => completed.has(dep))
      )

      if (wave.length === 0) {
        log.error("Circular dependency detected in task DAG")
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
```

#### Step 2: Buat src/agents/specialized-agents.ts

Setiap agent type punya system prompt berbeda dan tool set berbeda.

```typescript
import { orchestrator } from "../engines/orchestrator.js"
import type { AgentType } from "./task-planner.js"

export interface AgentConfig {
  systemPrompt: string
  preferredTaskType: "reasoning" | "code" | "fast"
  maxTokenHint: number
}

const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  researcher: {
    systemPrompt: "You are a research specialist. Your job is to gather, synthesize, and summarize information accurately. Always cite what you know vs what you infer. Be comprehensive but concise.",
    preferredTaskType: "reasoning",
    maxTokenHint: 1500,
  },
  coder: {
    systemPrompt: "You are a senior software engineer. Write clean, working code. Always include error handling. If fixing a bug, explain what was wrong. Output only the code + brief explanation, no filler.",
    preferredTaskType: "code",
    maxTokenHint: 2000,
  },
  writer: {
    systemPrompt: "You are a skilled writer. Write clear, engaging content. Match the required tone and format. Be direct. No unnecessary padding.",
    preferredTaskType: "fast",
    maxTokenHint: 1500,
  },
  analyst: {
    systemPrompt: "You are an analytical thinker. Break down problems, compare options, identify patterns. Be objective. Show your reasoning. Conclude with clear recommendations.",
    preferredTaskType: "reasoning",
    maxTokenHint: 1500,
  },
  executor: {
    systemPrompt: "You are a task executor. Your role is to plan and describe concrete action steps. Be precise about what needs to be done, in what order, and what success looks like.",
    preferredTaskType: "fast",
    maxTokenHint: 1000,
  },
  reviewer: {
    systemPrompt: "You are a quality reviewer. Check the work done for accuracy, completeness, and quality. Be specific about issues found. Rate quality 1-10. Suggest improvements.",
    preferredTaskType: "fast",
    maxTokenHint: 800,
  },
}

export async function runSpecializedAgent(
  agentType: AgentType,
  task: string,
  context?: string
): Promise<string> {
  const config = AGENT_CONFIGS[agentType]
  const fullPrompt = context
    ? `${config.systemPrompt}\n\nContext from previous tasks:\n${context}\n\nYour task: ${task}`
    : `${config.systemPrompt}\n\nYour task: ${task}`

  return orchestrator.generate(config.preferredTaskType, { prompt: fullPrompt })
}
```

#### Step 3: Buat src/agents/execution-monitor.ts

Track state, handle failures, retry dengan different approach.

```typescript
import { createLogger } from "../logger.js"
import type { TaskNode } from "./task-planner.js"
import { runSpecializedAgent } from "./specialized-agents.js"

const log = createLogger("agents.execution-monitor")

export interface TaskResult {
  nodeId: string
  success: boolean
  output: string
  attempts: number
  errorHistory: string[]
}

export class ExecutionMonitor {
  async executeNode(
    node: TaskNode,
    completedResults: Map<string, TaskResult>
  ): Promise<TaskResult> {
    // Build context dari dependencies
    const depContext = node.dependsOn
      .map(depId => {
        const result = completedResults.get(depId)
        return result?.success
          ? `[Result of ${depId}]: ${result.output.slice(0, 500)}`
          : null
      })
      .filter(Boolean)
      .join("\n\n")

    let attempts = 0
    const errorHistory: string[] = []

    while (attempts < node.maxRetries + 1) {
      attempts++
      try {
        const context = attempts > 1
          ? `${depContext}\n\nPrevious attempt failed: ${errorHistory[errorHistory.length - 1]}\nTry a different approach.`
          : depContext || undefined

        const output = await runSpecializedAgent(node.agentType, node.task, context || undefined)

        log.info("node completed", { nodeId: node.id, attempts, outputLength: output.length })
        return { nodeId: node.id, success: true, output, attempts, errorHistory }
      } catch (error) {
        const errMsg = String(error)
        errorHistory.push(errMsg)
        log.warn("node attempt failed", { nodeId: node.id, attempt: attempts, error: errMsg })

        if (attempts >= node.maxRetries + 1) {
          log.error("node exhausted retries", { nodeId: node.id })
          return {
            nodeId: node.id,
            success: false,
            output: `Task failed after ${attempts} attempts. Last error: ${errMsg}`,
            attempts,
            errorHistory,
          }
        }
      }
    }

    // Should never reach here
    return { nodeId: node.id, success: false, output: "", attempts, errorHistory }
  }
}

export const executionMonitor = new ExecutionMonitor()
```

#### Step 4: Upgrade agents/runner.ts — runWithSupervisor
Ganti implementasi yang ada:

```typescript
import { taskPlanner } from "./task-planner.js"
import { executionMonitor } from "./execution-monitor.js"

async runWithSupervisor(goal: string, maxSubtasks = 8): Promise<string> {
  log.info("supervisor starting", { goal: goal.slice(0, 80) })

  const dag = await taskPlanner.plan(goal)
  const executionWaves = taskPlanner.getExecutionOrder(dag)
  const completedResults = new Map<string, TaskResult>()

  // Execute wave by wave
  // Tasks dalam satu wave bisa parallel (no dependencies between them)
  for (const wave of executionWaves) {
    log.info("executing wave", { tasks: wave.map(n => n.id) })

    const waveResults = await Promise.all(
      wave.map(node => executionMonitor.executeNode(node, completedResults))
    )

    for (const result of waveResults) {
      completedResults.set(result.nodeId, result)
    }
  }

  // Synthesize all results
  const successfulOutputs = Array.from(completedResults.values())
    .filter(r => r.success)
    .map(r => r.output)
    .join("\n\n---\n\n")

  const synthesisPrompt = `Synthesize these task results into one coherent response for this goal.
Goal: ${goal}
Results: ${successfulOutputs.slice(0, 4000)}

Provide a clear, unified answer.`

  return orchestrator.generate("reasoning", { prompt: synthesisPrompt })
}
```

### Constraints
- DAG execution harus handle circular dep gracefully (log + fallback)
- Semua node results harus disimpan untuk context chaining
- Maximum total execution time: beri timeout 120 detik per supervisor call
- Zero TypeScript errors
- Jangan break existing runSingle/runParallel/runSequential methods
```

## Cara Test
```bash
pnpm dev --mode text
# Test supervisor:
# Input: "Analisa kelebihan dan kekurangan TypeScript vs Go untuk backend API,
#         kemudian rekomendasikan mana yang lebih baik untuk proyek startup"
# Harusnya: DAG plan dengan researcher + analyst + writer nodes
# Check log untuk melihat wave execution
```

## Expected Outcome
Complex tasks dipecah menjadi specialized sub-tasks yang berjalan parallel where possible.
Failed sub-tasks di-retry dengan different approach sebelum menyerah.
Context dari task sebelumnya mengalir ke task berikutnya otomatis.
Foundation untuk full autonomous pipeline (monitor + alert + respond loops).
