/**
 * MessagePipeline — The canonical Orion message processing pipeline.
 *
 * This module is the single source of truth for how a user message is
 * processed from raw input to final response. Both the CLI transport
 * (main.ts) and the WebSocket/HTTP gateway (gateway/server.ts) delegate
 * to this pipeline, ensuring consistent behavior across all entry points.
 *
 * Pipeline stages (in order):
 *   1. Input safety check (prompt filter + affordance)
 *   2. Link context enrichment (optional)
 *   3. Memory context retrieval (HiMeS + MemRL)
 *   4. Persona / dynamic context detection
 *   5. System prompt assembly (bootstrap + skills + dynamic context)
 *   6. LLM generation (orchestrator)
 *   7. Response critique and refinement (optional)
 *   8. Output safety scan
 *   9. Persistence (database + vector memory + session store)
 *  10. Async side effects (profiler, causal graph) — fire-and-forget
 *
 * @module core/message-pipeline
 */

import config from "../config.js"
import { saveMessage } from "../database/index.js"
import { orchestrator } from "../engines/orchestrator.js"
import { filterPromptWithAffordance } from "../security/prompt-filter.js"
import { outputScanner } from "../security/output-scanner.js"
import { responseCritic } from "./critic.js"
import { personaEngine } from "./persona.js"
import { buildSystemPrompt } from "./system-prompt-builder.js"
import { memory } from "../memory/store.js"
import { profiler } from "../memory/profiler.js"
import { causalGraph } from "../memory/causal-graph.js"
import { sessionStore } from "../sessions/session-store.js"
import { createLogger } from "../logger.js"

const log = createLogger("core.pipeline")

/** Returned by the pipeline so callers can use the response and IDs for MemRL feedback. */
export interface PipelineResult {
  /** The final, safety-scanned response to send to the user. */
  response: string
  /** Memory node IDs that were retrieved — used to provide MemRL feedback. */
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

/**
 * Process a single user message through the full Orion pipeline.
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

  // ── Stage 1: Input safety ──────────────────────────────────────────────────
  const inputSafety = await filterPromptWithAffordance(rawText, userId)
  if (!inputSafety.safe && inputSafety.affordance?.shouldBlock) {
    log.warn("message blocked by affordance checker", { userId, channel })
    return {
      response: "Gue tidak bisa bantu dengan itu.",
      retrievedMemoryIds: [],
      provisionalReward: 0,
    }
  }
  const safeText = inputSafety.sanitized

  // ── Stage 2: Memory context retrieval ─────────────────────────────────────
  const [, { messages, systemContext, retrievedMemoryIds }] = await Promise.all([
    saveMessage(userId, "user", safeText, channel, {
      role: "user", channel, category: "event", level: 0,
      security: { affordance: inputSafety.affordance ?? null, sanitized: safeText !== rawText },
    }),
    memory.buildContext(userId, safeText),
  ])
  sessionStore.addMessage(userId, channel, {
    role: "user", content: safeText, timestamp: Date.now(),
  })

  // ── Stage 3 + 4: Persona detection + system prompt assembly ───────────────
  let dynamicContext: string | undefined
  if (config.PERSONA_ENABLED) {
    const [profile, profileSummary] = await Promise.all([
      profiler.getProfile(userId),
      profiler.formatForContext(userId),
    ])
    const mood = personaEngine.detectMood(safeText, profile?.currentTopics ?? [])
    const expertise = personaEngine.detectExpertise(profile, safeText)
    const topicCategory = personaEngine.detectTopicCategory(safeText)
    dynamicContext = personaEngine.buildDynamicContext(
      { userMood: mood, userExpertise: expertise, topicCategory, urgency: mood === "stressed" },
      profileSummary,
    )
  }

  const systemPrompt = await buildSystemPrompt({
    sessionMode,
    includeSkills: true,
    includeSafety: true,
    extraContext: dynamicContext,
  })

  // ── Stage 5: LLM generation ───────────────────────────────────────────────
  const prompt = systemContext ? `${systemContext}\n\nUser: ${safeText}` : safeText
  const raw = await orchestrator.generate("reasoning", { prompt, context: messages, systemPrompt })

  // ── Stage 6: Critique and refinement ──────────────────────────────────────
  const critiqued = await responseCritic.critiqueAndRefine(safeText, raw, 2)
  if (critiqued.refined) {
    log.debug("response refined by critic", {
      score: critiqued.critique.score,
      iterations: critiqued.iterations,
    })
  }

  // ── Stage 7: Output safety scan ───────────────────────────────────────────
  const scanResult = outputScanner.scan(critiqued.finalResponse)
  if (!scanResult.safe) {
    log.warn("assistant output sanitized", { userId, issues: scanResult.issues })
  }
  const response = scanResult.sanitized

  // ── Stage 8: Persist assistant response ───────────────────────────────────
  const assistantMeta = {
    role: "assistant", channel, category: "summary", level: 0,
    security: { outputIssues: scanResult.issues, sanitized: response !== critiqued.finalResponse },
  }
  await Promise.all([
    saveMessage(userId, "assistant", response, channel, assistantMeta),
    memory.save(userId, response, assistantMeta),
  ])
  sessionStore.addMessage(userId, channel, {
    role: "assistant", content: response, timestamp: Date.now(),
  })

  // ── Stage 9: Async side effects (fire-and-forget) ─────────────────────────
  void profiler.extractFromMessage(userId, safeText, "user")
    .then(({ facts, opinions }) => profiler.updateProfile(userId, facts, opinions))
    .catch((err) => log.warn("profiler async extraction failed", { userId, err }))

  void causalGraph.extractAndUpdate(userId, safeText)
    .catch((err) => log.warn("causal graph async update failed", { userId, err }))

  // Provisional MemRL reward — will be refined on next user turn
  const provisionalReward = retrievedMemoryIds.length > 0 ? 0.5 : 0

  return { response, retrievedMemoryIds, provisionalReward }
}
