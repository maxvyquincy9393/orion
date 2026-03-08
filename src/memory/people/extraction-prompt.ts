/**
 * @file extraction-prompt.ts
 * @description LLM prompt templates for extracting person entity references
 * from user messages. Designed for fast models (GPT-4o-mini / Gemini Flash).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Consumed by `entity-extractor.ts`
 *   - Returns structured JSON that maps back to `ExtractedPersonRef[]`
 */

/** System prompt for NER extraction */
export const EXTRACTION_SYSTEM_PROMPT = `You are a named entity recognition system specialized in identifying PEOPLE mentioned in conversational messages.

Extract every person reference from the user's message and return a JSON array.

Rules:
- Only extract real persons (not organizations, projects, or EDITH itself)
- Infer relationship from context clues (e.g. "my boss", "my friend Sarah", "the PM")
- Sentiment: positive (praise/excitement), negative (frustration/conflict), neutral (neutral/factual)
- Keep snippets concise (max 80 chars)
- If no people are mentioned, return an empty array []

Respond ONLY with a JSON array, no markdown, no explanation. Example:
[
  {
    "name": "Alice",
    "relationship": "colleague",
    "context": "work",
    "topic": "project deadline",
    "sentiment": "neutral",
    "snippet": "Alice is handling the deployment"
  }
]

Valid relationship values: manager, report, colleague, friend, family, partner, mentor, mentee, contact, other
Valid context values: work, personal, family, other
Valid sentiment values: positive, neutral, negative`

/**
 * Build the user-turn prompt for entity extraction.
 *
 * @param message - Raw user message text
 * @returns User prompt string to send to the LLM
 */
export function buildExtractionPrompt(message: string): string {
  return `Extract all people mentioned in this message:\n\n${message}`
}
