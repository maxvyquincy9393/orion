# ProMem Extractor

File: `src/memory/promem.ts`

## Objective
Post-session iterative extraction of stable user facts.

## Algorithm (max 3 rounds)
1. Generate initial facts from history.
2. Ask for important facts not yet captured.
3. Add novel facts and repeat.
4. Verify candidate facts against history evidence.
5. Return verified fact list.

## Persistence Path
- Store verified facts as compressed system memories.
- Metadata includes `compressed=true`, `source=promem`.

## Reliability Controls
- Strict JSON parsing for each model response.
- Fallback to partial list on parse failure.
- Fact length and count caps.

## Recommended Trigger
- Run after session idle window or on daemon compaction cycle.
