/**
 * @file local-embedder.ts
 * @description LocalEmbedder — offline-capable embedding provider using
 *              @xenova/transformers (all-MiniLM-L6-v2, 22MB, 384 dims).
 *
 * ARCHITECTURE:
 *   This is the Phase 9 replacement for the hash-based fallback embedding.
 *   When LOCAL_EMBEDDER_ENABLED=true, this replaces the hash fallback in store.ts
 *   without requiring any network connectivity.
 *
 *   Embedding dimension is 384 (vs OpenAI's 768). The model is downloaded once
 *   to LOCAL_EMBEDDER_CACHE_DIR and reused from disk on subsequent startups.
 *
 *   The OfflineCoordinator uses the presence of this module as a signal that
 *   embedding quality won't degrade when cloud APIs are unreachable.
 *
 *   Integration:
 *     - memory/store.ts calls localEmbedder.embed() as the first candidate
 *       when LOCAL_EMBEDDER_ENABLED=true (before Ollama and OpenAI).
 *     - If this module is not enabled, store.ts falls through to Ollama → OpenAI → hash.
 *
 * PAPER BASIS:
 *   - Phase 9 design: "LOCAL IS THE ARMOR, CLOUD IS THE UPGRADE"
 *   - all-MiniLM-L6-v2: Wang et al. 2020 — Sentence-BERT knowledge distillation
 *     benchmark: MTEB retrieval score comparable to larger cloud models
 *
 * @module memory/local-embedder
 */

import path from "node:path"
import fs from "node:fs/promises"

import config from "../config.js"
import { createLogger } from "../logger.js"

const log = createLogger("memory.local-embedder")

/** Expected embedding dimension for all-MiniLM-L6-v2. */
export const LOCAL_EMBEDDING_DIMENSION = 384

/** Whether the model is currently loaded and ready. */
let isReady = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstance: ((texts: string[], opts: Record<string, unknown>) => Promise<any>) | null = null

/**
 * Initialize the @xenova/transformers pipeline (lazy, called once).
 * Downloads the model on first call if not already cached locally.
 */
async function initPipeline(): Promise<boolean> {
  if (isReady && pipelineInstance) {
    return true
  }

  if (!config.LOCAL_EMBEDDER_ENABLED) {
    return false
  }

  try {
    // Dynamic import — @xenova/transformers is optional and may not be installed.
    // We use a string-based dynamic import to avoid compile-time TS2307 errors
    // when the package is not present. This is intentional: the local embedder
    // is an optional Phase 9 feature enabled via LOCAL_EMBEDDER_ENABLED=true.
    const transformersModule = await (
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      Function("return import('@xenova/transformers')")() as Promise<unknown>
    ).catch(() => null)

    if (!transformersModule || typeof transformersModule !== "object") {
      log.warn("@xenova/transformers not installed — local embedder unavailable. Run: pnpm add @xenova/transformers")
      return false
    }

    const mod = transformersModule as {
      pipeline: (
        task: string,
        model: string,
        opts?: Record<string, unknown>,
      ) => Promise<(texts: string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array }>>
      env: {
        cacheDir?: string
        localModelPath?: string
        allowRemoteModels?: boolean
      }
    }
    const { pipeline, env } = mod

    // Set cache directory for model downloads
    const cacheDir = path.resolve(process.cwd(), config.LOCAL_EMBEDDER_CACHE_DIR)
    await fs.mkdir(cacheDir, { recursive: true })
    env.cacheDir = cacheDir

    log.info("loading local embedding model", {
      model: config.LOCAL_EMBEDDER_MODEL,
      cacheDir,
    })

    pipelineInstance = await pipeline("feature-extraction", config.LOCAL_EMBEDDER_MODEL, {
      quantized: true,
    })

    isReady = true
    log.info("local embedder ready", { model: config.LOCAL_EMBEDDER_MODEL, dimension: LOCAL_EMBEDDING_DIMENSION })
    return true
  } catch (error) {
    log.warn("local embedder init failed", { error })
    isReady = false
    pipelineInstance = null
    return false
  }
}

/**
 * LocalEmbedder — wraps @xenova/transformers for offline sentence embeddings.
 *
 * Public API:
 *   - `isAvailable()`: check if the embedder is initialized and ready
 *   - `embed(text)`: embed a single string → number[] (384 dims) or null on failure
 *   - `init()`: explicitly initialize (called at startup if enabled)
 */
export class LocalEmbedder {
  private initPromise: Promise<boolean> | null = null

  /**
   * Initialize the embedder. Safe to call multiple times (idempotent).
   * Returns true if successfully initialized, false if unavailable.
   */
  async init(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = initPipeline()
    return this.initPromise
  }

  /**
   * Returns true if the local embedder is ready to use.
   */
  isAvailable(): boolean {
    return isReady && pipelineInstance !== null
  }

  /**
   * Embed a single text string.
   *
   * @param text - Text to embed
   * @returns 384-dimensional vector or null if unavailable
   */
  async embed(text: string): Promise<number[] | null> {
    if (!isReady || !pipelineInstance) {
      const initialized = await this.init()
      if (!initialized) {
        return null
      }
    }

    if (!pipelineInstance) {
      return null
    }

    try {
      const output = await pipelineInstance([text], {
        pooling: "mean",
        normalize: true,
      })

      const raw = output.data as Float32Array | number[]
      const vector = Array.from(raw) as number[]

      if (vector.length !== LOCAL_EMBEDDING_DIMENSION) {
        log.warn("unexpected embedding dimension", {
          expected: LOCAL_EMBEDDING_DIMENSION,
          got: vector.length,
        })
        return null
      }

      return vector
    } catch (error) {
      log.warn("local embed failed", { error })
      return null
    }
  }
}

/** Singleton export. */
export const localEmbedder = new LocalEmbedder()
