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
import { memory, type BuildContextResult } from "../memory/store.js"
import { profiler } from "../memory/profiler.js"
import { causalGraph } from "../memory/causal-graph.js"
import { sessionSummarizer } from "../memory/session-summarizer.js"
import { filterPromptWithAffordance, type PromptSafetyResult } from "../security/prompt-filter.js"
import { outputScanner, type OutputScanResult } from "../security/output-scanner.js"
import { escalationTracker } from "../security/escalation-tracker.js"
import { auditLog } from "../security/audit-log.js"
import { sessionStore } from "../sessions/session-store.js"
import { createLogger } from "../logger.js"
import { responseCritic } from "./critic.js"
import { personaEngine } from "./persona.js"
import { buildSystemPrompt } from "./system-prompt-builder.js"
import { feedbackStore } from "../memory/feedback-store.js"
import { habitModel } from "../background/habit-model.js"
import { userPreferenceEngine } from "../memory/user-preference.js"
import { personalityEngine } from "./personality-engine.js"
import { queryClassifier } from "../memory/knowledge/query-classifier.js"
import { retrievalEngine } from "../memory/knowledge/retrieval-engine.js"
import { syncScheduler } from "../memory/knowledge/sync-scheduler.js"

const log = createLogger("core.pipeline")

const BLOCKED_RESPONSE = "Gue tidak bisa bantu dengan itu."
const PROVISIONAL_MEMORY_REWARD = 0.5
const CRITIC_MAX_ITERATIONS = 2

const SESSION_HISTORY_LOOKBACK = 100
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000
const SESSION_COMPACTION_TRIGGER_RATIO = 0.75
const SESSION_COMPACTION_KEEP_LAST_TURNS = 6
const APPROX_CHARS_PER_TOKEN = 3

/** Returned by the pipeline so callers can use the response and IDs for MemRL feedback. */
export interface PipelineResult {
  /** The final, safety-scanned response to send to the user. */
  response: string
  /** Memory node IDs that were retrieved - used to provide MemRL feedback. */
  retrievedMemoryIds: string[]
  /** Estimated provisional reward before user follow-up is known. */
  provisionalReward: number
}

export interface PipelineOptions {
  /** Identifies the transport layer (e.g. "cli", "webchat", "whatsapp"). */
  channel: string
  /** Session mode for system prompt assembly. */
  sessionMode?: "dm" | "group" | "subagent"
}

function blockedResult(): PipelineResult {
  return {
    response: BLOCKED_RESPONSE,
    retrievedMemoryIds: [],
    provisionalReward: 0,
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

function launchAsyncSideEffects(
  userId: string,
  safeText: string,
  response: string,
  retrievedMemoryIds: string[],
): void {
  // These are deferred because they improve future context quality and should
  // never delay delivery of the current reply.
  void profiler.extractFromMessage(userId, safeText, "user")
    .then(({ facts, opinions }) => profiler.updateProfile(userId, facts, opinions))
    .catch((err) => log.warn("profiler async extraction failed", { userId, err }))

  void causalGraph.extractAndUpdate(userId, safeText)
    .catch((err) => log.warn("causal graph async update failed", { userId, err }))

  // Phase 10: Capture explicit preference signals from user message
  void feedbackStore.captureExplicit({ userId, message: safeText })
    .catch((err) => log.warn("feedback explicit capture failed", { userId, err }))

  // Phase 10: Record activity for HabitModel
  void habitModel.record(userId)
    .catch((err) => log.warn("habit model record failed", { userId, err }))

  // Phase 10: Detect language preference from message
  const detectedLang = personalityEngine.detectLanguageFromMessage(safeText)
  if (detectedLang) {
    void userPreferenceEngine.setLanguage(userId, detectedLang)
      .catch((err) => log.warn("language preference update failed", { userId, err }))
  }

  // Phase 10: Implicit MemRL feedback from response length vs user engagement
  if (retrievedMemoryIds.length > 0) {
    void feedbackStore.captureImplicit({
      userId,
      userReply: safeText,
      previousResponseLengthChars: response.length,
      memoryIds: retrievedMemoryIds,
    }).catch((err) => log.warn("feedback implicit capture failed", { userId, err }))
  }

  // Phase 13: Knowledge base sync scheduler tick (fire-and-forget)
  if (config.KNOWLEDGE_BASE_ENABLED) {
    void syncScheduler.tick()
      .catch((err) => log.warn("KB sync scheduler tick failed", { userId, err }))
  }
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
  const { channel, sessionMode = "dm" } = options

  // Stage 1: Input safety

  // Check multi-turn escalation state BEFORE running the filter so that a
  // previously-blocked conversation is rejected immediately without wasting
  // LLM credits or leaking information via error messages.
  const escalationStatus = escalationTracker.check(userId)
  if (escalationStatus.blocked) {
    log.warn("message blocked by escalation tracker", {
      userId,
      channel,
      score: escalationStatus.score.toFixed(3),
    })
    void auditLog.append({
      tool: "prompt_filter",
      argsHash: "",
      userId,
      channel,
      result: "denied",
      durationMs: 0,
      reason: escalationStatus.reason,
    }).catch((err) => log.warn("audit log append failed", { userId, err }))
    return blockedResult()
  }

  const inputSafety = await filterPromptWithAffordance(rawText, userId)
  if (!inputSafety.safe && inputSafety.affordance?.shouldBlock) {
    log.warn("message blocked by affordance checker", { userId, channel })
    escalationTracker.record(userId, "injection_blocked")
    void auditLog.append({
      tool: "prompt_filter",
      argsHash: "",
      userId,
      channel,
      result: "denied",
      durationMs: 0,
      reason: inputSafety.reason,
    }).catch((err) => log.warn("audit log append failed", { userId, err }))
    return blockedResult()
  }

  // If the filter sanitized the input (partial match) without fully blocking it,
  // accumulate a lower-weight escalation signal so repeated probes are caught.
  if (!inputSafety.safe) {
    escalationTracker.record(userId, "injection_sanitized")
  }

  const safeText = inputSafety.sanitized

  // Stage 2: Persist user input and build retrieval context
  const { messages, systemContext, retrievedMemoryIds } = await persistUserMessageAndBuildContext(
    userId,
    channel,
    rawText,
    safeText,
    inputSafety,
  )

  // Stage 2.5: Opportunistic session compaction (best effort)
  await maybeCompactSessionHistory(userId, channel)

  // Stage 3 + 4: Persona detection and system prompt assembly
  let dynamicContext = await buildPersonaDynamicContext(userId, safeText)

  // Phase 13: Knowledge base query classification + context injection
  if (config.KNOWLEDGE_BASE_ENABLED) {
    const classification = queryClassifier.classify(safeText)
    if (classification.type === "knowledge") {
      const kbContext = await retrievalEngine.retrieveContext(userId, safeText)
        .catch((err) => {
          log.warn("KB retrieval failed", { userId, err })
          return ""
        })
      if (kbContext) {
        dynamicContext = dynamicContext
          ? `${dynamicContext}\n\n${kbContext}`
          : kbContext
        log.debug("KB context injected", { userId, confidence: classification.confidence })
      }
    }
  }

  const systemPrompt = await buildSystemPrompt({
    sessionMode,
    includeSkills: true,
    includeSafety: true,
    extraContext: dynamicContext,
    userId, // Phase 10: inject per-user personality fragment
  })

  // Stage 5: LLM generation
  const prompt = buildGenerationPrompt(systemContext, safeText)
  const raw = await orchestrator.generate("reasoning", { prompt, context: messages, systemPrompt })

  // Stage 6: Critique and refinement
  const critiqued = await responseCritic.critiqueAndRefine(safeText, raw, CRITIC_MAX_ITERATIONS)
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

  // Stage 9: Async side effects (fire-and-forget)
  launchAsyncSideEffects(userId, safeText, response, retrievedMemoryIds)

  return {
    response,
    retrievedMemoryIds,
    provisionalReward: computeProvisionalReward(retrievedMemoryIds),
  }
}
