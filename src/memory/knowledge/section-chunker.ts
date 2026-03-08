/**
 * @file section-chunker.ts
 * @description Section-aware document chunking with context prefix injection.
 *
 * PAPER BASIS:
 *   - RAPTOR (arXiv:2401.18059): hierarchical chunk abstraction
 *   - Contextual Retrieval (Anthropic, Sep 2024): context prefix per chunk
 *     improves retrieval precision by ~49% in benchmarks
 *
 * @module memory/knowledge/section-chunker
 */

import { type ParsedDocument, type DocumentSection } from "./format-handlers.js"

/** A single retrievable chunk produced by the section chunker. */
export interface KnowledgeChunk {
  /** Chunk content (with no context prefix — the prefix is stored separately). */
  content: string
  /** "From: {docTitle} > {sectionHeading}" — injected at retrieval time. */
  contextPrefix: string
  /** Page number if the source document has pages. */
  page?: number
  /** Section heading this chunk came from. */
  section?: string
  /** Zero-based index of this chunk within the document. */
  chunkIndex: number
  /** Total number of chunks in the document. */
  totalChunks: number
  /** Estimated token count. */
  tokens: number
}

/** Maximum tokens per chunk before splitting. */
const MAX_CHUNK_TOKENS = 512

/** Overlap tokens between sliding-window splits. */
const OVERLAP_TOKENS = 50

/**
 * Section-aware chunker. Respects document structure first, then falls back
 * to a sliding-window split for sections that exceed MAX_CHUNK_TOKENS.
 */
export class SectionChunker {
  /**
   * Chunk a parsed document into retrievable KnowledgeChunks.
   *
   * Strategy:
   *   1. If doc has structured sections with headings — one chunk per section.
   *   2. If a section is too long — sliding window within that section.
   *   3. If no structure — sliding window over full text.
   *
   * @param doc      - ParsedDocument returned by a format handler
   * @param docTitle - Human-readable document title for context prefix
   * @returns Array of KnowledgeChunks (may be empty for empty docs)
   */
  chunk(doc: ParsedDocument, docTitle: string): KnowledgeChunk[] {
    const sections = doc.structure.filter((s) => s.content.trim().length > 0)

    let rawChunks: Array<{ content: string; section?: string; page?: number }>

    if (sections.length > 0) {
      rawChunks = this.chunkBySections(sections, docTitle)
    } else {
      rawChunks = this.slidingWindow(doc.text, undefined)
    }

    return rawChunks.map((raw, index) => {
      const sectionLabel = raw.section ? ` > ${raw.section}` : ""
      const contextPrefix = `From: ${docTitle}${sectionLabel}`
      return {
        content: raw.content,
        contextPrefix,
        page: raw.page,
        section: raw.section,
        chunkIndex: index,
        totalChunks: rawChunks.length,
        tokens: this.estimateTokens(raw.content),
      }
    })
  }

  /**
   * Estimate the token count of a string.
   * Uses a conservative 4-chars-per-token approximation.
   *
   * @param text - Input text
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Produce one chunk per section, splitting large sections with a sliding window.
   *
   * @param sections - Non-empty sections from the parsed document
   * @param _docTitle - Document title (not used here, kept for future use)
   * @returns Array of raw chunk objects
   */
  private chunkBySections(
    sections: DocumentSection[],
    _docTitle: string,
  ): Array<{ content: string; section?: string; page?: number }> {
    const result: Array<{ content: string; section?: string; page?: number }> = []

    for (const section of sections) {
      const tokens = this.estimateTokens(section.content)

      if (tokens <= MAX_CHUNK_TOKENS) {
        result.push({
          content: section.content,
          section: section.heading,
          page: section.page,
        })
      } else {
        // Split the section using sliding window
        const subChunks = this.slidingWindow(section.content, section.heading, section.page)
        result.push(...subChunks)
      }
    }

    return result
  }

  /**
   * Split a text string into overlapping chunks using a sliding window.
   *
   * @param text    - Text to split
   * @param section - Section label (propagated to each sub-chunk)
   * @param page    - Page number (propagated to each sub-chunk)
   * @returns Array of raw chunk objects
   */
  splitLongSection(
    section: DocumentSection,
    prefix: string,
  ): KnowledgeChunk[] {
    const rawChunks = this.slidingWindow(section.content, section.heading, section.page)
    return rawChunks.map((raw, index) => ({
      content: raw.content,
      contextPrefix: prefix,
      page: raw.page,
      section: raw.section,
      chunkIndex: index,
      totalChunks: rawChunks.length,
      tokens: this.estimateTokens(raw.content),
    }))
  }

  /**
   * Sliding-window word-level chunker.
   *
   * @param text    - Text to split
   * @param section - Section label
   * @param page    - Page number
   * @returns Raw chunk array
   */
  private slidingWindow(
    text: string,
    section: string | undefined,
    page?: number,
  ): Array<{ content: string; section?: string; page?: number }> {
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length === 0) return []

    const chunkWords = MAX_CHUNK_TOKENS * 4 // chars → approx words
    const overlapWords = OVERLAP_TOKENS * 4

    const result: Array<{ content: string; section?: string; page?: number }> = []
    let cursor = 0

    while (cursor < words.length) {
      const end = Math.min(words.length, cursor + chunkWords)
      result.push({
        content: words.slice(cursor, end).join(" "),
        section,
        page,
      })
      if (end >= words.length) break
      cursor = Math.max(0, end - overlapWords)
    }

    return result
  }
}

/** Singleton SectionChunker instance. */
export const sectionChunker = new SectionChunker()
