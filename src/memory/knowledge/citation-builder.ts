/**
 * @file citation-builder.ts
 * @description Build cited answers from knowledge retrieval results.
 *
 * PAPER BASIS:
 *   - Lost in the Middle (arXiv:2307.03172): order chunks with most relevant
 *     at start and end (not middle) of context window for best LLM attention
 *
 * @module memory/knowledge/citation-builder
 */

/** A retrieved chunk annotated with citation metadata. */
export interface CitedChunk {
  /** Chunk content text. */
  content: string
  /** Human-readable document name (title or filename). */
  sourceName: string
  /** Original file path or URL. */
  sourceFile: string
  /** Page number if applicable. */
  page?: number
  /** Section heading if applicable. */
  section?: string
  /** Retrieval score (0–1, higher = more relevant). */
  score: number
}

/** The result of a citation build — contains the formatted context prompt and source metadata. */
export interface CitationResult {
  /**
   * The formatted context string ready for injection into the LLM prompt.
   * Chunks are ordered using "Lost in the Middle" strategy.
   */
  prompt: string
  /** All cited chunks (sorted by score descending). */
  sources: CitedChunk[]
  /** Short inline citation string: "[1] SourceA, [2] SourceB, ..." */
  shortCitation: string
}

/**
 * Builds formatted citation contexts from a list of retrieved chunks.
 * Applies "Lost in the Middle" ordering to maximize LLM attention on relevant content.
 */
export class CitationBuilder {
  /**
   * Build a CitationResult from a query and its retrieved chunks.
   *
   * Ordering strategy (Lost in the Middle):
   *   - Most relevant chunk first
   *   - Second most relevant chunk last
   *   - Remaining chunks in the middle
   *
   * @param query  - The original user query (used for context label)
   * @param chunks - Retrieved chunks with relevance scores
   * @returns CitationResult with formatted prompt and source metadata
   */
  build(query: string, chunks: CitedChunk[]): CitationResult {
    if (chunks.length === 0) {
      return {
        prompt: "",
        sources: [],
        shortCitation: "",
      }
    }

    // Sort by score descending
    const sorted = [...chunks].sort((a, b) => b.score - a.score)

    // "Lost in the Middle" ordering: best first, second-best last, rest in middle
    const ordered = this.lostInMiddleOrder(sorted)

    // Format each chunk with a numbered citation label
    const formattedChunks = ordered.map((chunk, i) => {
      const pageLabel = chunk.page != null ? ` (page ${chunk.page})` : ""
      return `[${i + 1}] From: ${chunk.sourceName}${pageLabel}\n${chunk.content}`
    })

    const prompt = `Relevant context for: "${query}"\n\n${formattedChunks.join("\n\n---\n\n")}`

    // Build short citation string
    const shortCitation = ordered
      .map((chunk, i) => {
        const pageLabel = chunk.page != null ? ` p.${chunk.page}` : ""
        return `[${i + 1}] ${chunk.sourceName}${pageLabel}`
      })
      .join(", ")

    return {
      prompt,
      sources: sorted,
      shortCitation,
    }
  }

  /**
   * Append source citations as a footer to an LLM response string.
   *
   * @param llmResponse - Raw LLM response text
   * @param result      - CitationResult from build()
   * @returns Response with sources footer appended
   */
  formatAnswer(llmResponse: string, result: CitationResult): string {
    if (result.sources.length === 0) {
      return llmResponse
    }

    const footer = result.sources
      .map((chunk, i) => {
        const pageLabel = chunk.page != null ? ` — page ${chunk.page}` : ""
        const sectionLabel = chunk.section ? ` > ${chunk.section}` : ""
        return `[${i + 1}] ${chunk.sourceName}${sectionLabel}${pageLabel}`
      })
      .join("\n")

    return `${llmResponse}\n\nSources:\n${footer}`
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply "Lost in the Middle" ordering to a list sorted by relevance (descending).
   * The top-1 item goes first, top-2 goes last, everything else fills the middle.
   *
   * @param sorted - Chunks sorted by relevance descending
   * @returns Reordered chunks
   */
  private lostInMiddleOrder(sorted: CitedChunk[]): CitedChunk[] {
    if (sorted.length <= 2) {
      return sorted
    }

    const [first, second, ...rest] = sorted
    // first = most relevant (goes first)
    // second = second-most relevant (goes last)
    // rest = fills the middle
    return [first, ...rest, second]
  }
}

/** Singleton CitationBuilder instance. */
export const citationBuilder = new CitationBuilder()
