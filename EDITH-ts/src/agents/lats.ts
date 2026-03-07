/**
 * lats.ts — Language Agent Tree Search
 *
 * Implements the LATS framework from:
 *   Zhou et al., "Language Agent Tree Search Unifies Reasoning Acting and
 *   Planning in Language Models" (ICML 2024, arXiv:2310.04406)
 *
 * LATS unifies three key capabilities:
 *   1. Reasoning (chain of thought per action)
 *   2. Acting (tool use / environment interaction)
 *   3. Planning (Monte Carlo Tree Search over action sequences)
 *
 * The agent treats action selection as a tree search problem:
 *   - Each node = (state, action history, observations)
 *   - Expansion = LLM proposes K candidate actions
 *   - Simulation = LLM evaluates the outcome of each action
 *   - Backpropagation = update parent nodes with child scores
 *   - Selection = UCB1 (Upper Confidence Bound) to balance explore vs exploit
 *
 * This is the most sophisticated reasoning strategy — use it for complex
 * multi-step tasks where individual actions have high uncertainty.
 *
 * Integration: called by AgentRunner when task complexity exceeds a threshold,
 * or explicitly via ACP message.
 *
 * @module agents/lats
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import config from "../config.js"

const log = createLogger("agents.lats")

// ── Configuration ────────────────────────────────────────────────────────────

/** Number of MCTS iterations */
const DEFAULT_ITERATIONS = 4

/** UCB1 exploration constant (√2 is theoretical optimum) */
const UCB_C = Math.SQRT2

/** Number of candidate actions per expansion */
const DEFAULT_EXPANSION_WIDTH = 3

/** Maximum depth of the search tree */
const DEFAULT_MAX_DEPTH = 4
const DEFAULT_EARLY_STOP_THRESHOLD = Math.min(1, Math.max(0, config.LATS_EARLY_STOP_THRESHOLD))

/** Discount factor for value backpropagation */
const GAMMA = 0.95

// ── Types ────────────────────────────────────────────────────────────────────

export interface LATSAction {
  /** Natural language description of the action */
  description: string
  /** Reasoning behind choosing this action */
  reasoning: string
  /** Simulated observation / outcome */
  observation: string
  /** Value estimate from simulation (0–1) */
  value: number
}

export interface LATSNode {
  id: string
  depth: number
  action: LATSAction | null
  /** State summary after this action */
  state: string
  /** Cumulative value (backpropagated) */
  totalValue: number
  /** Visit count */
  visits: number
  /** Parent node */
  parent: LATSNode | null
  /** Child nodes */
  children: LATSNode[]
}

export interface LATSResult {
  /** Best action sequence found */
  bestActions: LATSAction[]
  /** Final synthesized answer */
  answer: string
  /** Total MCTS iterations */
  iterations: number
  /** Iterations actually used (can be < iterations when early-terminated). */
  iterationsUsed: number
  /** Total nodes in tree */
  totalNodes: number
  /** Total LLM calls */
  llmCalls: number
  /** Best path value */
  bestValue: number
  /** Whether search stopped early due threshold. */
  terminatedEarly: boolean
  /** Configured early stop threshold for this run. */
  earlyStopThreshold: number
}

export interface LATSOptions {
  /** Number of MCTS iterations */
  iterations?: number
  /** Candidate actions per expansion */
  expansionWidth?: number
  /** Max tree depth */
  maxDepth?: number
  /** Available tools/actions the agent can take */
  availableActions?: string[]
  /** Stop search early if best value reaches threshold (0-1). */
  earlyStopThreshold?: number
}

// ── MCTS Components ─────────────────────────────────────────────────────────

/**
 * UCB1 selection: pick the child that maximizes
 *   Q(child) / N(child) + C * sqrt(ln(N(parent)) / N(child))
 */
function selectUCB1(node: LATSNode): LATSNode {
  if (node.children.length === 0) return node

  const logParentVisits = Math.log(node.visits + 1)

  let bestChild = node.children[0]
  let bestUCB = -Infinity

  for (const child of node.children) {
    if (child.visits === 0) {
      // Unexplored nodes get infinite priority
      return child
    }

    const exploitation = child.totalValue / child.visits
    const exploration = UCB_C * Math.sqrt(logParentVisits / child.visits)
    const ucb = exploitation + exploration

    if (ucb > bestUCB) {
      bestUCB = ucb
      bestChild = child
    }
  }

  return bestChild
}

/**
 * Selection phase: walk down the tree using UCB1 until reaching a leaf.
 */
function selectLeaf(root: LATSNode): LATSNode {
  let current = root
  while (current.children.length > 0) {
    current = selectUCB1(current)
  }
  return current
}

/**
 * Backpropagation: update visit counts and values from leaf to root.
 */
function backpropagate(leaf: LATSNode, value: number): void {
  let current: LATSNode | null = leaf
  let discountedValue = value

  while (current !== null) {
    current.visits++
    current.totalValue += discountedValue
    discountedValue *= GAMMA
    current = current.parent
  }
}

// ── LLM-Powered Expansion & Simulation ──────────────────────────────────────

const EXPAND_PROMPT = `You are an expert planner solving a task step by step. Given the current state, propose {k} distinct next actions.

Task:
"""
{task}
"""

Current state & action history:
{stateHistory}

{actionsBlock}

Propose {k} candidate next actions. Each must include:
1. A clear action description
2. Your reasoning for why this action helps

Return ONLY valid JSON:
[
  { "description": "action 1", "reasoning": "why this helps" },
  { "description": "action 2", "reasoning": "why this helps" }
]`

async function expandNode(
  task: string,
  node: LATSNode,
  k: number,
  availableActions: string[] | undefined,
  llmCallCounter: { count: number },
): Promise<LATSAction[]> {
  const stateHistory = buildStateHistory(node)
  const actionsBlock = availableActions
    ? `Available actions: ${availableActions.join(", ")}`
    : ""

  const prompt = EXPAND_PROMPT
    .replace(/\{k\}/g, String(k))
    .replace("{task}", task.slice(0, 1500))
    .replace("{stateHistory}", stateHistory.slice(0, 2000))
    .replace("{actionsBlock}", actionsBlock)

  llmCallCounter.count++

  try {
    const raw = await orchestrator.generate("reasoning", { prompt, temperature: 0.7 })
    const parsed = parseActionArray(raw, k)
    return parsed
  } catch {
    return [{ description: "Continue with generic approach", reasoning: "Fallback", observation: "", value: 0.3 }]
  }
}

const SIMULATE_PROMPT = `Simulate the outcome of an action in a problem-solving process.

Task:
"""
{task}
"""

Current state:
{state}

Action taken:
{action}

Reasoning:
{reasoning}

Simulate what would happen after this action. Return ONLY valid JSON:
{
  "observation": "what would be observed after this action",
  "value": 0.0-1.0,
  "newState": "summary of the state after this action"
}`

async function simulateAction(
  task: string,
  state: string,
  action: LATSAction,
  llmCallCounter: { count: number },
): Promise<{ observation: string; value: number; newState: string }> {
  const prompt = SIMULATE_PROMPT
    .replace("{task}", task.slice(0, 1500))
    .replace("{state}", state.slice(0, 1500))
    .replace("{action}", action.description.slice(0, 500))
    .replace("{reasoning}", action.reasoning.slice(0, 500))

  llmCallCounter.count++

  try {
    const raw = await orchestrator.generate("fast", { prompt, temperature: 0.2 })
    const json = extractJson<{ observation?: string; value?: number; newState?: string }>(raw)
    return {
      observation: String(json.observation ?? ""),
      value: clamp(Number(json.value ?? 0.5)),
      newState: String(json.newState ?? state),
    }
  } catch {
    return { observation: "Simulation unavailable", value: 0.5, newState: state }
  }
}

// ── Main MCTS Loop ──────────────────────────────────────────────────────────

/**
 * Execute LATS (Language Agent Tree Search) on a task.
 *
 * @param task    - The problem to solve
 * @param options - Search configuration
 */
export async function latsSearch(
  task: string,
  options?: LATSOptions,
): Promise<LATSResult> {
  const iterations = options?.iterations ?? DEFAULT_ITERATIONS
  const expansionWidth = options?.expansionWidth ?? DEFAULT_EXPANSION_WIDTH
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH
  const availableActions = options?.availableActions
  const earlyStopThreshold = clamp(options?.earlyStopThreshold ?? DEFAULT_EARLY_STOP_THRESHOLD)

  const llmCallCounter = { count: 0 }
  let nodeCount = 0
  let terminatedEarly = false
  let iterationsUsed = 0

  // Initialize root
  const root: LATSNode = {
    id: `lats_${nodeCount++}`,
    depth: 0,
    action: null,
    state: `Task: ${task}`,
    totalValue: 0,
    visits: 0,
    parent: null,
    children: [],
  }

  log.info("LATS starting", { task: task.slice(0, 100), iterations, expansionWidth, maxDepth })

  for (let iter = 0; iter < iterations; iter++) {
    // ── 1. Selection ──
    const leaf = selectLeaf(root)

    // ── 2. Expansion (if not at max depth) ──
    if (leaf.depth < maxDepth) {
      const candidateActions = await expandNode(task, leaf, expansionWidth, availableActions, llmCallCounter)

      for (const action of candidateActions) {
        // ── 3. Simulation ──
        const simResult = await simulateAction(task, leaf.state, action, llmCallCounter)

        const childNode: LATSNode = {
          id: `lats_${nodeCount++}`,
          depth: leaf.depth + 1,
          action: {
            ...action,
            observation: simResult.observation,
            value: simResult.value,
          },
          state: simResult.newState,
          totalValue: 0,
          visits: 0,
          parent: leaf,
          children: [],
        }

        leaf.children.push(childNode)

        // ── 4. Backpropagation ──
        backpropagate(childNode, simResult.value)
      }
    }

    log.debug("LATS iteration", {
      iter: iter + 1,
      totalNodes: nodeCount,
      rootVisits: root.visits,
    })

    const currentBestPath = extractBestPath(root)
    const currentBestLeaf = currentBestPath[currentBestPath.length - 1]
    const currentBestValue = currentBestLeaf
      ? currentBestLeaf.totalValue / Math.max(1, currentBestLeaf.visits)
      : 0

    if (currentBestValue >= earlyStopThreshold) {
      terminatedEarly = true
      iterationsUsed = iter + 1
      log.info("LATS early termination reached", {
        iterationsUsed,
        bestValue: currentBestValue,
        threshold: earlyStopThreshold,
      })
      break
    }
  }

  if (!terminatedEarly) {
    iterationsUsed = iterations
  }

  // Extract best path
  const bestPath = extractBestPath(root)
  const bestActions = bestPath
    .filter((n) => n.action !== null)
    .map((n) => n.action!)

  // Synthesize final answer from best action sequence
  const answer = await synthesizeAnswer(task, bestActions, llmCallCounter)

  const bestValue = bestPath.length > 0
    ? bestPath[bestPath.length - 1].totalValue / Math.max(1, bestPath[bestPath.length - 1].visits)
    : 0

  log.info("LATS complete", {
    iterations,
    iterationsUsed,
    totalNodes: nodeCount,
    llmCalls: llmCallCounter.count,
    bestPathLength: bestActions.length,
    bestValue,
    terminatedEarly,
    earlyStopThreshold,
  })

  return {
    bestActions,
    answer,
    iterations,
    iterationsUsed,
    totalNodes: nodeCount,
    llmCalls: llmCallCounter.count,
    bestValue,
    terminatedEarly,
    earlyStopThreshold,
  }
}

// ── Synthesis ───────────────────────────────────────────────────────────────

const SYNTHESIZE_PROMPT = `Based on the best action sequence found through search, produce a final answer.

Task:
"""
{task}
"""

Best action sequence:
{actions}

Produce a clear, direct final answer based on this reasoning chain:`

async function synthesizeAnswer(
  task: string,
  actions: LATSAction[],
  llmCallCounter: { count: number },
): Promise<string> {
  if (actions.length === 0) return ""

  const actionsText = actions
    .map((a, i) => `${i + 1}. [Action] ${a.description}\n   [Reasoning] ${a.reasoning}\n   [Observation] ${a.observation}`)
    .join("\n")

  const prompt = SYNTHESIZE_PROMPT
    .replace("{task}", task.slice(0, 2000))
    .replace("{actions}", actionsText.slice(0, 3000))

  llmCallCounter.count++

  return orchestrator.generate("reasoning", { prompt })
}

// ── Utilities ───────────────────────────────────────────────────────────────

/**
 * Extract the most-visited path from root to a leaf (best policy).
 */
function extractBestPath(root: LATSNode): LATSNode[] {
  const path: LATSNode[] = [root]
  let current = root

  while (current.children.length > 0) {
    // Pick most-visited child (robust policy)
    const best = current.children.reduce((a, b) =>
      a.visits > b.visits ? a : b,
    )
    path.push(best)
    current = best
  }

  return path
}

function buildStateHistory(node: LATSNode): string {
  const history: string[] = []
  let current: LATSNode | null = node

  while (current !== null) {
    if (current.action) {
      history.unshift(
        `Action: ${current.action.description}\nObservation: ${current.action.observation}`,
      )
    }
    current = current.parent
  }

  return history.length > 0
    ? history.join("\n---\n")
    : "No actions taken yet."
}

function parseActionArray(raw: string, k: number): LATSAction[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .slice(0, k)
        .map((a: Record<string, unknown>) => ({
          description: String(a.description ?? ""),
          reasoning: String(a.reasoning ?? ""),
          observation: "",
          value: 0,
        }))
        .filter((a) => a.description.length > 0)
    }
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1])
        if (Array.isArray(parsed)) {
          return parsed.slice(0, k).map((a: Record<string, unknown>) => ({
            description: String(a.description ?? ""),
            reasoning: String(a.reasoning ?? ""),
            observation: "",
            value: 0,
          }))
        }
      } catch { /* fall through */ }
    }
  }

  return [{ description: raw.trim().slice(0, 300), reasoning: "Parsed from raw", observation: "", value: 0 }]
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function extractJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0]) as T
    throw new Error("No JSON found")
  }
}

// ── Test Utilities ──────────────────────────────────────────────────────────

export const __latsTestUtils = {
  selectUCB1,
  selectLeaf,
  backpropagate,
  extractBestPath,
  buildStateHistory,
  parseActionArray,
  UCB_C,
  DEFAULT_ITERATIONS,
  DEFAULT_EXPANSION_WIDTH,
  DEFAULT_MAX_DEPTH,
  DEFAULT_EARLY_STOP_THRESHOLD,
  GAMMA,
}
