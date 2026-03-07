/**
 * MessagePipeline - The canonical EDITH message processing pipeline.
 *
 * This module is the single source of truth for how a user message is
 * processed from raw input to final response. Both the CLI transport
 * (main.ts) and the WebSocket/HTTP gateway (gateway/server.ts) delegate
 * to this pipeline, ensuring consistent behavior across all entry points.
 *
 * Pipeline stages (in order):
 *   1. Input safety check (prompt filter + affordance)
 *   2. Memory context retrieval
 *   3. Persona / dynamic context detection
 *   4. System prompt assembly
 *   5. LLM generation (orchestrator)
 *   6. Response critique and refinement (optional)
 *   7. Output safety scan
 *   8. Persistence (database + vector memory + session store)
 *   9. Async side effects (profiler, causal graph) - fire-and-forget
 *
 * @module core/message-pipeline
 */

import config from "../config.js"
import { saveMessage } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import type { TaskType } from "../engines/types.js"
import { memory, type BuildContextResult } from "../memory/store.js"
import { profiler } from "../memory/profiler.js"
import { causalGraph } from "../memory/causal-graph.js"
import { sessionSummarizer } from "../memory/session-summarizer.js"
import { detectQueryComplexity } from "../memory/temporal-index.js"
import { filterPromptWithAffordance, type PromptSafetyResult } from "../security/prompt-filter.js"
import { outputScanner, type OutputScanResult } from "../security/output-scanner.js"
import { sessionStore } from "../sessions/session-store.js"
import { createLogger } from "../logger.js"
import { incrementMemoryRetrieval } from "../observability/metrics.js"
import { withSpan } from "../observability/tracing.js"
import { responseCritic } from "./critic.js"
import { personaEngine } from "./persona.js"
import { buildSystemPrompt } from "./system-prompt-builder.js"

const log = createLogger("core.pipeline")

const BLOCKED_RESPONSE = "I can't help with that request."
const PROVISIONAL_MEMORY_REWARD = 0.5
const CRITIC_MAX_ITERATIONS = 2

const SESSION_HISTORY_LOOKBACK = 100
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000
const SESSION_COMPACTION_TRIGGER_RATIO = 0.75
const SESSION_COMPACTION_KEEP_LAST_TURNS = 6
const APPROX_CHARS_PER_TOKEN = 3
const STREAM_CHUNK_SIZE = 140

const CODE_KEYWORDS = /\b(code|bug|debug|stack trace|typescript|javascript|python|refactor|compile|function|class)\b/i
const MULTIMODAL_KEYWORDS = /\b(image|photo|video|audio|voice|screenshot|pdf|attachment)\b/i
const LOCAL_KEYWORDS = /\b(local|offline|on-device|ollama|localhost)\b/i

export class PipelineAbortError extends Error {
  readonly code = "PIPELINE_ABORTED"

  constructor(message = "Message pipeline aborted") {
    super(message)
    this.name = "PipelineAbortError"
  }
}

export type PipelineChunkCallback = (
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
) => void | Promise<void>

/** Returned by the pipeline so callers can use the response and IDs for MemRL feedback. */
export interface PipelineResult {
  /** The final, safety-scanned response to send to the user. */
  response: string
  /** Memory node IDs that were retrieved - used to provide MemRL feedback. */
  retrievedMemoryIds: string[]
  /** Estimated provisional reward before user follow-up is known. */
  provisionalReward: number
  /** Task type selected by the router for this request. */
  taskType: TaskType
}

export interface PipelineOptions {
  /** Identifies the transport layer (e.g. "cli", "webchat", "whatsapp"). */
  channel: string
  /** Session mode for system prompt assembly. */
  sessionMode?: "dm" | "group" | "subagent"
  /** Optional cancellation signal. */
  signal?: AbortSignal
  /** Optional pseudo-stream callback emitted from final response chunks. */
  onChunk?: PipelineChunkCallback
}

function blockedResult(): PipelineResult {
  return {
    response: BLOCKED_RESPONSE,
    retrievedMemoryIds: [],
    provisionalReward: 0,
    taskType: "fast",
  }
}

function resolveAbortMessage(signal: AbortSignal): string {
  if (signal.reason instanceof Error && signal.reason.message) {
    return signal.reason.message
  }
  if (typeof signal.reason === "string" && signal.reason.trim().length > 0) {
    return signal.reason
  }
  return "Pipeline aborted by signal"
}

function assertNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }
  throw new PipelineAbortError(resolveAbortMessage(signal))
}

function classifyTaskType(input: string): TaskType {
  const normalized = input.trim()
  if (!normalized) {
    return "fast"
  }
  if (LOCAL_KEYWORDS.test(normalized)) {
    return "local"
  }
  if (MULTIMODAL_KEYWORDS.test(normalized)) {
    return "multimodal"
  }
  if (CODE_KEYWORDS.test(normalized)) {
    return "code"
  }
  return detectQueryComplexity(normalized) === "complex" ? "reasoning" : "fast"
}

async function emitPseudoStream(
  content: string,
  onChunk: PipelineChunkCallback,
  signal?: AbortSignal,
): Promise<void> {
  const safeContent = content.trim()
  if (!safeContent) {
    return
  }

  const totalChunks = Math.ceil(safeContent.length / STREAM_CHUNK_SIZE)
  for (let offset = 0; offset < safeContent.length; offset += STREAM_CHUNK_SIZE) {
    assertNotAborted(signal)
    const chunkIndex = Math.floor(offset / STREAM_CHUNK_SIZE)
    await onChunk(safeContent.slice(offset, offset + STREAM_CHUNK_SIZE), chunkIndex, totalChunks)
  }
}

function addSessionMessage(
  userId: string,
  channel: string,
  role: "user" | "assistant",
  content: string,
): void {
  sessionStore.addMessage(userId, channel, {
    role,
    content,
    timestamp: Date.now(),
  })
}

function buildUserMessageMetadata(
  channel: string,
  inputSafety: PromptSafetyResult,
  rawText: string,
  safeText: string,
): Record<string, unknown> {
  return {
    role: "user",
    channel,
    category: "event",
    level: 0,
    security: {
      affordance: inputSafety.affordance ?? null,
      sanitized: safeText !== rawText,
    },
  }
}

function buildAssistantMessageMetadata(
  channel: string,
  scanResult: OutputScanResult,
  rawAssistantResponse: string,
  finalResponse: string,
): Record<string, unknown> {
  return {
    role: "assistant",
    channel,
    category: "summary",
    level: 0,
    security: {
      outputIssues: scanResult.issues,
      sanitized: finalResponse !== rawAssistantResponse,
    },
  }
}

async function persistUserMessageAndBuildContext(
  userId: string,
  channel: string,
  rawText: string,
  safeText: string,
  inputSafety: PromptSafetyResult,
): Promise<BuildContextResult> {
  const userMeta = buildUserMessageMetadata(channel, inputSafety, rawText, safeText)

  // Persistence and retrieval are independent; run them together to avoid
  // paying sequential latency for every user turn.
  const [, context] = await Promise.all([
    saveMessage(userId, "user", safeText, channel, userMeta),
    memory.buildContext(userId, safeText),
  ])

  addSessionMessage(userId, channel, "user", safeText)
  return context
}

function estimateSessionTokens(history: Array<{ content: string }>): number {
  // A conservative char-based estimate is intentionally provider-agnostic and
  // stable even when routing switches across model vendors/tokenizers.
  return history.reduce((sum, message) => {
    const chars = typeof message.content === "string" ? message.content.length : 0
    return sum + Math.ceil(chars / APPROX_CHARS_PER_TOKEN)
  }, 0)
}

function resolveContextWindowLimit(): number {
  const configuredLimit = config.SESSION_CONTEXT_WINDOW_TOKENS ?? DEFAULT_CONTEXT_WINDOW_TOKENS
  return Math.max(1, configuredLimit)
}

async function maybeCompactSessionHistory(userId: string, channel: string): Promise<void> {
  if (!config.SESSION_COMPACTION_ENABLED) {
    return
  }

  // Best effort only: compaction improves future turns but must not block the
  // current response path if summarization is unavailable or fails.
  try {
    const sessionHistory = await sessionStore.getSessionHistory(userId, channel, SESSION_HISTORY_LOOKBACK)
    if (sessionHistory.length === 0) {
      return
    }

    const estimatedTokens = estimateSessionTokens(sessionHistory)
    const contextWindowLimit = resolveContextWindowLimit()
    const fillRatio = estimatedTokens / contextWindowLimit

    if (fillRatio < SESSION_COMPACTION_TRIGGER_RATIO) {
      return
    }

    log.info("session compaction triggered", {
      userId,
      channel,
      estimatedTokens,
      fillRatio: fillRatio.toFixed(2),
    })

    await sessionSummarizer.compress(userId, channel, SESSION_COMPACTION_KEEP_LAST_TURNS)
  } catch (err) {
    log.warn("session compaction failed, continuing with full session", { userId, err })
  }
}

async function buildPersonaDynamicContext(
  userId: string,
  safeText: string,
): Promise<string | undefined> {
  if (!config.PERSONA_ENABLED) {
    return undefined
  }

  const [profile, profileSummary] = await Promise.all([
    profiler.getProfile(userId),
    profiler.formatForContext(userId),
  ])

  const mood = personaEngine.detectMood(safeText, profile?.currentTopics ?? [])
  const expertise = personaEngine.detectExpertise(profile, safeText)
  const topicCategory = personaEngine.detectTopicCategory(safeText)

  return personaEngine.buildDynamicContext(
    {
      userMood: mood,
      userExpertise: expertise,
      topicCategory,
      urgency: mood === "stressed",
    },
    profileSummary,
  )
}

function buildGenerationPrompt(systemContext: string, safeText: string): string {
  return systemContext ? `${systemContext}\n\nUser: ${safeText}` : safeText
}

function scanAssistantResponse(userId: string, rawResponse: string): {
  response: string
  scanResult: OutputScanResult
} {
  const scanResult = outputScanner.scan(rawResponse)
  if (!scanResult.safe) {
    log.warn("assistant output sanitized", { userId, issues: scanResult.issues })
  }

  return {
    response: scanResult.sanitized,
    scanResult,
  }
}

async function persistAssistantResponse(
  userId: string,
  channel: string,
  response: string,
  rawAssistantResponse: string,
  scanResult: OutputScanResult,
): Promise<void> {
  const assistantMeta = buildAssistantMessageMetadata(
    channel,
    scanResult,
    rawAssistantResponse,
    response,
  )

  await Promise.all([
    saveMessage(userId, "assistant", response, channel, assistantMeta),
    memory.save(userId, response, assistantMeta),
  ])

  addSessionMessage(userId, channel, "assistant", response)
}

function launchAsyncSideEffects(userId: string, safeText: string): void {
  // These are deferred because they improve future context quality and should
  // never delay delivery of the current reply.
  void profiler.extractFromMessage(userId, safeText, "user")
    .then(({ facts, opinions }) => profiler.updateProfile(userId, facts, opinions))
    .catch((err) => log.warn("profiler async extraction failed", { userId, err }))

  void causalGraph.extractAndUpdate(userId, safeText)
    .catch((err) => log.warn("causal graph async update failed", { userId, err }))
}

function computeProvisionalReward(retrievedMemoryIds: string[]): number {
  return retrievedMemoryIds.length > 0 ? PROVISIONAL_MEMORY_REWARD : 0
}

/**
 * Process a single user message through the full EDITH pipeline.
 *
 * @param userId  - The authenticated user's ID
 * @param rawText - The raw, unfiltered message text from the user
 * @param options - Transport and session configuration
 * @returns       PipelineResult with the final response and MemRL metadata
 */
export async function processMessage(
  userId: string,
  rawText: string,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const { channel, sessionMode = "dm", signal, onChunk } = options
  assertNotAborted(signal)

  // Stage 1: Input safety
  const inputSafety = await withSpan("pipeline.input_safety", { userId, channel }, async () => {
    return filterPromptWithAffordance(rawText, userId)
  })
  assertNotAborted(signal)
  if (!inputSafety.safe && inputSafety.affordance?.shouldBlock) {
    log.warn("message blocked by affordance checker", { userId, channel })
    return blockedResult()
  }
  const safeText = inputSafety.sanitized

  // Stage 2: Persist user input and build retrieval context
  const { messages, systemContext, retrievedMemoryIds } = await withSpan(
    "pipeline.context_retrieval",
    { userId, channel },
    async () => {
      return persistUserMessageAndBuildContext(
        userId,
        channel,
        rawText,
        safeText,
        inputSafety,
      )
    },
  )
  incrementMemoryRetrieval("pipeline_context")
  assertNotAborted(signal)

  // Stage 2.5: Opportunistic session compaction (best effort)
  await maybeCompactSessionHistory(userId, channel)
  assertNotAborted(signal)

  // Stage 3 + 4: Persona detection and system prompt assembly
  const dynamicContext = await withSpan("pipeline.persona_context", { userId, channel }, async () => {
    return buildPersonaDynamicContext(userId, safeText)
  })
  assertNotAborted(signal)
  const systemPrompt = await withSpan("pipeline.system_prompt", { userId, channel, sessionMode }, async () => {
    return buildSystemPrompt({
      sessionMode,
      includeSkills: true,
      includeSafety: true,
      extraContext: dynamicContext,
    })
  })
  assertNotAborted(signal)

  // Stage 5: LLM generation (respects user model preferences from /model command)
  const taskType = classifyTaskType(safeText)
  const prompt = buildGenerationPrompt(systemContext, safeText)
  const raw = await withSpan("pipeline.engine_generate", { userId, channel, taskType }, async () => {
    return orchestrator.generateForUser(userId, taskType, {
      prompt,
      context: messages,
      systemPrompt,
      signal,
    })
  })
  assertNotAborted(signal)

  // Stage 6: Critique and refinement
  const critiqued = await withSpan("pipeline.critique", { userId, channel }, async () => {
    return responseCritic.critiqueAndRefine(safeText, raw, CRITIC_MAX_ITERATIONS)
  })
  assertNotAborted(signal)
  if (critiqued.refined) {
    log.debug("response refined by critic", {
      score: critiqued.critique.score,
      iterations: critiqued.iterations,
    })
  }

  // Stage 7: Output safety scan
  const { response, scanResult } = scanAssistantResponse(userId, critiqued.finalResponse)

  // Stage 8: Persist assistant response
  await persistAssistantResponse(
    userId,
    channel,
    response,
    critiqued.finalResponse,
    scanResult,
  )
  assertNotAborted(signal)

  if (onChunk) {
    await emitPseudoStream(response, onChunk, signal)
  }

  // Stage 9: Async side effects (fire-and-forget)
  launchAsyncSideEffects(userId, safeText)

  return {
    response,
    retrievedMemoryIds,
    provisionalReward: computeProvisionalReward(retrievedMemoryIds),
    taskType,
  }
}

export const __pipelineTestUtils = {
  classifyTaskType,
  emitPseudoStream,
}
