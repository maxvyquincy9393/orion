/**
 * @file capability-router.ts
 * @description Routes requests to engines based on required capabilities.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Maps capability requirements (vision, code, reasoning) to best engine.
 *   Integrates with orchestrator for capability-aware routing decisions.
 *   Providers in each list are ordered by preference.
 */
import { createLogger } from '../logger.js'
import type { TaskType } from '../engines/types.js'

const log = createLogger('routing.capability-router')

/** Input for a capability-based routing decision. */
export interface CapabilityRequest {
  taskType: TaskType
  requiresVision?: boolean
  requiresCode?: boolean
  requiresLongContext?: boolean
  maxLatencyMs?: number
}

/** A routing decision with provider, model, and reason. */
export interface RouteDecision {
  provider: string
  model: string
  reason: string
}

/** Capability → ordered list of provider/model candidates. */
const CAPABILITY_MAP: Record<string, RouteDecision[]> = {
  vision: [
    { provider: 'anthropic', model: 'claude-opus-4-5', reason: 'Best vision quality' },
    { provider: 'gemini', model: 'gemini-2.0-flash', reason: 'Fast vision' },
    { provider: 'openai', model: 'gpt-4o', reason: 'Strong vision' },
  ],
  code: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5', reason: 'Best code quality' },
    { provider: 'deepseek', model: 'deepseek-coder', reason: 'Code specialist' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', reason: 'Fast code' },
  ],
  reasoning: [
    { provider: 'anthropic', model: 'claude-opus-4-5', reason: 'Best reasoning' },
    { provider: 'groq', model: 'deepseek-r1-distill-llama-70b', reason: 'Fast reasoning' },
    { provider: 'gemini', model: 'gemini-2.0-flash', reason: 'Strong reasoning' },
  ],
  fast: [
    { provider: 'groq', model: 'llama-3.1-8b-instant', reason: 'Fastest inference' },
    { provider: 'gemini', model: 'gemini-2.0-flash', reason: 'Fast + capable' },
    { provider: 'together', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', reason: 'Fast open source' },
    { provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p1-70b-instruct', reason: 'Fast inference' },
  ],
  longContext: [
    { provider: 'anthropic', model: 'claude-opus-4-5', reason: '200k context window' },
    { provider: 'gemini', model: 'gemini-2.0-flash', reason: '1M context window' },
  ],
}

class CapabilityRouter {
  /**
   * Get ordered list of providers for a capability request.
   * @param req - The capability requirements for routing.
   * @returns Ordered list of route decisions (first = most preferred).
   */
  route(req: CapabilityRequest): RouteDecision[] {
    if (req.requiresVision) {
      log.debug('routing to vision-capable provider')
      return CAPABILITY_MAP.vision ?? []
    }
    if (req.requiresLongContext) {
      log.debug('routing to long-context provider')
      return CAPABILITY_MAP.longContext ?? []
    }
    if (req.requiresCode || req.taskType === 'code') {
      log.debug('routing to code-specialized provider')
      return CAPABILITY_MAP.code ?? []
    }
    if (req.taskType === 'reasoning') {
      return CAPABILITY_MAP.reasoning ?? []
    }
    return CAPABILITY_MAP.fast ?? []
  }
}

/** Singleton capability router. */
export const capabilityRouter = new CapabilityRouter()
