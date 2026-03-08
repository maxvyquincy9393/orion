/**
 * @file agent-registry.ts
 * @description AgentRegistry — lifecycle management for concurrent sub-agents.
 *
 * ARCHITECTURE:
 *   Wraps SpecializedAgents with:
 *     - Concurrency guard (max N agents running simultaneously)
 *     - Structured lifecycle tracking (idle → running → done/failed/terminated)
 *     - AbortController integration for cooperative cancellation
 *     - SharedTaskMemory injection so agents share findings automatically
 *
 *   AgentRunner.runWithSupervisor() replaces its raw Promise.all(wave) calls with
 *   agentRegistry.spawn() + agentRegistry.collect() per wave.
 *
 *   All agents run in-process (no subprocess spawning). Concurrency is managed
 *   by a simple Promise queue — when maxConcurrent is reached, spawn() waits.
 *
 * PAPER BASIS:
 *   - Multi-Agent Collaboration Mechanisms (arXiv:2501.06322): star topology — one
 *     orchestrator dispatches to N specialized agents; maxConcurrent prevents resource
 *     exhaustion under high task load
 *   - Collaborative Memory (arXiv:2505.18279): each agent writes provenance-tagged
 *     findings to SharedTaskMemory after completing its node
 *
 * @module acp/agent-registry
 */

import { randomUUID } from "node:crypto"

import type { TaskNode, AgentType } from "../agents/task-planner.js"
import type { TaskResult } from "../agents/execution-monitor.js"
import { runSpecializedAgent } from "../agents/specialized-agents.js"
import type { SharedTaskMemory } from "./shared-memory.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("acp.agent-registry")

/** Current lifecycle state of an agent instance. */
export type AgentStatus = "idle" | "running" | "done" | "failed" | "terminated"

/**
 * A tracked agent instance within the registry.
 */
export interface AgentInstance {
  /** Unique instance ID (UUID). */
  id: string
  /** The TaskNode this agent is executing. */
  nodeId: string
  /** Agent specialization. */
  agentType: AgentType
  /** Current lifecycle state. */
  status: AgentStatus
  /** Unix timestamp (ms) when the agent started. */
  startedAt: number
  /** Unix timestamp (ms) when the agent finished (or was terminated). */
  finishedAt?: number
  /** Final result (available when status === 'done'). */
  result?: TaskResult
  /** Error message (available when status === 'failed'). */
  errorMessage?: string
  /** Call this to cooperatively abort the agent. */
  abort?: () => void
}

/** Default max concurrent agents if AGENT_MAX_CONCURRENT is not set. */
const DEFAULT_MAX_CONCURRENT = 5

/**
 * AgentRegistry — spawns, tracks, and terminates sub-agent instances.
 *
 * Usage:
 *   const registry = new AgentRegistry()
 *   const id = await registry.spawn(node, memory)
 *   const result = await registry.collect(id)
 *   registry.cleanup()
 */
export class AgentRegistry {
  /** Maximum number of agents that may run concurrently. */
  private readonly maxConcurrent: number

  /** All tracked instances (keyed by instance ID). */
  private readonly agents = new Map<string, AgentInstance>()

  /** Queue of pending spawn requests waiting for a concurrency slot. */
  private readonly spawnQueue: Array<() => void> = []

  constructor(maxConcurrent?: number) {
    this.maxConcurrent = maxConcurrent
      ?? (typeof config.AGENT_MAX_CONCURRENT === "number"
        ? config.AGENT_MAX_CONCURRENT
        : DEFAULT_MAX_CONCURRENT)
  }

  /**
   * Spawn an agent for a task node.
   *
   * Blocks (using a Promise queue) if maxConcurrent agents are already running.
   * Writes the result to SharedTaskMemory after the node completes.
   *
   * @param node   - The TaskNode to execute
   * @param memory - Session-scoped shared memory
   * @returns Instance ID for tracking via collect()
   */
  async spawn(node: TaskNode, memory: SharedTaskMemory): Promise<string> {
    // Wait for a concurrency slot
    await this.acquireSlot()

    const instanceId = randomUUID()
    const abortController = new AbortController()

    const instance: AgentInstance = {
      id: instanceId,
      nodeId: node.id,
      agentType: node.agentType,
      status: "running",
      startedAt: Date.now(),
      abort: () => abortController.abort(),
    }
    this.agents.set(instanceId, instance)

    log.info("agent spawned", {
      instanceId,
      nodeId: node.id,
      agentType: node.agentType,
      running: this.runningCount,
      max: this.maxConcurrent,
    })

    // Run the agent asynchronously — collect() awaits the stored Promise
    const taskPromise = this.runAgent(node, memory, instance, abortController)
    // Store promise on the instance for collect() to await
    ;(instance as AgentInstance & { _promise?: Promise<TaskResult> })._promise = taskPromise
    void taskPromise // suppress unhandled rejection warning; collect() handles it

    return instanceId
  }

  /**
   * Wait for an agent instance to complete and return its result.
   *
   * @param instanceId - ID returned by spawn()
   * @throws If the agent failed or was terminated
   */
  async collect(instanceId: string): Promise<TaskResult> {
    const instance = this.agents.get(instanceId) as
      | (AgentInstance & { _promise?: Promise<TaskResult> })
      | undefined

    if (!instance) {
      throw new Error(`AgentRegistry: unknown instance '${instanceId}'`)
    }

    if (instance._promise) {
      return instance._promise
    }

    if (instance.status === "done" && instance.result) {
      return instance.result
    }

    throw new Error(`AgentRegistry: instance '${instanceId}' has no result (status: ${instance.status})`)
  }

  /**
   * Cooperatively abort a running agent.
   * Sets its status to 'terminated' immediately.
   */
  async terminate(instanceId: string): Promise<void> {
    const instance = this.agents.get(instanceId)
    if (!instance) {
      return
    }

    if (instance.abort) {
      instance.abort()
    }

    instance.status = "terminated"
    instance.finishedAt = Date.now()
    this.releaseSlot()

    log.info("agent terminated", { instanceId, nodeId: instance.nodeId })
  }

  /** Returns the number of currently running agents. */
  get runningCount(): number {
    return [...this.agents.values()].filter((a) => a.status === "running").length
  }

  /** Returns a snapshot of all tracked instances (defensive copy). */
  list(): AgentInstance[] {
    return [...this.agents.values()]
  }

  /** Remove completed/failed/terminated instances to free memory. */
  cleanup(): void {
    const before = this.agents.size
    for (const [id, instance] of this.agents) {
      if (instance.status !== "running") {
        this.agents.delete(id)
      }
    }
    const removed = before - this.agents.size
    if (removed > 0) {
      log.debug("registry cleanup", { removed, remaining: this.agents.size })
    }
  }

  // ============================================================
  //  Private
  // ============================================================

  private async runAgent(
    node: TaskNode,
    memory: SharedTaskMemory,
    instance: AgentInstance,
    abortController: AbortController,
  ): Promise<TaskResult> {
    try {
      // Build context from shared memory for this agent
      const sharedContext = memory.buildContextFor(node.agentType, 3_000)
      const taskWithContext = sharedContext
        ? `${node.task}\n\n${sharedContext}`
        : node.task

      // runSpecializedAgent returns a string (the LLM output)
      const output = await runSpecializedAgent(node.agentType, taskWithContext, node.context)

      if (abortController.signal.aborted) {
        instance.status = "terminated"
        instance.finishedAt = Date.now()
        this.releaseSlot()
        return {
          nodeId: node.id,
          output: "",
          success: false,
          attempts: 1,
          errorHistory: ["terminated"],
        } satisfies TaskResult
      }

      const result: TaskResult = {
        nodeId: node.id,
        output,
        success: output.trim().length > 0,
        attempts: 1,
        errorHistory: [],
      }

      // Mark done and write findings to shared memory
      instance.status = "done"
      instance.finishedAt = Date.now()
      instance.result = result

      if (result.success) {
        memory.write({
          agentType: node.agentType,
          nodeId: node.id,
          content: output,
          category: "finding",
          visibility: "shared",
        })
      }

      log.info("agent completed", {
        instanceId: instance.id,
        nodeId: node.id,
        success: result.success,
        durationMs: instance.finishedAt - instance.startedAt,
      })

      this.releaseSlot()
      return result
    } catch (error) {
      instance.status = "failed"
      instance.finishedAt = Date.now()
      instance.errorMessage = error instanceof Error ? error.message : String(error)

      memory.write({
        agentType: node.agentType,
        nodeId: node.id,
        content: `Agent error: ${instance.errorMessage}`,
        category: "error",
        visibility: "shared",
      })

      log.warn("agent failed", {
        instanceId: instance.id,
        nodeId: node.id,
        error: instance.errorMessage,
      })

      this.releaseSlot()
      return {
        nodeId: node.id,
        output: "",
        success: false,
        attempts: 1,
        errorHistory: [instance.errorMessage],
      } satisfies TaskResult
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.runningCount < this.maxConcurrent) {
      return
    }

    // Wait in queue until a slot is released
    await new Promise<void>((resolve) => {
      this.spawnQueue.push(resolve)
      log.debug("agent queued (max concurrent reached)", {
        running: this.runningCount,
        max: this.maxConcurrent,
        queued: this.spawnQueue.length,
      })
    })
  }

  private releaseSlot(): void {
    const next = this.spawnQueue.shift()
    if (next) {
      next()
    }
  }
}

/** Singleton for use by AgentRunner. */
export const agentRegistry = new AgentRegistry()
