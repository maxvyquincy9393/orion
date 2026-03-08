/**
 * @file query-classifier.ts
 * @description Fast heuristic classifier — should this query search the knowledge base?
 *
 * ARCHITECTURE:
 *   Pattern-matching only (no LLM call) — must be < 1ms.
 *   Called in message-pipeline.ts Stage 3 before context assembly.
 *
 * @module memory/knowledge/query-classifier
 */

/** The intent type inferred from the query. */
export type QueryType = "knowledge" | "chat" | "action"

/** Result of the heuristic classification. */
export interface ClassificationResult {
  /** Inferred query type. */
  type: QueryType
  /** Confidence score between 0 and 1. */
  confidence: number
  /** Human-readable reason for the classification. */
  reason: string
}

/**
 * Confidence threshold above which a query is routed to the knowledge base.
 * Set low (0.08) so that even a single strong pattern match triggers KB routing.
 */
const KNOWLEDGE_CONFIDENCE_THRESHOLD = 0.08

/**
 * Knowledge-base signal patterns (Indonesian + English).
 * Each pattern is weighted equally for confidence calculation.
 */
const KNOWLEDGE_PATTERNS: RegExp[] = [
  /cari.*yang (gue|aku|saya) (tulis|simpan|buat)/i,
  /dari (file|dokumen|notes|pdf|notion|obsidian)/i,
  /\b(ringkas|summarize|rangkum)\b/i,
  /yang ada di (knowledge|docs|notes|file)/i,
  /\b(search|find|cari)\b.*\b(documents?|dokumen|notes?|files?)\b/i,
  /ada (yang gue|yang aku|yang saya) (simpan|tulis|buat) soal/i,
  /\b(lookup|look up|retrieve)\b/i,
  /\b(dari|berdasarkan) (dokumen|catatan|notes)\b/i,
  /\bapa (isi|konten|isinya)\b/i,
  /\b(apa yang) (gue|aku|saya) (tulis|simpan|catat)\b/i,
]

/**
 * Fast heuristic query classifier.
 * Uses regex pattern matching with no LLM calls — must stay under 1ms.
 */
export class QueryClassifier {
  /**
   * Classify a query into one of: 'knowledge', 'chat', or 'action'.
   *
   * @param query - User input text
   * @returns ClassificationResult with type, confidence, and reason
   */
  classify(query: string): ClassificationResult {
    const matches = KNOWLEDGE_PATTERNS.filter((pattern) => pattern.test(query))
    const confidence = matches.length / KNOWLEDGE_PATTERNS.length

    if (confidence > KNOWLEDGE_CONFIDENCE_THRESHOLD) {
      return {
        type: "knowledge",
        confidence,
        reason: `${matches.length} knowledge-base pattern(s) matched`,
      }
    }

    // Simple action detection — imperative verbs often signal agent tasks
    const actionPatterns = [
      /\b(open|launch|run|execute|install|download|upload|send|delete|create|write|make)\b/i,
      /\b(buka|jalankan|kirim|hapus|buat|tulis)\b/i,
    ]
    const actionMatches = actionPatterns.filter((p) => p.test(query))
    if (actionMatches.length > 0) {
      return {
        type: "action",
        confidence: 0.5,
        reason: "imperative action pattern detected",
      }
    }

    return {
      type: "chat",
      confidence: 1 - confidence,
      reason: "no knowledge-base patterns matched",
    }
  }
}

/** Singleton QueryClassifier instance. */
export const queryClassifier = new QueryClassifier()
