# Profiler Facts and Opinions

File: `src/memory/profiler.ts`

## Objective
Separate objective profile facts from inferred beliefs.

## Data Contracts
- `PersonaFact`
  - key, value, confidence, lastUpdated, source
- `PersonaOpinion`
  - belief, confidence, evidence[], updatedAt
- `UserProfile`
  - facts[], opinions[], currentTopics[], lastExtracted

## Extraction Policy
- Facts only when explicitly stated.
- Fact confidence threshold >= 0.7 for persistence.
- Opinions can start near neutral confidence and evolve.

## Merge Strategy
- Facts keyed by normalized key.
- Replace fact only if new confidence is stronger.
- Opinions merged by belief text and evidence set.

## Opinion Confidence Update
- `supports`: confidence increases.
- `contradicts`: confidence decreases.
- bounded to sane range (for example 0.05 to 0.99).

## Context Formatting
`formatForContext()` includes:
- top facts
- top opinions
- active topics

## Quality Controls
- Strict JSON parse guard for model output.
- Snippet truncation for source evidence.
- ignore malformed extraction entries.
