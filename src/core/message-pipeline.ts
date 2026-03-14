/**
 * @file message-pipeline.ts
 * @description The canonical EDITH message processing pipeline from raw input through LLM generation to persisted response.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Central pipeline called by core/incoming-message-service.ts and gateway/server.ts.
 *   Coordinates security checks, memory retrieval, system prompt assembly, and LLM generation.
 *
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

import { randomUUID } from "node:crypto";

import config from "../config.js";
import { saveMessage } from "../database/index.js";
import { orchestrator } from "../engines/orchestrator.js";
import { memory, type BuildContextResult } from "../memory/store.js";
import { profiler } from "../memory/profiler.js";
import { causalGraph } from "../memory/causal-graph.js";
import { sessionSummarizer } from "../memory/session-summarizer.js";
import {
  filterPromptWithAffordance,
  type PromptSafetyResult,
} from "../security/prompt-filter.js";
import {
  outputScanner,
  type OutputScanResult,
} from "../security/output-scanner.js";
import { sessionStore } from "../sessions/session-store.js";
import { createLogger } from "../logger.js";
import { responseCritic } from "./critic.js";
import { eventBus } from "./event-bus.js";
import { personaEngine } from "./persona.js";
import { buildSystemPrompt } from "./system-prompt-builder.js";
import { feedbackStore } from "../memory/feedback-store.js";
import { habitModel } from "../background/habit-model.js";
import { userPreferenceEngine } from "../memory/user-preference.js";
import { personalityEngine } from "./personality-engine.js";
import { queryClassifier } from "../memory/knowledge/query-classifier.js";
import { retrievalEngine } from "../memory/knowledge/retrieval-engine.js";
import { syncScheduler } from "../memory/knowledge/sync-scheduler.js";
import { classifyTask, needsRetrieval } from "./task-classifier.js";
import { classifierFeedback } from "./classifier-feedback.js";
import { streamingDelivery } from "../channels/streaming-delivery.js";
import { tokenBudget } from "../observability/token-budget.js";
import type { BaseChannel } from "../channels/base.js";

const log = createLogger("core.pipeline");

const BLOCKED_RESPONSE = "Gue tidak bisa bantu dengan itu.";
const PROVISIONAL_MEMORY_REWARD = 0.5;
const CRITIC_MAX_ITERATIONS = 2;

const SESSION_HISTORY_LOOKBACK = 100;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000;
const SESSION_COMPACTION_TRIGGER_RATIO = 0.75;
const SESSION_COMPACTION_KEEP_LAST_TURNS = 6;
const APPROX_CHARS_PER_TOKEN = 3;

/**
 * Maximum time (ms) allowed for the full 9-stage pipeline to complete.
 * If exceeded, the pipeline rejects with a timeout error rather than hanging
 * indefinitely waiting on LLM generation + critique.
 */
const PIPELINE_TIMEOUT_MS = 60_000;

/** Returned by the pipeline so callers can use the response and IDs for MemRL feedback. */
export interface PipelineResult {
  /** The final, safety-scanned response to send to the user. */
  response: string;
  /** Memory node IDs that were retrieved - used to provide MemRL feedback. */
  retrievedMemoryIds: string[];
  /** Estimated provisional reward before user follow-up is known. */
  provisionalReward: number;
  /** Trace identifier for correlating log entries across this pipeline execution. */
  traceId: string;
}

export interface PipelineOptions {
  /** Identifies the transport layer (e.g. "cli", "webchat", "whatsapp"). */
  channel: string;
  /** Session mode for system prompt assembly. */
  sessionMode?: "dm" | "group" | "subagent";
  /** Enable streaming delivery when the engine supports generateStream(). */
  stream?: boolean;
  /** Target channel instance for streaming delivery (required when stream=true). */
  streamChannel?: BaseChannel;
}

function blockedResult(traceId: string): PipelineResult {
  return {
    response: BLOCKED_RESPONSE,
    retrievedMemoryIds: [],
    provisionalReward: 0,
    traceId,
  };
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
  });
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
  };
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
  };
}

async function persistUserMessageAndBuildContext(
  userId: string,
  channel: string,
  rawText: string,
  safeText: string,
  inputSafety: PromptSafetyResult,
  skipRetrieval: boolean,
): Promise<BuildContextResult> {
  const userMeta = buildUserMessageMetadata(
    channel,
    inputSafety,
    rawText,
    safeText,
  );

  if (skipRetrieval) {
    // Phase H.2: Skip memory retrieval for trivial messages (greetings, affirmations, etc.)
    // to save 200-500ms per turn. Only persist the user message.
    await saveMessage(userId, "user", safeText, channel, userMeta);
    addSessionMessage(userId, channel, "user", safeText);

    return {
      messages: [],
      systemContext: "",
      retrievedMemoryIds: [],
    };
  }

  // Persistence and retrieval are independent; run them together to avoid
  // paying sequential latency for every user turn.
  const [, context] = await Promise.all([
    saveMessage(userId, "user", safeText, channel, userMeta),
    memory.buildContext(userId, safeText),
  ]);

  addSessionMessage(userId, channel, "user", safeText);
  return context;
}

function estimateSessionTokens(history: Array<{ content: string }>): number {
  // A conservative char-based estimate is intentionally provider-agnostic and
  // stable even when routing switches across model vendors/tokenizers.
  return history.reduce((sum, message) => {
    const chars =
      typeof message.content === "string" ? message.content.length : 0;
    return sum + Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
  }, 0);
}

function resolveContextWindowLimit(): number {
  const configuredLimit =
    config.SESSION_CONTEXT_WINDOW_TOKENS ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  return Math.max(1, configuredLimit);
}

async function maybeCompactSessionHistory(
  userId: string,
  channel: string,
): Promise<void> {
  if (!config.SESSION_COMPACTION_ENABLED) {
    return;
  }

  // Best effort only: compaction improves future turns but must not block the
  // current response path if summarization is unavailable or fails.
  try {
    const sessionHistory = await sessionStore.getSessionHistory(
      userId,
      channel,
      SESSION_HISTORY_LOOKBACK,
    );
    if (sessionHistory.length === 0) {
      return;
    }

    const estimatedTokens = estimateSessionTokens(sessionHistory);
    const contextWindowLimit = resolveContextWindowLimit();
    const fillRatio = estimatedTokens / contextWindowLimit;

    if (fillRatio < SESSION_COMPACTION_TRIGGER_RATIO) {
      return;
    }

    log.info("session compaction triggered", {
      userId,
      channel,
      estimatedTokens,
      fillRatio: fillRatio.toFixed(2),
    });

    await sessionSummarizer.compress(
      userId,
      channel,
      SESSION_COMPACTION_KEEP_LAST_TURNS,
    );
  } catch (err) {
    log.warn("session compaction failed, continuing with full session", {
      userId,
      err,
    });
  }
}

async function buildPersonaDynamicContext(
  userId: string,
  safeText: string,
  channel: string,
): Promise<string | undefined> {
  if (!config.PERSONA_ENABLED) {
    return undefined;
  }

  const [profile, profileSummary] = await Promise.all([
    profiler.getProfile(userId),
    profiler.formatForContext(userId),
  ]);

  const recentTopics = profile?.currentTopics ?? [];
  const mood = personaEngine.detectMood(safeText, recentTopics);
  const expertise = personaEngine.detectExpertise(profile, safeText);
  const topicCategory = personaEngine.detectTopicCategory(safeText);

  // Detect session start: check if the last message in this channel was > 2 hours ago
  let isSessionStart = false;
  try {
    const history = await sessionStore.getSessionHistory(userId, channel, 1);
    if (history.length === 0) {
      isSessionStart = true;
    } else {
      const lastTimestamp = (history[0] as { timestamp?: number }).timestamp ?? 0;
      const gapMs = Date.now() - lastTimestamp;
      isSessionStart = gapMs > 2 * 60 * 60 * 1000; // 2 hours
    }
  } catch {
    // Session store unavailable — default to non-session-start
  }

  const currentHour = new Date().getHours();
  const situation = personaEngine.detectSituation(safeText, currentHour, isSessionStart, recentTopics);

  return personaEngine.buildDynamicContext(
    {
      userMood: mood,
      userExpertise: expertise,
      topicCategory,
      urgency: mood === "stressed",
      situation,
    },
    profileSummary,
  );
}

function buildGenerationPrompt(
  systemContext: string,
  safeText: string,
): string {
  return systemContext ? `${systemContext}\n\nUser: ${safeText}` : safeText;
}

function scanAssistantResponse(
  userId: string,
  rawResponse: string,
): {
  response: string;
  scanResult: OutputScanResult;
} {
  const scanResult = outputScanner.scan(rawResponse);
  if (!scanResult.safe) {
    log.warn("assistant output sanitized", {
      userId,
      issues: scanResult.issues,
    });
  }

  return {
    response: scanResult.sanitized,
    scanResult,
  };
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
  );

  await Promise.all([
    saveMessage(userId, "assistant", response, channel, assistantMeta),
    memory.save(userId, response, assistantMeta),
  ]);

  addSessionMessage(userId, channel, "assistant", response);
}

function launchAsyncSideEffects(
  userId: string,
  safeText: string,
  response: string,
  retrievedMemoryIds: string[],
  taskType?: string,
  generationLatencyMs?: number,
): void {
  // These are deferred because they improve future context quality and should
  // never delay delivery of the current reply.
  void profiler
    .extractFromMessage(userId, safeText, "user")
    .then(({ facts, opinions }) =>
      profiler.updateProfile(userId, facts, opinions),
    )
    .catch((err) =>
      log.warn("profiler async extraction failed", { userId, err }),
    );

  void causalGraph
    .extractAndUpdate(userId, safeText)
    .catch((err) =>
      log.warn("causal graph async update failed", { userId, err }),
    );

  // Phase 10: Capture explicit preference signals from user message
  void feedbackStore
    .captureExplicit({ userId, message: safeText })
    .catch((err) =>
      log.warn("feedback explicit capture failed", { userId, err }),
    );

  // Phase 10: Record activity for HabitModel
  void habitModel
    .record(userId)
    .catch((err) => log.warn("habit model record failed", { userId, err }));

  // Phase 10: Detect language preference from message
  const detectedLang = personalityEngine.detectLanguageFromMessage(safeText);
  if (detectedLang) {
    void userPreferenceEngine
      .setLanguage(userId, detectedLang)
      .catch((err) =>
        log.warn("language preference update failed", { userId, err }),
      );
  }

  // Phase 10: Implicit MemRL feedback from response length vs user engagement
  if (retrievedMemoryIds.length > 0) {
    void feedbackStore
      .captureImplicit({
        userId,
        userReply: safeText,
        previousResponseLengthChars: response.length,
        memoryIds: retrievedMemoryIds,
      })
      .catch((err) =>
        log.warn("feedback implicit capture failed", { userId, err }),
      );
  }

  // Phase 13: Knowledge base sync scheduler tick (fire-and-forget)
  if (config.KNOWLEDGE_BASE_ENABLED) {
    void syncScheduler
      .tick()
      .catch((err) =>
        log.warn("KB sync scheduler tick failed", { userId, err }),
      );
  }

  // Phase H.4: Record classification outcome for feedback analysis
  if (taskType && generationLatencyMs !== undefined) {
    classifierFeedback.recordSimple(
      safeText,
      taskType as import("../engines/types.js").TaskType,
      "unknown", // engine name is internal to orchestrator
      generationLatencyMs,
      response.length,
    );
  }
}

function computeProvisionalReward(retrievedMemoryIds: string[]): number {
  return retrievedMemoryIds.length > 0 ? PROVISIONAL_MEMORY_REWARD : 0;
}

/**
 * Process a single user message through the full EDITH pipeline.
 *
 * @param userId  - The authenticated user's ID
 * @param rawText - The raw, unfiltered message text from the user
 * @param options - Transport and session configuration
 * @returns       PipelineResult with the final response and MemRL metadata
 */
/**
 * Internal implementation of the full 9-stage pipeline (no timeout).
 * Wrapped by processMessage() which enforces the 60-second timeout.
 */
async function processMessageInternal(
  userId: string,
  rawText: string,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const { channel, sessionMode = "dm" } = options;
  const traceId = randomUUID();

  // Stage 1: Input safety
  const inputSafety = await filterPromptWithAffordance(rawText, userId);
  if (!inputSafety.safe && inputSafety.affordance?.shouldBlock) {
    log.warn("message blocked by affordance checker", { traceId, userId, channel });
    return blockedResult(traceId);
  }
  const safeText = inputSafety.sanitized;

  // Emit event after input safety check succeeds (fire-and-forget, no latency added)
  eventBus.dispatch("user.message.received", {
    userId,
    content: safeText,
    channel: options.channel ?? "unknown",
    timestamp: Date.now(),
  });

  // Stage 1.5: Token budget enforcement
  const budgetCheck = await tokenBudget.checkBudget(userId);
  if (!budgetCheck.allowed) {
    log.warn("token budget exceeded", { traceId, userId, channel, remaining: budgetCheck.remaining });
    return {
      response: budgetCheck.message ?? "Token budget exceeded.",
      retrievedMemoryIds: [],
      provisionalReward: 0,
      traceId,
    };
  }

  // Stage 2: Persist user input and build retrieval context
  // Phase H.2: Check if retrieval is needed before calling memory.buildContext().
  // Skipping retrieval for trivial messages saves 200-500ms per turn.
  const skipRetrieval = !needsRetrieval(safeText);
  if (skipRetrieval) {
    log.info("retrieval skipped for trivial message", { userId, channel, preview: safeText.slice(0, 40) });
  }

  const { messages, systemContext, retrievedMemoryIds } =
    await persistUserMessageAndBuildContext(
      userId,
      channel,
      rawText,
      safeText,
      inputSafety,
      skipRetrieval,
    );

  // Stage 2.5: Opportunistic session compaction (best effort)
  await maybeCompactSessionHistory(userId, channel);

  // Stage 3 + 4: Persona detection and system prompt assembly
  let dynamicContext = await buildPersonaDynamicContext(userId, safeText, channel);

  // Phase 13: Knowledge base query classification + context injection
  if (config.KNOWLEDGE_BASE_ENABLED) {
    const classification = queryClassifier.classify(safeText);
    if (classification.type === "knowledge") {
      const kbContext = await retrievalEngine
        .retrieveContext(userId, safeText)
        .catch((err) => {
          log.warn("KB retrieval failed", { userId, err });
          return "";
        });
      if (kbContext) {
        dynamicContext = dynamicContext
          ? `${dynamicContext}\n\n${kbContext}`
          : kbContext;
        log.debug("KB context injected", {
          userId,
          confidence: classification.confidence,
        });
      }
    }
  }

  const systemPrompt = await buildSystemPrompt({
    sessionMode,
    includeSkills: true,
    includeSafety: true,
    extraContext: dynamicContext,
    userId, // Phase 10: inject per-user personality fragment
  });

  // Stage 4.5: Classify task type for smart LLM routing.
  // Avoids sending trivial queries (greetings, yes/no) to expensive reasoning models.
  const taskType = classifyTask(safeText);

  // Stage 5: LLM generation (streaming or non-streaming)
  const prompt = buildGenerationPrompt(systemContext, safeText);
  const generateOptions = {
    prompt,
    context: messages,
    systemPrompt,
  };

  let raw: string;
  const generationStartMs = Date.now();

  if (options.stream && options.streamChannel) {
    // Attempt streaming delivery when requested and channel context is provided
    const streamIterable = orchestrator.generateStream(taskType, generateOptions);

    if (streamIterable) {
      log.debug("using streaming generation", { userId, channel, taskType });
      const streamResult = await streamingDelivery.collect(streamIterable);
      raw = streamResult.fullText;
    } else {
      // Engine does not support streaming — fall back to non-streaming
      log.debug("streaming not available, falling back to non-streaming", {
        userId,
        channel,
        taskType,
      });
      raw = await orchestrator.generate(taskType, generateOptions);
    }
  } else {
    raw = await orchestrator.generate(taskType, generateOptions);
  }

  const generationLatencyMs = Date.now() - generationStartMs;

  // Stage 6: Critique and refinement
  const critiqued = await responseCritic.critiqueAndRefine(
    safeText,
    raw,
    CRITIC_MAX_ITERATIONS,
  );
  if (critiqued.refined) {
    log.debug("response refined by critic", {
      score: critiqued.critique.score,
      iterations: critiqued.iterations,
    });
  }

  // Stage 7: Output safety scan
  const { response, scanResult } = scanAssistantResponse(
    userId,
    critiqued.finalResponse,
  );

  // Stage 8: Persist assistant response
  await persistAssistantResponse(
    userId,
    channel,
    response,
    critiqued.finalResponse,
    scanResult,
  );

  // Emit event after response is persisted (fire-and-forget, no latency added)
  eventBus.dispatch("user.message.sent", {
    userId,
    content: response,
    channel: options.channel ?? "unknown",
    timestamp: Date.now(),
  });

  // Stage 9: Async side effects (fire-and-forget)
  launchAsyncSideEffects(userId, safeText, response, retrievedMemoryIds, taskType, generationLatencyMs);

  return {
    response,
    retrievedMemoryIds,
    provisionalReward: computeProvisionalReward(retrievedMemoryIds),
    traceId,
  };
}

/**
 * Process a single user message through the full EDITH pipeline.
 *
 * Wraps processMessageInternal() with a 60-second timeout (PIPELINE_TIMEOUT_MS).
 * If the pipeline takes longer than the timeout, the Promise rejects with a
 * PipelineTimeoutError and the caller receives a safe blocked response.
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
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Pipeline timed out after ${PIPELINE_TIMEOUT_MS}ms for user ${userId}`,
        ),
      );
    }, PIPELINE_TIMEOUT_MS);
    // Allow Node.js to exit even if the timer is still running.
    timer.unref?.();
  });

  try {
    return await Promise.race([
      processMessageInternal(userId, rawText, options),
      timeoutPromise,
    ]);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Pipeline timed out")) {
      log.error("pipeline timeout", {
        userId,
        channel: options.channel,
        timeoutMs: PIPELINE_TIMEOUT_MS,
      });
      return {
        response:
          "Maaf, permintaanmu membutuhkan waktu terlalu lama. Coba lagi.",
        retrievedMemoryIds: [],
        provisionalReward: 0,
        traceId: randomUUID(),
      };
    }
    throw err;
  }
}
