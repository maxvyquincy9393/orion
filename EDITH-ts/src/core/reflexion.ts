/**
 * reflexion.ts — Verbal Reinforcement Learning for Language Agents
 *
 * Implements the Reflexion framework from:
 *   Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning"
 *   (NeurIPS 2023, arXiv:2303.11366)
 *
 * Core idea: after a task attempt, the agent generates a *verbal self-reflection*
 * analysing what went wrong. This reflection is stored in a short-term "reflective
 * memory" and prepended to the next attempt's prompt, enabling the agent to avoid
 * repeating the same mistakes without gradient updates.
 *
 * Architecture:
 *   1. Actor — executes the task (via orchestrator.generate)
 *   2. Evaluator — scores the output (reuses ResponseCritic)
 *   3. Self-Reflection — generates natural-language diagnosis of failure
 *   4. Memory — accumulates reflections across retries (sliding window)
 *
 * Integration point: wraps any (prompt → output) generation to add retry-with-
 * reflection on top.  Used by AgentRunner.runSingle and message-pipeline.
 *
 * @module core/reflexion
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"
import type { GenerateOptions } from "../engines/types.js"

const log = createLogger("core.reflexion")

// ── Configuration ────────────────────────────────────────────────────────────

/** Maximum retry attempts (paper recommends 3) */
const MAX_TRIALS = 3

/** Score threshold — if evaluator score >= this, accept immediately */
const ACCEPT_THRESHOLD = 0.75

/** Maximum reflections kept in sliding window */
const REFLECTION_WINDOW = 5

/** Max characters per reflection to keep prompts bounded */
const MAX_REFLECTION_CHARS = 600

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReflexionEvaluation {
  score: number
  passed: boolean
  reasoning: string
}

export interface ReflexionTrial {
  attempt: number
  output: string
  evaluation: ReflexionEvaluation
  reflection: string | null
}

export interface ReflexionResult {
  /** Final accepted output */
  output: string
  /** All trial attempts */
  trials: ReflexionTrial[]
  /** Total attempts taken */
  attempts: number
  /** Whether the final output passed the evaluator threshold */
  passed: boolean
  /** Accumulated reflections as a single string */
  reflectionMemory: string
}

// ── Evaluator ────────────────────────────────────────────────────────────────

const EVALUATE_PROMPT = `You are a strict evaluator. Score the following AI response on correctness, completeness, and task adherence.

Task:
"""
{task}
"""

Response:
"""
{response}
"""

Return ONLY valid JSON:
{
  "score": <0.0 to 1.0>,
  "passed": <true if score >= 0.75>,
  "reasoning": "<1-2 sentence justification>"
}`

async function evaluate(task: string, response: string): Promise<ReflexionEvaluation> {
  const prompt = EVALUATE_PROMPT
    .replace("{task}", task.slice(0, 2000))
    .replace("{response}", response.slice(0, 3000))

  try {
    const raw = await orchestrator.generate("fast", { prompt, temperature: 0.1 })
    const json = extractJson<{ score?: number; passed?: boolean; reasoning?: string }>(raw)
    const score = clamp(Number(json.score ?? 0.5))
    return {
      score,
      passed: score >= ACCEPT_THRESHOLD,
      reasoning: String(json.reasoning ?? "No reasoning provided"),
    }
  } catch {
    log.warn("reflexion evaluator failed, assuming pass")
    return { score: 0.8, passed: true, reasoning: "Evaluator unavailable — default pass" }
  }
}

// ── Self-Reflection Generator ────────────────────────────────────────────────

const REFLECT_PROMPT = `You are an expert self-reflection assistant. A previous attempt to solve a task has failed or scored poorly. Analyze what went wrong and provide specific, actionable insight for the next attempt.

Task:
"""
{task}
"""

Failed attempt (score: {score}):
"""
{response}
"""

Evaluator reasoning: {reasoning}

{previousReflections}

Write a concise self-reflection (max 3 sentences) that:
1. Identifies the specific mistake or gap
2. Proposes a concrete correction strategy
3. Notes any patterns from prior attempts if available

Self-reflection:`

async function generateReflection(
  task: string,
  response: string,
  evaluation: ReflexionEvaluation,
  previousReflections: string[],
): Promise<string> {
  const prevBlock =
    previousReflections.length > 0
      ? `Previous reflections from earlier attempts:\n${previousReflections.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}`
      : ""

  const prompt = REFLECT_PROMPT
    .replace("{task}", task.slice(0, 1500))
    .replace("{response}", response.slice(0, 2000))
    .replace("{score}", String(evaluation.score.toFixed(2)))
    .replace("{reasoning}", evaluation.reasoning)
    .replace("{previousReflections}", prevBlock)

  try {
    const reflection = await orchestrator.generate("fast", { prompt, temperature: 0.3 })
    return reflection.trim().slice(0, MAX_REFLECTION_CHARS)
  } catch {
    log.warn("reflexion self-reflection generation failed")
    return `Previous attempt scored ${evaluation.score.toFixed(2)}. ${evaluation.reasoning}`
  }
}

// ── Main Reflexion Loop ─────────────────────────────────────────────────────

/**
 * Execute a task with Reflexion retry loop.
 *
 * The actor function is called repeatedly (up to MAX_TRIALS) with accumulated
 * reflections injected into the prompt. Each failed attempt generates a verbal
 * self-reflection that helps the next attempt avoid the same mistake.
 *
 * @param task        - The task description / user query
 * @param actor       - The generation function (prompt → output string)
 * @param options     - Optional overrides
 */
export async function reflexionLoop(
  task: string,
  actor: (augmentedPrompt: string) => Promise<string>,
  options?: {
    maxTrials?: number
    acceptThreshold?: number
    evaluator?: (task: string, response: string) => Promise<ReflexionEvaluation>
  },
): Promise<ReflexionResult> {
  const maxTrials = options?.maxTrials ?? MAX_TRIALS
  const threshold = options?.acceptThreshold ?? ACCEPT_THRESHOLD
  const evalFn = options?.evaluator ?? evaluate

  const reflections: string[] = []
  const trials: ReflexionTrial[] = []

  for (let attempt = 1; attempt <= maxTrials; attempt++) {
    // Build augmented prompt with reflection memory
    const reflectionBlock =
      reflections.length > 0
        ? `\n\n[Self-Reflections from previous attempts — use these to improve your response]\n${reflections.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n`
        : ""

    const augmentedPrompt = reflectionBlock + task

    // ── Act ──
    log.debug("reflexion attempt", { attempt, maxTrials, reflections: reflections.length })
    const output = await actor(augmentedPrompt)

    // ── Evaluate ──
    const evaluation = await evalFn(task, output)

    if (evaluation.passed || evaluation.score >= threshold) {
      // Accept this attempt
      trials.push({ attempt, output, evaluation, reflection: null })
      log.info("reflexion accepted", { attempt, score: evaluation.score })
      return {
        output,
        trials,
        attempts: attempt,
        passed: true,
        reflectionMemory: reflections.join("\n"),
      }
    }

    // ── Reflect ──
    const reflection = await generateReflection(task, output, evaluation, reflections)
    reflections.push(reflection)

    // Keep sliding window bounded
    if (reflections.length > REFLECTION_WINDOW) {
      reflections.shift()
    }

    trials.push({ attempt, output, evaluation, reflection })
    log.info("reflexion rejected, reflecting", {
      attempt,
      score: evaluation.score,
      reflection: reflection.slice(0, 120),
    })
  }

  // All trials exhausted — return best attempt
  const bestTrial = trials.reduce((best, t) =>
    t.evaluation.score > best.evaluation.score ? t : best,
  )

  log.warn("reflexion exhausted all trials, returning best", {
    bestAttempt: bestTrial.attempt,
    bestScore: bestTrial.evaluation.score,
  })

  return {
    output: bestTrial.output,
    trials,
    attempts: maxTrials,
    passed: bestTrial.evaluation.passed,
    reflectionMemory: reflections.join("\n"),
  }
}

/**
 * Convenience: wrap orchestrator.generate with reflexion.
 */
export async function reflexionGenerate(
  task: string,
  generateOptions: Omit<GenerateOptions, "prompt">,
  taskType: "reasoning" | "code" | "fast" = "reasoning",
): Promise<ReflexionResult> {
  return reflexionLoop(task, async (augmentedPrompt) => {
    return orchestrator.generate(taskType, { ...generateOptions, prompt: augmentedPrompt })
  })
}

// ── Utilities ───────────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function extractJson<T>(text: string): T {
  // Try direct parse first
  try {
    return JSON.parse(text) as T
  } catch {
    // Try to extract JSON from markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) {
      return JSON.parse(match[1]) as T
    }
    // Try to find first { ... } block
    const braceMatch = text.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      return JSON.parse(braceMatch[0]) as T
    }
    throw new Error("No JSON found in response")
  }
}

// ── Test Utilities Export ────────────────────────────────────────────────────

export const __reflexionTestUtils = {
  evaluate,
  generateReflection,
  MAX_TRIALS,
  ACCEPT_THRESHOLD,
  REFLECTION_WINDOW,
}
