/**
 * self-refine.ts — Iterative Refinement with Self-Feedback
 *
 * Implements the Self-Refine framework from:
 *   Madaan et al., "Self-Refine: Iterative Refinement with Self-Feedback"
 *   (NeurIPS 2023, arXiv:2303.17651)
 *
 * Core idea: a single LLM acts as both generator and critic in a tight loop:
 *   1. Generate initial output
 *   2. Self-Feedback: the same model evaluates its own output along multiple
 *      quality dimensions and produces structured, actionable feedback
 *   3. Refine: the model takes its own output + feedback and produces an
 *      improved version
 *   4. Repeat until feedback indicates "no more improvements needed" or max
 *      iterations reached
 *
 * Key difference from Reflexion: Self-Refine works within a *single task attempt*
 * (refine the same output), while Reflexion works *across attempts* (retry from
 * scratch with accumulated lessons).
 *
 * Key difference from ResponseCritic (existing): Self-Refine uses structured
 * multi-dimension feedback (not just a numeric score), stops based on the
 * feedback content (not a threshold), and the feedback is much more specific.
 *
 * Integration: replaces or augments the existing critique step in the pipeline
 * for tasks that benefit from iterative polish (writing, coding, analysis).
 *
 * @module core/self-refine
 */

import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"

const log = createLogger("core.self-refine")

// ── Configuration ────────────────────────────────────────────────────────────

/** Maximum refinement iterations */
const MAX_ITERATIONS = 3

/** If all dimension scores >= this, stop early */
const SATISFACTION_THRESHOLD = 0.85

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeedbackDimension {
  name: string
  score: number
  feedback: string
}

export interface SelfFeedback {
  dimensions: FeedbackDimension[]
  overallScore: number
  stopRefining: boolean
  summary: string
}

export interface RefinementIteration {
  version: number
  output: string
  feedback: SelfFeedback
}

export interface SelfRefineResult {
  /** The final refined output */
  output: string
  /** Initial (v0) output before any refinement */
  initial: string
  /** Total iterations (including v0) */
  iterations: number
  /** History of each refinement step */
  history: RefinementIteration[]
  /** Final feedback scores */
  finalScores: FeedbackDimension[]
  /** Was refinement stopped by satisfaction threshold? */
  satisfiedEarly: boolean
}

export interface SelfRefineOptions {
  /** The task/query the output is responding to */
  task: string
  /** Quality dimensions to evaluate (defaults to standard set) */
  dimensions?: string[]
  /** Maximum iterations */
  maxIterations?: number
  /** Custom generation function */
  generator?: (prompt: string) => Promise<string>
}

// ── Default Dimensions ──────────────────────────────────────────────────────

const DEFAULT_DIMENSIONS = [
  "accuracy",       // Is the information correct and grounded?
  "completeness",   // Are all important aspects covered?
  "clarity",        // Is the response clear and well-structured?
  "relevance",      // Does it directly address the task?
  "conciseness",    // Is it free of unnecessary verbosity?
]

// ── Self-Feedback ───────────────────────────────────────────────────────────

const FEEDBACK_PROMPT = `You are a precise quality reviewer. Evaluate the following response on specific dimensions.

Task the response is addressing:
"""
{task}
"""

Response to evaluate:
"""
{response}
"""

Evaluate on these dimensions: {dimensions}

Return ONLY valid JSON:
{
  "dimensions": [
    { "name": "dimension_name", "score": 0.0-1.0, "feedback": "specific actionable feedback" }
  ],
  "overallScore": 0.0-1.0,
  "stopRefining": true/false,
  "summary": "1-2 sentence overall feedback"
}

Rules:
- Score each dimension 0.0 (terrible) to 1.0 (excellent)
- Set stopRefining=true ONLY if all dimensions >= 0.85
- Feedback must be SPECIFIC and ACTIONABLE (not vague)
- If the output is already very good, acknowledge it and set stopRefining=true`

async function generateFeedback(
  task: string,
  response: string,
  dimensions: string[],
  generateFn: (prompt: string) => Promise<string>,
): Promise<SelfFeedback> {
  const prompt = FEEDBACK_PROMPT
    .replace("{task}", task.slice(0, 1500))
    .replace("{response}", response.slice(0, 3000))
    .replace("{dimensions}", dimensions.join(", "))

  try {
    const raw = await generateFn(prompt)
    const json = extractJson<{
      dimensions?: Array<{ name?: string; score?: number; feedback?: string }>
      overallScore?: number
      stopRefining?: boolean
      summary?: string
    }>(raw)

    const dims: FeedbackDimension[] = (json.dimensions ?? []).map((d) => ({
      name: String(d.name ?? "unknown"),
      score: clamp(Number(d.score ?? 0.5)),
      feedback: String(d.feedback ?? ""),
    }))

    const overallScore =
      dims.length > 0
        ? dims.reduce((sum, d) => sum + d.score, 0) / dims.length
        : clamp(Number(json.overallScore ?? 0.5))

    const allSatisfied = dims.every((d) => d.score >= SATISFACTION_THRESHOLD)

    return {
      dimensions: dims,
      overallScore,
      stopRefining: json.stopRefining === true || allSatisfied,
      summary: String(json.summary ?? ""),
    }
  } catch {
    log.warn("self-refine feedback generation failed, assuming satisfied")
    return {
      dimensions: dimensions.map((name) => ({ name, score: 0.8, feedback: "" })),
      overallScore: 0.8,
      stopRefining: true,
      summary: "Feedback generation failed — accepting current output",
    }
  }
}

// ── Refinement ──────────────────────────────────────────────────────────────

const REFINE_PROMPT = `Improve this response based on the specific feedback provided. Keep the same language and style.

Task:
"""
{task}
"""

Current response (v{version}):
"""
{response}
"""

Feedback to address:
{feedbackBlock}

Overall: {summary}

Write an improved version that addresses ALL the feedback points. Output ONLY the improved response, no meta-commentary.`

async function refineOutput(
  task: string,
  currentOutput: string,
  feedback: SelfFeedback,
  version: number,
  generateFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const feedbackBlock = feedback.dimensions
    .filter((d) => d.score < SATISFACTION_THRESHOLD && d.feedback.length > 0)
    .map((d) => `- ${d.name} (${(d.score * 100).toFixed(0)}%): ${d.feedback}`)
    .join("\n")

  if (!feedbackBlock) {
    return currentOutput // No actionable feedback
  }

  const prompt = REFINE_PROMPT
    .replace("{task}", task.slice(0, 1500))
    .replace("{response}", currentOutput.slice(0, 3000))
    .replace("{version}", String(version))
    .replace("{feedbackBlock}", feedbackBlock)
    .replace("{summary}", feedback.summary)

  return generateFn(prompt)
}

// ── Main API ────────────────────────────────────────────────────────────────

/**
 * Apply Self-Refine to an initial output.
 *
 * @param initialOutput - The v0 output to refine
 * @param options       - Task description, dimensions, and limits
 */
export async function selfRefine(
  initialOutput: string,
  options: SelfRefineOptions,
): Promise<SelfRefineResult> {
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS
  const maxIter = options.maxIterations ?? MAX_ITERATIONS
  const generateFn =
    options.generator ??
    ((prompt: string) => orchestrator.generate("reasoning", { prompt }))

  let currentOutput = initialOutput
  const history: RefinementIteration[] = []

  for (let version = 0; version < maxIter; version++) {
    // ── Feedback ──
    const feedback = await generateFeedback(options.task, currentOutput, dimensions, generateFn)

    history.push({ version, output: currentOutput, feedback })

    log.debug("self-refine iteration", {
      version,
      overallScore: feedback.overallScore,
      stopRefining: feedback.stopRefining,
    })

    if (feedback.stopRefining) {
      log.info("self-refine satisfied early", {
        version,
        score: feedback.overallScore,
      })
      return {
        output: currentOutput,
        initial: initialOutput,
        iterations: version + 1,
        history,
        finalScores: feedback.dimensions,
        satisfiedEarly: true,
      }
    }

    // ── Refine ──
    const refined = await refineOutput(options.task, currentOutput, feedback, version, generateFn)

    // Guard against refinement making things shorter/worse
    if (refined.trim().length < currentOutput.trim().length * 0.3) {
      log.warn("self-refine produced drastically shorter output, keeping previous")
      continue
    }

    currentOutput = refined
  }

  // Final evaluation
  const finalFeedback = await generateFeedback(options.task, currentOutput, dimensions, generateFn)
  history.push({ version: maxIter, output: currentOutput, feedback: finalFeedback })

  log.info("self-refine completed", {
    iterations: maxIter + 1,
    finalScore: finalFeedback.overallScore,
  })

  return {
    output: currentOutput,
    initial: initialOutput,
    iterations: maxIter + 1,
    history,
    finalScores: finalFeedback.dimensions,
    satisfiedEarly: false,
  }
}

/**
 * Generate + Self-Refine in one call.
 */
export async function generateAndRefine(
  task: string,
  options?: Partial<SelfRefineOptions>,
): Promise<SelfRefineResult> {
  const generateFn =
    options?.generator ??
    ((prompt: string) => orchestrator.generate("reasoning", { prompt }))

  const initialOutput = await generateFn(task)

  return selfRefine(initialOutput, {
    task,
    ...options,
  })
}

// ── Utilities ───────────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function extractJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) return JSON.parse(match[1]) as T
    const braceMatch = text.match(/\{[\s\S]*\}/)
    if (braceMatch) return JSON.parse(braceMatch[0]) as T
    throw new Error("No JSON found")
  }
}

// ── Test Utilities ──────────────────────────────────────────────────────────

export const __selfRefineTestUtils = {
  generateFeedback,
  refineOutput,
  MAX_ITERATIONS,
  SATISFACTION_THRESHOLD,
  DEFAULT_DIMENSIONS,
}
