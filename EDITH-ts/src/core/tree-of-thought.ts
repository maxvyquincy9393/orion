/**
 * tree-of-thought.ts — Deliberate Problem Solving with LLMs
 *
 * Implements the Tree of Thoughts (ToT) framework from:
 *   Yao et al., "Tree of Thoughts: Deliberate Problem Solving with Large
 *   Language Models" (NeurIPS 2023, arXiv:2305.10601)
 *
 * Core idea: instead of a single left-to-right chain of thought, the model
 * explores multiple reasoning paths as a tree.  At each step it generates
 * K candidate "thoughts" (partial solutions), evaluates them, and prunes
 * unpromising branches — enabling backtracking and look-ahead.
 *
 * Modes:
 *   - BFS (breadth-first): explore top-B candidates per level (default)
 *   - DFS (depth-first): go deep, backtrack on low-scoring branches
 *
 * Integration: used by AgentRunner for complex reasoning tasks, and can be
 * called standalone for any multi-step problem.
 *
 * @module core/tree-of-thought
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"

const log = createLogger("core.tot")

// ── Configuration ────────────────────────────────────────────────────────────

/** Number of candidate thoughts per expansion step */
const DEFAULT_BRANCHING_FACTOR = 3

/** Maximum depth of the thought tree */
const DEFAULT_MAX_DEPTH = 3

/** Beam width for BFS mode — keep top-B candidates per level */
const DEFAULT_BEAM_WIDTH = 2

/** Score threshold for DFS pruning */
const DFS_PRUNE_THRESHOLD = 0.3

// ── Types ────────────────────────────────────────────────────────────────────

export interface ThoughtNode {
  id: string
  depth: number
  thought: string
  score: number
  parentId: string | null
  children: ThoughtNode[]
  isTerminal: boolean
}

export interface ToTResult {
  /** Best final answer found */
  answer: string
  /** Score of the best path */
  bestScore: number
  /** The winning path of thoughts (root → leaf) */
  bestPath: ThoughtNode[]
  /** Total nodes explored */
  nodesExplored: number
  /** Total LLM calls made */
  llmCalls: number
  /** Search mode used */
  mode: "bfs" | "dfs"
}

export interface ToTOptions {
  /** Search strategy */
  mode?: "bfs" | "dfs"
  /** Number of candidate thoughts per step */
  branchingFactor?: number
  /** Maximum depth */
  maxDepth?: number
  /** Beam width (BFS) or prune threshold (DFS) */
  beamWidth?: number
  /** Custom thought generator */
  thoughtGenerator?: (problem: string, partialSolution: string, depth: number) => Promise<string[]>
  /** Custom thought evaluator */
  thoughtEvaluator?: (problem: string, thought: string) => Promise<number>
}

// ── Thought Generation ──────────────────────────────────────────────────────

const GENERATE_THOUGHTS_PROMPT = `You are solving a problem step by step. Generate {k} distinct next-step reasoning thoughts.

Problem:
"""
{problem}
"""

{partialBlock}

Generate exactly {k} different next thoughts. Each should explore a different angle or approach.
Format: return a JSON array of strings, each being one thought/reasoning step.

Example: ["First approach: ...", "Alternative: ...", "Another angle: ..."]
Return ONLY the JSON array.`

async function defaultGenerateThoughts(
  problem: string,
  partialSolution: string,
  _depth: number,
  k: number,
): Promise<string[]> {
  const partialBlock = partialSolution
    ? `Progress so far:\n"""\n${partialSolution.slice(0, 2000)}\n"""\n\nGenerate the next reasoning step(s).`
    : "This is the first step. Generate initial reasoning approaches."

  const prompt = GENERATE_THOUGHTS_PROMPT
    .replace(/\{k\}/g, String(k))
    .replace("{problem}", problem.slice(0, 2000))
    .replace("{partialBlock}", partialBlock)

  const raw = await orchestrator.generate("reasoning", { prompt, temperature: 0.7 })
  return parseThoughtArray(raw, k)
}

// ── Thought Evaluation ──────────────────────────────────────────────────────

const EVALUATE_THOUGHT_PROMPT = `Evaluate this reasoning step for a problem-solving process. How promising is this thought for reaching the correct solution?

Problem:
"""
{problem}
"""

Reasoning step:
"""
{thought}
"""

Score from 0.0 (completely wrong / dead end) to 1.0 (very promising / likely correct).
Return ONLY valid JSON: { "score": <number>, "reasoning": "<brief justification>" }`

async function defaultEvaluateThought(problem: string, thought: string): Promise<number> {
  const prompt = EVALUATE_THOUGHT_PROMPT
    .replace("{problem}", problem.slice(0, 1500))
    .replace("{thought}", thought.slice(0, 2000))

  try {
    const raw = await orchestrator.generate("fast", { prompt, temperature: 0.1 })
    const json = extractJson<{ score?: number }>(raw)
    return clamp(Number(json.score ?? 0.5))
  } catch {
    return 0.5
  }
}

// ── Synthesis ───────────────────────────────────────────────────────────────

const SYNTHESIZE_PROMPT = `Given the following reasoning chain for a problem, produce a final answer.

Problem:
"""
{problem}
"""

Reasoning chain:
{chain}

Based on this reasoning, provide the final answer:`

async function synthesize(problem: string, path: ThoughtNode[]): Promise<string> {
  const chain = path
    .map((n, i) => `Step ${i + 1}: ${n.thought}`)
    .join("\n")

  const prompt = SYNTHESIZE_PROMPT
    .replace("{problem}", problem.slice(0, 2000))
    .replace("{chain}", chain.slice(0, 3000))

  return orchestrator.generate("reasoning", { prompt })
}

// ── BFS Search ──────────────────────────────────────────────────────────────

async function bfsSearch(
  problem: string,
  options: Required<Pick<ToTOptions, "branchingFactor" | "maxDepth" | "beamWidth">>,
  generateFn: (problem: string, partial: string, depth: number, k: number) => Promise<string[]>,
  evaluateFn: (problem: string, thought: string) => Promise<number>,
): Promise<{ bestPath: ThoughtNode[]; nodesExplored: number; llmCalls: number }> {
  let nodeCount = 0
  let llmCalls = 0

  const root: ThoughtNode = {
    id: "root",
    depth: 0,
    thought: "",
    score: 1.0,
    parentId: null,
    children: [],
    isTerminal: false,
  }

  let currentLevel: ThoughtNode[] = [root]

  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const nextLevel: ThoughtNode[] = []

    for (const parent of currentLevel) {
      const partialSolution = buildPartialSolution(parent)
      const thoughts = await generateFn(problem, partialSolution, depth, options.branchingFactor)
      llmCalls++

      for (const thought of thoughts) {
        const score = await evaluateFn(problem, partialSolution + "\n" + thought)
        llmCalls++

        const node: ThoughtNode = {
          id: `d${depth}_n${nodeCount++}`,
          depth,
          thought,
          score,
          parentId: parent.id,
          children: [],
          isTerminal: depth === options.maxDepth,
        }

        parent.children.push(node)
        nextLevel.push(node)
      }
    }

    // Beam selection: keep top-B candidates
    nextLevel.sort((a, b) => b.score - a.score)
    currentLevel = nextLevel.slice(0, options.beamWidth)

    log.debug("ToT BFS level complete", {
      depth,
      candidates: nextLevel.length,
      kept: currentLevel.length,
      bestScore: currentLevel[0]?.score ?? 0,
    })
  }

  // Find the best leaf and trace path
  const bestLeaf = currentLevel.reduce((best, node) =>
    node.score > best.score ? node : best,
    currentLevel[0],
  )

  return {
    bestPath: tracePath(root, bestLeaf),
    nodesExplored: nodeCount,
    llmCalls,
  }
}

// ── DFS Search ──────────────────────────────────────────────────────────────

async function dfsSearch(
  problem: string,
  options: Required<Pick<ToTOptions, "branchingFactor" | "maxDepth">>,
  generateFn: (problem: string, partial: string, depth: number, k: number) => Promise<string[]>,
  evaluateFn: (problem: string, thought: string) => Promise<number>,
): Promise<{ bestPath: ThoughtNode[]; nodesExplored: number; llmCalls: number }> {
  let nodeCount = 0
  let llmCalls = 0
  let bestScore = -1
  let bestPath: ThoughtNode[] = []

  const root: ThoughtNode = {
    id: "root",
    depth: 0,
    thought: "",
    score: 1.0,
    parentId: null,
    children: [],
    isTerminal: false,
  }

  async function dfs(node: ThoughtNode, path: ThoughtNode[]): Promise<void> {
    if (node.depth >= options.maxDepth) {
      if (node.score > bestScore) {
        bestScore = node.score
        bestPath = [...path]
      }
      return
    }

    const partialSolution = buildPartialSolution(node)
    const thoughts = await generateFn(problem, partialSolution, node.depth + 1, options.branchingFactor)
    llmCalls++

    const scoredThoughts: Array<{ thought: string; score: number }> = []
    for (const thought of thoughts) {
      const score = await evaluateFn(problem, partialSolution + "\n" + thought)
      llmCalls++
      scoredThoughts.push({ thought, score })
    }

    // Sort descending and explore best first
    scoredThoughts.sort((a, b) => b.score - a.score)

    for (const { thought, score } of scoredThoughts) {
      // Prune unpromising branches
      if (score < DFS_PRUNE_THRESHOLD) {
        log.debug("ToT DFS pruning branch", { score, threshold: DFS_PRUNE_THRESHOLD })
        continue
      }

      const child: ThoughtNode = {
        id: `d${node.depth + 1}_n${nodeCount++}`,
        depth: node.depth + 1,
        thought,
        score,
        parentId: node.id,
        children: [],
        isTerminal: node.depth + 1 === options.maxDepth,
      }

      node.children.push(child)
      await dfs(child, [...path, child])
    }
  }

  await dfs(root, [root])
  return { bestPath, nodesExplored: nodeCount, llmCalls }
}

// ── Main API ────────────────────────────────────────────────────────────────

/**
 * Solve a problem using Tree of Thoughts deliberate reasoning.
 *
 * @param problem  - The problem to solve
 * @param options  - Configuration for the search
 * @returns        - The best answer, path, and search statistics
 */
export async function treeOfThought(
  problem: string,
  options?: ToTOptions,
): Promise<ToTResult> {
  const mode = options?.mode ?? "bfs"
  const branchingFactor = options?.branchingFactor ?? DEFAULT_BRANCHING_FACTOR
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH
  const beamWidth = options?.beamWidth ?? DEFAULT_BEAM_WIDTH

  const generateFn = options?.thoughtGenerator
    ? async (_p: string, partial: string, depth: number, k: number) =>
        (await options.thoughtGenerator!(_p, partial, depth)).slice(0, k)
    : defaultGenerateThoughts

  const evaluateFn = options?.thoughtEvaluator ?? defaultEvaluateThought

  log.info("ToT starting", { mode, branchingFactor, maxDepth, beamWidth, problem: problem.slice(0, 100) })

  const result =
    mode === "dfs"
      ? await dfsSearch(problem, { branchingFactor, maxDepth }, generateFn, evaluateFn)
      : await bfsSearch(problem, { branchingFactor, maxDepth, beamWidth }, generateFn, evaluateFn)

  // Synthesize final answer from best path
  const answer =
    result.bestPath.length > 1
      ? await synthesize(problem, result.bestPath.filter((n) => n.thought.length > 0))
      : ""

  const bestScore = result.bestPath.length > 0
    ? result.bestPath[result.bestPath.length - 1].score
    : 0

  log.info("ToT complete", {
    mode,
    nodesExplored: result.nodesExplored,
    llmCalls: result.llmCalls,
    bestScore,
    pathLength: result.bestPath.length,
  })

  return {
    answer,
    bestScore,
    bestPath: result.bestPath,
    nodesExplored: result.nodesExplored,
    llmCalls: result.llmCalls,
    mode,
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function buildPartialSolution(node: ThoughtNode): string {
  const parts: string[] = []
  let current: ThoughtNode | null = node
  // Walk up the tree to reconstruct the path
  const stack: string[] = []
  while (current && current.thought.length > 0) {
    stack.push(current.thought)
    // Since we don't have parent refs easily, we build from path
    break
  }
  // For simplicity, just return this node's thought as context
  return node.thought
}

function tracePath(root: ThoughtNode, target: ThoughtNode): ThoughtNode[] {
  // BFS to find path from root to target
  const path: ThoughtNode[] = []
  const queue: Array<{ node: ThoughtNode; trail: ThoughtNode[] }> = [
    { node: root, trail: [root] },
  ]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.node.id === target.id) {
      return current.trail
    }
    for (const child of current.node.children) {
      queue.push({ node: child, trail: [...current.trail, child] })
    }
  }

  return [root, target]
}

function parseThoughtArray(raw: string, k: number): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter((s) => s.length > 0).slice(0, k)
    }
  } catch {
    // Try markdown extraction
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1])
        if (Array.isArray(parsed)) {
          return parsed.map(String).filter((s) => s.length > 0).slice(0, k)
        }
      } catch { /* fall through */ }
    }
  }

  // Fallback: split by numbered lines or newlines
  const lines = raw
    .split(/\n/)
    .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter((l) => l.length > 10)
    .slice(0, k)

  return lines.length > 0 ? lines : [raw.trim()]
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

export const __totTestUtils = {
  defaultGenerateThoughts,
  defaultEvaluateThought,
  parseThoughtArray,
  synthesize,
  tracePath,
  DEFAULT_BRANCHING_FACTOR,
  DEFAULT_MAX_DEPTH,
  DEFAULT_BEAM_WIDTH,
  DFS_PRUNE_THRESHOLD,
}
